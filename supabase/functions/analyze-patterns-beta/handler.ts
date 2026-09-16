import { handleAnalysis } from "../analyze-patterns-v2/analysis.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

export async function handleAuthenticatedAnalysis(request: Request) {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!token || !supabaseUrl || !anonKey) return json({ error: "Authentication is required" }, 401);

  let payload: Record<string, unknown>;
  try {
    payload = await request.clone().json();
  } catch {
    return json({ error: "Invalid JSON payload" }, 400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return json({ error: "Invalid JSON payload" }, 400);
  const workspaceId = typeof payload.workspace_id === "string" ? payload.workspace_id : "";
  if (!workspaceId) return json({ error: "A workspace is required" }, 400);

  const headers = { Authorization: authorization, apikey: anonKey };
  let membership:Response,userResponse:Response;
  try { [membership,userResponse] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/workspace_members?select=workspace_id&workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`, { headers, signal: AbortSignal.timeout(15000) }),
    fetch(`${supabaseUrl}/auth/v1/user`, { headers, signal: AbortSignal.timeout(15000) }),
  ]); } catch { return json({error:"Authentication service temporarily unavailable"},503); }
  const membershipRows = membership.ok ? await membership.json().catch(() => null) : [];
  if (!membership.ok || !Array.isArray(membershipRows) || !membershipRows.length) {
    return json({ error: "You do not have access to this workspace" }, 403);
  }

  const user = userResponse.ok ? await userResponse.json().catch(() => null) : null;
  if (!user?.id) return json({ error: "Your session is invalid or expired" }, 401);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return json({ error: "Analysis service configuration incomplete" }, 503);

  const operation = payload.analysis_type === "resume"
    ? "resume_analysis"
    : payload.analysis_type === "screening" || payload.analysis_type === "feedback"
      ? "screening_reassessment"
      : "pattern_analysis";
  const requestId = crypto.randomUUID();
  const recordUsage = async (status: "started" | "succeeded" | "failed") => {
    const body = JSON.stringify({ workspace_id: workspaceId, user_id: user.id, operation, status, request_id: requestId });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const saved = await fetch(`${supabaseUrl}/rest/v1/ai_usage_events?on_conflict=request_id,status`, {
          method: "POST",
          headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
          body, signal: AbortSignal.timeout(5000),
        });
        if (saved.ok) return;
        if (saved.status < 500 && saved.status !== 429) break;
      } catch { /* Retry the same identity after a lost response. */ }
    }
    console.error("AI usage could not be recorded after bounded retries.");
  };

  const started = recordUsage("started");
  // Resolve only after authentication, with the caller's workspace-scoped JWT.
  // No cache: permission withdrawal and source deletion take effect next request.
  let feedbackModel: string | undefined;
  if (payload.analysis_type === "feedback") {
    try {
      const lookup = await fetch(`${supabaseUrl}/rest/v1/rpc/get_feedback_learning_model`, {
        method: "POST", headers: {...headers, "Content-Type":"application/json"},
        body: JSON.stringify({p_workspace:workspaceId}), signal:AbortSignal.timeout(1500),
      });
      const model = lookup.ok ? await lookup.json() : null;
      if (typeof model === "string" && /^ft:gpt-4\.1-mini-2025-04-14:[a-zA-Z0-9:_-]+$/.test(model)) feedbackModel = model;
    } catch { /* Registry unavailable: keep the existing base model usable. */ }
  }
  let response = await handleAnalysis(request.clone(), {feedbackModel});
  if (feedbackModel && response.status >= 500) response = await handleAnalysis(request);

  const telemetry = started.then(() => recordUsage(response.ok ? "succeeded" : "failed"));
  const runtime = (globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (runtime) runtime.waitUntil(telemetry);
  else await telemetry;
  return response;
}

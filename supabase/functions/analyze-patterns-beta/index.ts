import { handleAnalysis } from "../analyze-patterns-v2/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (request) => {
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
  const workspaceId = typeof payload.workspace_id === "string" ? payload.workspace_id : "";
  if (!workspaceId) return json({ error: "A workspace is required" }, 400);

  const headers = { Authorization: authorization, apikey: anonKey };
  const membership = await fetch(
    `${supabaseUrl}/rest/v1/workspace_members?select=workspace_id&workspace_id=eq.${encodeURIComponent(workspaceId)}&limit=1`,
    { headers },
  );
  const membershipRows = membership.ok ? await membership.json() : [];
  if (!membership.ok || !Array.isArray(membershipRows) || !membershipRows.length) {
    return json({ error: "You do not have access to this workspace" }, 403);
  }

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers });
  const user = userResponse.ok ? await userResponse.json() : null;
  if (!user?.id) return json({ error: "Your session is invalid or expired" }, 401);

  const operation = payload.analysis_type === "resume"
    ? "resume_analysis"
    : payload.analysis_type === "screening"
      ? "screening_reassessment"
      : "pattern_analysis";
  const recordUsage = (status: "started" | "succeeded" | "failed") => fetch(`${supabaseUrl}/rest/v1/ai_usage_events`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ workspace_id: workspaceId, user_id: user.id, operation, status }),
  }).catch(() => null);

  await recordUsage("started");
  const response = await handleAnalysis(request);
  await recordUsage(response.ok ? "succeeded" : "failed");
  return response;
});

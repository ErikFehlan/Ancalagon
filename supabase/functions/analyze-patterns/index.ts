const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "signals", "resume_interview_gaps", "recommended_weight_changes"],
  properties: {
    summary: { type: "string" },
    signals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["criterion", "direction", "confidence", "interpretation", "evidence"],
        properties: {
          criterion: { type: "string" },
          direction: { type: "string", enum: ["positive", "negative", "mixed"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          interpretation: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
        },
      },
    },
    resume_interview_gaps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["candidate_ref", "finding", "evidence"],
        properties: {
          candidate_ref: { type: "string" },
          finding: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
        },
      },
    },
    recommended_weight_changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["criterion", "current_weight", "suggested_weight", "reason"],
        properties: {
          criterion: { type: "string" },
          current_weight: { type: "number", minimum: 0, maximum: 100 },
          suggested_weight: { type: "number", minimum: 0, maximum: 100 },
          reason: { type: "string" },
        },
      },
    },
  },
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return json({ error: "OPENAI_API_KEY is not configured" }, 500);

  try {
    const evidence = await request.json();
    const encoded = JSON.stringify(evidence);
    if (encoded.length > 180_000) return json({ error: "Evidence payload is too large" }, 413);
    if (!evidence?.job?.title) return json({ error: "A job is required" }, 400);

    const instructions = `You are the interpretation layer in a hybrid recruiting calibration system.
The application's deterministic rules and recorded outcomes are the source of truth. Interpret only the supplied evidence.

SAFETY AND FAIRNESS
- Never make a final hiring decision.
- Never infer or use protected or sensitive traits, including race, ethnicity, sex, gender, age, disability, religion, pregnancy, genetic information, nationality, or family status.
- Never infer traits from names, locations, schools, dates, writing style, or other proxies.
- Evaluate job-related evidence only.
- Candidate references are pseudonyms. Do not attempt to identify people.
- Do not invent evidence, candidate facts, outcomes, correlations, or quotes.
- Treat manager feedback as evidence, not unquestionable truth. Flag inconsistent evidence as mixed.

ANALYSIS RULES
- Prefer repeated interview outcomes over isolated comments.
- Use the supplied rule counts and current weights as anchors.
- Confidence must reflect both sample size and consistency.
- With fewer than 3 directional interview decisions, keep confidence at or below 0.45.
- Every signal and recommendation must cite concise evidence from the payload.
- Recommend no weight change when evidence is weak.
- Any proposed criterion must exactly match a criterion in current_weights.
- Suggested weights are advisory; the application requires human approval.`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini",
        instructions,
        input: "Analyze this anonymized recruiting evidence:\n" + encoded,
        text: {
          format: {
            type: "json_schema",
            name: "hiring_pattern_analysis",
            strict: true,
            schema,
          },
        },
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      console.error("OpenAI response error", result?.error?.type, result?.error?.code);
      return json({ error: result?.error?.message || "External model request failed" }, response.status);
    }

    const outputText = result.output_text;
    if (!outputText) return json({ error: "The model returned no structured analysis" }, 502);
    const analysis = JSON.parse(outputText);
    return json({ ...analysis, generated_at: new Date().toISOString(), model: result.model });
  } catch (error) {
    console.error("analyze-patterns failed", error);
    return json({ error: error instanceof Error ? error.message : "Analysis failed" }, 500);
  }
});

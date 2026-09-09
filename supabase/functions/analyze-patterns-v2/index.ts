// Deployed as analyze-patterns-v2, matching the dashboard's configured endpoint.
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

const resumeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "role", "score", "recommendation", "primary_signal", "strengths", "concerns", "tags", "screening_questions"],
  properties: {
    name: { type: "string" },
    role: { type: "string" },
    score: { type: "number", minimum: 0, maximum: 10 },
    recommendation: {
      type: "string",
      enum: ["Interview", "Strong Consideration", "Consider", "Screen First", "Not Recommended"],
    },
    primary_signal: { type: "string" },
    strengths: { type: "array", items: { type: "string" }, maxItems: 8 },
    concerns: { type: "array", items: { type: "string" }, maxItems: 6 },
    tags: { type: "array", items: { type: "string" }, maxItems: 8 },
    screening_questions: { type: "array", items: { type: "string" }, maxItems: 6 },
  },
};

const screeningSchema = {
  type: "object",
  additionalProperties: false,
  required: ["jd_score", "manager_score", "confidence", "summary", "jd_reason", "manager_reason"],
  properties: {
    jd_score: { type: "number", minimum: 0, maximum: 10 },
    manager_score: { type: "number", minimum: 0, maximum: 10 },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    summary: { type: "string" },
    jd_reason: { type: "string" },
    manager_reason: { type: "string" },
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
    const isResumeAnalysis = evidence?.analysis_type === "resume";
    const isScreeningAnalysis = evidence?.analysis_type === "screening";
    if (isResumeAnalysis && !evidence?.resume_text?.trim()) {
      return json({ error: "Resume text is required" }, 400);
    }
    if (isScreeningAnalysis && !evidence?.screening?.notes?.trim()) {
      return json({ error: "Screening notes are required" }, 400);
    }

    const instructions = isResumeAnalysis ? `You evaluate a resume against one specific job using only the supplied job-related evidence.
Return a recruiter-facing assessment that helps a human decide what to investigate next.

SAFETY AND FAIRNESS
- Never make a final hiring decision.
- Never infer or use protected or sensitive traits, including race, ethnicity, sex, gender, age, disability, religion, pregnancy, genetic information, nationality, or family status.
- Ignore names, addresses, graduation dates, and other demographic proxies when scoring.
- Do not invent qualifications. Treat missing resume evidence as unknown, not as proof that the candidate lacks a skill.
- Use job criteria, manager calibration, knockout rules, anonymized benchmarks, and evaluation_reviews only as job-related context.
- Treat evaluation_reviews as human corrections from prior candidates for this same job. Apply repeated lessons, but do not copy a prior candidate's score onto the current resume.
- A correction note must be supported by current-resume evidence before it changes the score.
- Prefer consistent corrections and recorded outcomes over a single review.

SCORING
- Score from 0 to 10 based on evidence in the resume.
- Distinguish must-have evidence from preferred experience.
- Keep strengths and concerns concise and evidence-based.
- Concerns must identify missing or unclear evidence, not personal judgments.
- Screening questions should resolve the most important uncertainties.
- Extract the candidate name and current/recent professional role from the resume when clearly stated; otherwise use "Candidate" and the target job title.
- Tags should be short, job-related skills or domains.` : isScreeningAnalysis ? `You reassess one candidate after a recruiter screening conversation.
Use the supplied screening notes only as new job-related evidence and preserve the resume assessment as the baseline.

SAFETY AND FAIRNESS
- Never make a final hiring decision.
- Ignore and do not infer protected or sensitive traits or demographic proxies.
- Do not use personal similarity or vague affinity as culture fit.
- Interpret culture/working-style fit only through job-related communication, collaboration, motivation, ownership, and documented work preferences.
- Do not invent qualifications. Treat unsupported or missing information as unknown.

SCORING
- Adjust JD Fit only when the notes confirm, weaken, or contradict job qualifications.
- Adjust Manager Fit only when notes address documented manager priorities or relevant working style.
- Keep changes proportional. The selector answers are context, not evidence by themselves.
- If notes do not support a change, keep that score unchanged.
- Explain each score concisely and state uncertainty.
- Confidence reflects the specificity of the screening evidence, not confidence in a hiring decision.` : `You are the interpretation layer in a hybrid recruiting calibration system.
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
        input: (isResumeAnalysis ? "Evaluate this resume and job evidence:\n" : isScreeningAnalysis ? "Reassess this candidate using the screening evidence:\n" : "Analyze this anonymized recruiting evidence:\n") + encoded,
        text: {
          format: {
            type: "json_schema",
            name: isResumeAnalysis ? "resume_evaluation" : isScreeningAnalysis ? "screening_reassessment" : "hiring_pattern_analysis",
            strict: true,
            schema: isResumeAnalysis ? resumeSchema : isScreeningAnalysis ? screeningSchema : schema,
          },
        },
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      console.error("OpenAI response error", result?.error?.type, result?.error?.code);
      return json({ error: result?.error?.message || "External model request failed" }, response.status);
    }

    const outputText = result.output_text || result.output
      ?.flatMap((item: { content?: Array<{ type?: string; text?: string }> }) => item.content || [])
      .find((item: { type?: string; text?: string }) => item.type === "output_text")
      ?.text;
    if (!outputText) return json({ error: "The model returned no structured analysis" }, 502);
    const analysis = JSON.parse(outputText);
    return json({ ...analysis, generated_at: new Date().toISOString(), model: result.model });
  } catch (error) {
    console.error("analyze-patterns failed", error);
    return json({ error: error instanceof Error ? error.message : "Analysis failed" }, 500);
  }
});

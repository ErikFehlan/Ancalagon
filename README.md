# Ancalagon

Recruiting intelligence dashboard with job-scoped candidates, benchmarks, manager feedback,
interview outcomes, deterministic calibration, and an optional external-model interpretation layer.

## Hybrid Pattern Engine

The local rules engine remains the evidence and scoring layer. The optional Supabase Edge Function
interprets anonymized, job-related evidence with an external model. Model recommendations never
change weights automatically; each proposed change requires explicit approval in the interface.

### Deploy the Edge Function

1. Install and authenticate the Supabase CLI.
2. Link this repository to the Supabase project:
   `supabase link --project-ref YOUR_PROJECT_REF`
3. Configure secrets:
   `supabase secrets set OPENAI_API_KEY=YOUR_KEY OPENAI_MODEL=gpt-4.1-mini`
4. Deploy:
   `supabase functions deploy analyze-patterns`
5. In Ancalagon Settings, enter:
   - `https://YOUR_PROJECT_REF.supabase.co/functions/v1/analyze-patterns`
   - The project's public anon/publishable key

The OpenAI key must remain in Supabase Secrets. Never place it in `index.html` or GitHub Pages.

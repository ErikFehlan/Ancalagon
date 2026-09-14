# AI processing latency upgrade

## Changes

- A committed criteria save sends a pg_net notification containing only the job ID. The task is immediately eligible; the worker claims that specific job. Cron remains the fallback for missed notifications, crashes and retries.
- Unchanged saves do not dispatch. Existing revision/lease checks and the three-attempt limit remain. Dispatch errors cannot roll back a recruiting save.
- Active pending results are fetched every two seconds instead of ten. Completed results use a thirty-second interval; changing inputs or jobs bypasses the prior polling timestamp.
- Feedback interpretation requests only a short summary and optional clarification question (700 output-token cap). It retains the supplied scoped context and uses the existing model configuration. It no longer requests discarded scores or repeats the job and candidate payload.
- Note saving and AI interpretation overlap. The draft appears when AI returns, with a saving indicator until persistence succeeds. The pending-save guard remains active. Failures retain the original note and draft; outdated results are not applied.
- Independent user and workspace checks overlap. Both must pass before analysis. Usage logging runs in the Edge Function background and still records started then succeeded/failed.

## Deploy

The existing `criteria-backend` GitHub environment holds the deployment secret and project reference. No new credentials are needed. After branch validation, publish the `Deploy faster AI processing` manual workflow to main pinned to the tested release, then run it. It deploys the compatible worker, applies only the new migration, deploys both analysis endpoints, checks worker configuration, and verifies pg_net transport using a health request.

Promote the frontend after this backend run succeeds. The updated analysis handler recognizes older clients' feedback requests as well. No existing job or candidate data is changed to perform a smoke test.

## Validation and practical limits

Node tests cover scoped input snapshots, original wording and polling behavior. Browser tests simulate a slow save and failed save, verify early draft display and persistence recovery, and exercise the full recruiter journey. Deno tests inspect actual outbound model requests and authorization sequencing with fake network responses. PostgreSQL tests cover immediate eligibility, dispatch on changes only, per-job claims, stale-result rejection, transaction rollback and dispatch-failure fallback.

These tests demonstrate removed waiting and unnecessary output. They are not a live OpenAI latency benchmark. Total time still depends on input size, model response time, connection latency and service limits. Before/after measurements should use equivalent synthetic inputs on the live project; report model time separately from save-to-display time.

## Pause / rollback

Set Vault's `criteria_worker_url` to an empty value to pause immediate dispatch; leave the existing scheduler active. The trigger ignores empty/missing configuration. Restore the prior frontend if needed. Keep the compatible per-job claim function while the new worker is deployed. Do not rerun the old criteria activation release to downgrade the worker while immediate dispatch is enabled.

References: [Supabase pg_net](https://supabase.com/docs/guides/database/extensions/pg_net) and [OpenAI latency guidance](https://developers.openai.com/api/docs/guides/latency-optimization).

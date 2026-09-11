# Automatic criteria refinement — release and activation

First milestone only: job save → durable queue → polished criteria and screening questions. Candidate re-evaluation, feedback interpretation, outcomes, and submission drafts are not yet chained into this queue.

## State of the release

Supabase deployment credentials were unavailable during implementation. Publishing the source is not backend activation. Keep the release on its validation branch until backend validation and activation are complete. The existing live app remains unchanged until promotion.

## Activation through GitHub (no PowerShell)

1. Create the GitHub environment `criteria-backend`. Add environment secret `SUPABASE_ACCESS_TOKEN` (an authorized Supabase management token) and environment variable `SUPABASE_PROJECT_REF` (`zqiqjzxcpznhzjengfff` for the current project). Enter secrets in GitHub settings, never in source code or chat.
2. Confirm `OPENAI_API_KEY` exists in Supabase Edge Function secrets. Optional `CRITERIA_MODEL` defaults to `gpt-4.1-mini`. This release does not change the model used by other functions.
3. Once validation passes, run `Activate criteria automation backend` for the release branch. If GitHub requires the manual workflow to exist on the default branch first, merge only the backend workflow and scripts through a reviewed change, then dispatch it against the release branch. Do not enable the frontend before the backend check succeeds.
4. The workflow applies only the additive criteria migration (not earlier manually applied migrations), stores a newly generated worker credential in Edge secrets and Vault, deploys `refine-job-criteria`, checks configuration, and schedules it every minute. It does not backfill all historical jobs or rewrite original criteria.
5. Save a changed criterion on a dedicated test job. Close the browser. Reopen after processing and verify Evaluation Criteria shows the polished result, threshold, original input, and question. Verify Use original wording and changing criteria during processing. A clean application test run is not a live-model quality test.
6. Promote the tested frontend to main and verify Pages deployment.

## Behavior and bounds

One task row per job, ten-second debounce, one claimed job per worker invocation, three attempts maximum, a three-minute lease, and revision plus lease checks at completion. A crashed worker is reclaimable. New source changes reset the task; unchanged saves do not repeatedly spend AI tokens. Default scheduler throughput is approximately one job/minute; this is a beta configuration, not a scaling target.

Original criteria remain canonical for scoring and editing. Polished labels are displayed for matching criteria and generated questions join candidate screening questions. Priority is inferred from explicit wording with Unspecified as the fallback. Numerical thresholds and negation are checked; semantic fidelity still requires live examples. No candidate scores, hiring decisions, or shared preferences are changed by this worker.

Tasks with more than 40 criteria or oversized input need attention rather than unbounded requests. Rate limits and network failures retry; failures leave original criteria usable. Failed tasks reset on a relevant source edit. Client polling reads results only while the page is visible; processing continues independently on the server.

## Rollback / pause

Pause `ancalagon-criteria-worker` in Supabase Cron to stop new worker invocations. Original criteria remain untouched. Reverting the frontend is safe; do not drop the queue while in-flight work needs inspection. Disable/rotate the worker credential if compromised. Restrict Vault access to backend administrators.

## Validation boundaries

Node tests cover output validation and source matching. PostgreSQL integration tests cover enqueue/debounce, exclusive claim, stale result rejection, unchanged-save behavior, retries, permissions, and deletion cleanup. Deno checks worker types. Browser tests use simulated auth and AI. Actual scheduler execution, live AI wording quality, and worker secrets require the activation smoke test above.

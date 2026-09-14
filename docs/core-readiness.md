# Core phase: release review

Prepared on 2026-09-14 against `ErikFehlan/Ancalagon` main commit `9b5b8e7d405d93301ad2183fb441c6b28f1aa95c`.

Status: implemented locally; not uploaded, deployed, or verified in production.

## What changes for recruiters

- Uploading a readable PDF, DOCX, or TXT saves the candidate and source before requesting an assessment. Retrying an interrupted save recovers the same record and document when the first write already committed.
- Saved resumes enter a durable Supabase queue. Processing and bounded retries can continue after the browser closes. Returning to the application retrieves the saved proposal.
- Changes to job requirements and relevant feedback invalidate outdated proposals. Candidate-specific notes stay scoped to that candidate; only approved preferences are shared across the job.
- Resume and reassessment quotations must match their supplied sources. Generated resume commentary is no longer presented to the model as a recruiter correction. Missing evidence cannot produce a nonzero resume score without supporting quotations.
- Scores remain provisional until the existing review action. Approval updates the candidate and assessment in one database transaction, preserves the submission draft, and rejects stale evidence. Repeating an approval after a lost response returns current records without replaying old scores.
- Resume access checks the workspace, job, and candidate relationship. Both public analysis URLs require an authenticated workspace member; the scheduled worker requires its private credential.

Extraction still needs the browser until the document is saved. Unreadable or image-only files need a readable replacement; this release does not add OCR. Quote matching establishes that words occur in a source, not that every model inference is correct.

## Review map

| Area | Main files |
| --- | --- |
| Durable intake and atomic approval | `supabase/migrations/20260915090000_core_intake.sql` |
| Worker processing and grounded reassessment | `supabase/functions/reassess-job/handler.ts`, `intake.mjs`, `logic.mjs` |
| Authenticated analysis | `supabase/functions/analyze-patterns-v2/index.ts`, `analysis.ts`, `supabase/functions/analyze-patterns-beta/handler.ts` |
| Upload, recovery, and live proposal updates | `assets/resume-intake.js`, `assets/resume-remote.js`, `assets/data.js`, `assets/app.js` |
| Feedback context and AI benchmark | `assets/context.js`, `assets/quality.js`, `docs/ai-quality-benchmark.md` |
| Deployment gates | `.github/workflows/deploy-pages.yml`, `core-backend.yml`, `criteria-validation.yml` |
| Regression coverage | `tests/core-intake.test.js`, `core-intake.sql`, `core-browser.cjs`, updated data and handler tests |
| Real integration checks | `scripts/core-live-smoke.mjs` |

The analysis engine moves out of the public HTTP entry point into `analysis.ts` so authenticated requests and the private worker share the same implementation.

## Verification completed locally

| Check | Result |
| --- | --- |
| Application tests: `node --test tests/*.test.js` | 78 passed |
| Auth, feedback, resume validation, and worker handler tests | 7 passed using Node 24's TypeScript runtime with a minimal Deno test shim |
| Changed JavaScript syntax checks | Passed |
| Workflow YAML parsing | Passed |
| Git whitespace/error check | Passed |

The handler runtime check is not a Deno type check. Mocked tests do not establish production database permissions or live AI quality.

## Required checks still pending

- Deno type checking and native Deno tests.
- PostgreSQL queue, revision, concurrency, approval, and permission tests.
- Chromium recruiter journeys, including restoring durable intake after reload.
- Live integration: two disposable password accounts, workspace and document isolation, protected analysis routes, browser-independent processing, grounded quotations, atomic approval, and reload persistence.
- A live run and recruiter review of the expanded 20-scenario AI benchmark. Its 40 AI requests are separately initiated from the admin benchmark screen; no hiring-accuracy claim is established by the local tests.

PostgreSQL, Deno, and a Chromium executable are unavailable in this workspace. These automated integration checks are configured in GitHub. Publication was blocked before any remote code changes or workflow runs occurred.

## Deployment behavior

1. Publish these code changes to a review branch in the existing public repository and run pull-request validation.
2. When approved changes reach `main`, validation runs before backend deployment. The existing deployment environment supplies the Supabase access token and project reference.
3. Install the additive queue migration, deploy the authenticated analysis handlers and worker, and verify the scheduler transport.
4. Run the live integration check. It creates two randomly named synthetic accounts without sending email, performs real authentication and isolated test operations, and removes its own documents and accounts in a cleanup block. It makes a small number of paid AI requests; retries may add requests. Credentials are kept in the runner process and are not printed.
5. Publish GitHub Pages only after those gates pass. Verify the deployed assets and recruiter flow afterward.

New clients opt into durable intake with `backend: durable-v1`; the direct authenticated path remains compatible with older open tabs during rollout. The previous automatic resume and reassessment deployment workflows become manual-only to avoid racing the consolidated release.

Backend deployment precedes live integration checks and frontend publication. A failed live check blocks the new frontend but does not automatically roll back already deployed backend functions. Preserve the additive database migration if a code rollback is required; do not drop saved queue results or document records.

## Publication blocker

Automatic approval review rejected uploading this code to the public repository twice. Repository identity and write access were verified as Erik Fehlan's `ErikFehlan/Ancalagon`; the second rejection still required explicit approval of the exact code and deployment payload. No alternate upload route was attempted after that rejection.

The proposed upload contains application source, migrations, synthetic tests, workflows, and documentation. It does not include user resumes, production recruiting records, passwords, or access tokens. Publishing this patch makes its source code public and enables the described deployment workflow when it reaches `main`.

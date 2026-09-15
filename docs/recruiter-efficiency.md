# Phase 2: recruiter efficiency

Continues the agreed three-pass plan: dependable core, recruiter efficiency, paid operation. Based on main commit `79dc20f05a7dbe48672798b6cd2db57286e5e2e1`.

## Recruiter workflow

- Home tracks four steps from saved workspace records: create a job, add resumes, review an assessment, and add what was learned. It retains the last working location, identifies ready and failed assessments, and shows background processing. Setup never blocks existing work.
- The file picker and drop zone accept up to 20 resumes at once, up to 10 MB each and 100 MB total. Reading and saving are serialized to bound browser memory. Each saved source enters the existing durable assessment queue immediately.
- Each file has its own progress and retry. A failed file does not stop the remaining files. Identical resume contents for the same job reuse the existing candidate. Switching jobs while a batch is running does not move its candidates to another search.
- Bulk upload stays on the current screen. The candidate list offers one next review action; the existing approve-and-next flow advances through ready assessments. Notes, evidence expansion, and submission drafts retain the existing protection.
- Active, Closed, and All job filters plus title/client search keep the job list manageable. Closed jobs leave the active selector unless currently viewed. Closing retains history and pauses pending assessments; reopening restarts intake status retrieval and refreshes the review queue. The existing Hired-to-closed behavior remains in place.
- Intake status reads are batched in groups of 100 IDs. Full proposals are fetched only when a new ready revision is encountered. Updates from one poll use one persistence call and one UI refresh, rather than one per candidate. Hidden pages are refreshed when opened.

The browser must remain open until source files finish saving. Failed, unsaved files remain in memory for retry, with an unload warning and a sign-out check. Removing a failed file from the upload queue does not delete any candidate already created. Saved assessments can continue in Supabase after the tab closes.

## Validation

Local validation: all 88 application tests passed, all eight browser journeys passed, all application JavaScript syntax checks passed, and `git diff --check` passed. Browser checks use synthetic records and mocked service adapters.

Run `node --test tests/*.test.js` and the browser journeys in `.github/workflows/deploy-pages.yml`.

`tests/recruiter-workflow.test.js` checks file failure isolation, retry scope, duplicate recovery, limits, account changes during extraction, authoritative Home status, and batched request counts. For 20 processing candidates, a poll makes one status read, no full-result reads, one save, and one UI refresh; an unchanged second poll does not save or rerender.

`tests/recruiter-browser.cjs` exercises a four-file batch with an identical resume and an interrupted upload, recovery without duplicate candidates, three approvals in sequence, active/closed search filters, reopening without losing candidates, and mobile layout. Existing Home, durable-intake, and focused-editor journeys remain release gates.

These are synthetic automated checks. They do not establish actual recruiter time savings or independent usability acceptance.

## Recruiter acceptance exercise

Before calling the Phase 2 completion target proven, have independent beta recruiters complete this with little help:

1. Start from an empty workspace and create a real search.
2. Upload several consented resumes, resolve any failed file, and confirm progress after returning to the app.
3. Review the evidence, approve successive assessments, add a short screening note, and prepare a submission summary.
4. Close the search and reopen it, confirming its candidates and feedback remain accessible.
5. Record total time, assistance needed, clicks that felt unnecessary, and comparison with their current process.

## Release scope

The patch uses the already deployed core queue, permissions, and lifecycle schema. It adds no migration or model change. Pull-request validation includes the new browser journey. Merging into main uses the existing gated backend and Pages release workflow; this review branch itself does not publish the application.

## Current delivery status

Implementation and local verification are complete. On September 15, 2026, Erik explicitly approved uploading this Phase 2 code to the public `ErikFehlan/Ancalagon` repository as a review branch.

The approved publication consists of the changed application assets, HTML, tests, one validation-workflow update, and this document. It contains no production resumes or recruiting records and introduces no credentials. Existing public Supabase client configuration is unchanged.

The review branch is `phase-2-recruiter-efficiency`, targeting `main`. The application stays on its current release until the pull request is merged and its deployment gates pass.

# Guided practice tutorial

The approved tutorial replaces the static Learn Ancalagon guide with five small exercises: set up a sample search, add a batch of resumes, inspect source evidence, review a screening note and assessment proposal, and save a candidate submission draft. Home offers Start practice or Resume practice. The final action opens a blank real job form.

Practice uses fixed fictional candidates. It does not call an AI engine, upload documents, insert jobs/candidates/feedback, or change the last real job bookmark. Scores use the application's 0–10 scale. Editing the sample note or interpretation preserves the wording and keeps example scores unchanged rather than inventing an assessment. Quick answers cover scores, notes, upload recovery, reusable manager preferences, and closing/reopening searches.

Progress, editable sample fields, and the draft are stored in the signed-in user's workspace_home row, protected by its existing user-and-workspace RLS. No tutorial data is written to browser storage. Saves are serialized, use a revision check, recover a lost successful response, and show retry/conflict errors without silently replacing another tab's progress. Pending changes participate in sign-out flushing and the close-page warning.

Deployment runs the additive 20260915110000_guided_tutorial.sql migration after the existing Home migration and before Pages publication. Existing bookmark columns and policies are preserved. Reverting the frontend can leave the unused tutorial columns in place.

Validation includes the existing app suite, tutorial state/sync/data-service tests, workspace_home database permission checks, and a browser journey for all five steps, fresh-context resume, account isolation, save recovery, real-job handoff, and 320px/390px layouts. CI retains fictional tutorial screenshots for review.

Approved direction: Erik requested implementation of the reviewed concept (“I like that. Let's use it”).

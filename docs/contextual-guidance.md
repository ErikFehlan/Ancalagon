# Contextual guidance and recruiter review

Guidance appears alongside real candidate reviews, feedback, approval, and submission preparation. Each tip can be dismissed or reopened. Completing a relevant review retires its tip; copying a submission retires that tip. There is no fixed 30-day cutoff. Settings can hide automatic tips or restore them. Missing evidence remains identified as uncertainty after educational guidance is dismissed.

Preferences live in the signed-in user's workspace_home row, under its existing user/workspace RLS. The small guidance_state column holds only enabled and known tip states, never candidate information. The update_contextual_guidance invoker RPC atomically changes one preference, so different tabs cannot overwrite unrelated dismissals. Failed saves leave the previous preference active and offer retry. Controllers discard late responses after sign-out. No guidance preferences are stored in browser storage.

Accept interpretation records that the recruiter reviewed the AI wording. The AI source and original note remain unchanged, and acceptance adds no new scoring evidence. Correct interpretation retains the original note and records a recruiter clarification for a new assessment proposal. A failed review save retains the visible correction for retry. Both actions apply only to that feedback item; reusable manager preferences retain their separate approval path.

Assessment panels explain what approval saves, how Keep current assessment behaves, and that candidate stage and other candidates stay unchanged. Evidence remains expandable, questions remain visible, and approved candidate briefs offer a Why this assessment? explanation. Guidance does not approve or reject a candidate, send a submission, or bypass stale-evidence checks.

The normal release pipeline installs the additive guidance migration through workspace-home-backend before publishing Pages. Existing tutorial progress and navigation bookmarks are unchanged. A frontend rollback can leave the unused column and RPC in place.

Validation covers guidance save/retry and session disposal, accepted-versus-corrected evidence signatures, database user/workspace isolation and migration reapplication, and the browser recruiter journey with guidance dismissal/reopening, failed and successful interpretation review, preserved original notes and scores, and narrow layouts.

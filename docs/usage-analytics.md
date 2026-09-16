# Usage analytics

Usage Analytics loads on workspace initialization and on **Refresh**. No polling or window-focus refresh runs. The response timestamp is shown, and a failed refresh preserves the previous values with a stale-data message. Access remains restricted to application admins.

## Definitions

- **Accounts:** current authentication accounts, including admin/test accounts that still exist.
- **Active users:** accounts with a server-confirmed sign-in or recorded human activity in the labeled 7/30-day window. Background processing alone does not mark an account active.
- **Sessions:** distinct account + page-session identities in the last 30 days. These are workspace loads, not minutes online or authentication-token refreshes.
- **Events:** navigation, committed work, edits, AI completions, terminal processing failures, and assessment review decisions. Opening or refreshing analytics does not create an event.
- **Tester Activity:** all-time recorded totals for each account. Jobs/candidates/notes/outcomes count committed new records once, not updates. Notes include manager/recruiter feedback and screening notes.
- **AI completed:** completed resume analyses, candidate reassessments, criteria refinement, direct screening/feedback interpretation, and hiring-pattern analysis. Retries and approval of an existing result do not add another completion. Empty criteria do not call AI and are excluded. These are product operations, not provider token/cost billing totals.
- **Feature Activity:** recorded events in the last 30 days. Processing failures appear separately from completions. AI quality-check requests use the same AI service and therefore count as completed AI operations.

## Recording and history

`product_usage_events` is written by database triggers in the same transaction as saved records or accepted worker results. It stores identifiers, event type, time, and source identity only. It never stores resumes, notes, or generated text. Entity IDs do not cascade from deleted jobs/candidates, so deleting a business record does not undo historical usage; account/workspace deletion still removes its telemetry.

Worker operations receive a stable run identity and initiating user when queued. Retries retain the identity; new versions receive a new one. Service-only direct AI telemetry retries the same request/status identity after transport failures and is converted into the same product ledger. Exhausted telemetry retries log a generic operational error. Browser form-submit events are excluded and blocked; only session/job-navigation events remain client-reported.

Deployment installs compatible recording first, deploys the server-writing handlers, then activates the stricter write permissions. This allows the older handler to continue recording during the rollout. A final read-only coverage check compares retained business records and completed tasks against the ledger.

The first migration recovers record creation and retained task/direct-AI results. Historical background work is attributed to the record creator when its original initiator is unknown. Deleted records, overwritten task versions, and old telemetry that was never persisted cannot be reconstructed. The dashboard states this limitation and the confirmed-tracking start date. Reapplying the migration does not re-import or duplicate history.

Verification covers rolled-back saves, uploads and manual candidates, retry idempotency, worker completions without an open browser, collaborator attribution, date windows, completed/failed separation, permission boundaries, deletion retention, and repeated migration deployment.

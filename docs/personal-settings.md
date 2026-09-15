# Personal settings and account controls

Profile, workflow defaults, text size, spacing, reduced motion, and notification choices are private `user_settings` records. Explicit saves use a revision check; failed saves keep the draft, and stale tabs require reloading saved preferences. No profile or recruiting records are stored in browser storage. Appearance continues to use the existing device theme preference.

Workflow preferences affect the initial landing page, the candidate list sort, and closed-job visibility. Rankings retain their existing score order. Dates use the selected IANA time zone. Reduced motion also respects the operating system preference.

Processing triggers record one private notification per task revision and outcome for each workspace member who has that category enabled. Notification preferences apply to new events. Existing workflow errors and required reviews remain visible. Reports submitted from Settings are stored privately; application admins use the guarded Support Inbox in Admin Tools to review their status. No email or browser push service is implied.

Account export is a single database snapshot of the caller's profile, settings, personal activity, and accessible workspace records. It excludes other users' private preferences, reports, and admin resources. Original resumes are separate downloads enforced by the existing Storage RLS policies.

Account deletion requires the current password and explicit confirmation. The server verifies the bearer token with Auth, independently verifies the password for that identity, and queues only that user's deletion. An account owning a shared workspace or files outside its private workspace must resolve that ownership first. Enqueuing serializes against ownership/membership changes and locks its private workspaces through the existing access predicates. A durable, service-only lease controls Storage API cleanup before Auth deletion. Auth deletion cascades application data and memberships; another workspace's records survive.

The account endpoint attempts cleanup immediately. The existing authenticated reassessment scheduler retries incomplete deletion requests after their three-minute lease expires. Failed or ambiguous Storage/Auth responses leave the request pending. Pending users see a deletion-in-progress message when they sign in. No SQL deletes Storage metadata. The queue is removed after Auth confirms removal; no account passwords or tokens are stored in the queue or reports. Supabase backups and independently downloaded copies are outside the in-app removal process.

Global sign-out revokes sign-in sessions; existing access tokens may remain valid until expiry, as explained in the UI. Account switches reload the app to prevent controller caches from carrying across identities.

Deployment: `scripts/account-controls-backend.mjs` installs the two additive migrations after core processing tables exist. The core release then deploys `account-controls` and the updated scheduler worker before Pages publication. The normal release pipeline remains the gate. Node, SQL, handler/cleanup, and browser tests use synthetic data; no production account is deleted for validation.

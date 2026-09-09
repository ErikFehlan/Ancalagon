# Beta data persistence

The beta branch stores each account's recruiting data in its authenticated Supabase workspace. Row-level security prevents members of one workspace from reading or changing another workspace.

## Account initialization

Every newly created account starts with an empty Supabase workspace. Ancalagon never imports browser data into a new account, preventing records from one tester or an older prototype from being attached to another tester's workspace.

The original owner's previously migrated recruiting data remains in the original Supabase workspace.

## Deploy the authenticated beta AI function

From the repository on `beta/multi-user`:

```powershell
npx.cmd supabase@latest functions deploy analyze-patterns-beta --project-ref zqiqjzxcpznhzjengfff
```

The beta endpoint verifies the signed-in user's workspace membership before invoking OpenAI and records minimal usage status events. It does not alter the existing `analyze-patterns-v2` production endpoint.

## Acceptance test

Use two invited email accounts.

1. Sign in as the owner and confirm the existing jobs and candidates load from Supabase.
2. Refresh and confirm that the same jobs and candidates return.
3. Add a temporary job, candidate, feedback item, benchmark, and interview outcome; refresh after each save.
4. Upload a test resume and confirm a private object appears in the `resumes` storage bucket.
5. Run resume analysis and confirm rows appear in `ai_usage_events`.
6. Sign in as the second tester in a private browser window.
7. Confirm that the second tester starts with an empty workspace and cannot see the owner's records.
8. Create a record as the second tester, then return to the owner account and confirm it is absent.

Supabase is the sole source of truth after authentication. Recruiting records and Pattern Engine results are not cached in browser storage. The browser retains only the Supabase login session and the user's visual theme preference.

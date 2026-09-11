# Live integration checks

Status: prepared, not executed against live accounts. No credentials were available during implementation. Browser regression tests simulate auth and AI and must not be reported as live validation.

Create two dedicated beta test accounts with exactly one separate workspace each. Use no personal or tester production passwords. Configure GitHub repository variables LIVE_APP_URL and LIVE_SUPABASE_URL; configure secrets LIVE_SUPABASE_ANON_KEY, LIVE_USER_A_EMAIL, LIVE_USER_A_PASSWORD, LIVE_USER_B_EMAIL, LIVE_USER_B_PASSWORD. Use the public Supabase anon key, never a service-role key: these checks must exercise row-level security.

Run Actions → Live account integration checks → Run workflow. The opt-in test uses real password authentication, creates UUID-named synthetic jobs with a candidate and feedback, tests account isolation for reads/updates/deletes, opens each account in a separate browser context, checks a clean refresh and sign-out, and deletes only its own synthetic jobs in cleanup. Test sessions create normal usage analytics. If interrupted, delete remaining “Synthetic integration” jobs from these dedicated accounts.

This does not validate password recovery email delivery, real model judgment, every table's policies, or physical cross-device use. Verify password recovery manually and repeat a saved candidate workflow on a second physical device. Do not interpret missing credentials as a passing test. Do not add unredacted browser traces to public CI artifacts.

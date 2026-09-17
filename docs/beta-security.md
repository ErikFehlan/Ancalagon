# Closed-beta security controls

This release supports a small, approved beta. It is not a penetration-test certification or an unrestricted public launch.

## Access

Open **Admin → Beta access and security**, enter an email, and choose **Approve beta access**. This records approval; it does not send an invitation. The tester uses Create account with that exact email, a password of at least 12 characters, and verifies the confirmation email. Sign-in with an existing password remains compatible.

Existing accounts are preserved once at installation. Review that list in Admin. Revocation is stored against the Auth user ID and blocks new workspace/storage requests and AI admission, including requests using an existing JWT. Previously downloaded information and model calls already in flight cannot be recalled. Account deletion still works through the password-confirmed endpoint.

Both an Auth before-create hook and a database trigger enforce approval. User metadata cannot grant access. Administrators are bound to their existing Auth user ID, not a claimed email. Re-running migrations does not restore revoked approval.

## Resource limits

Every actual provider call, including validation retries, fallback models, criteria polishing and background assessments, reserves capacity before contacting the provider. Budget checks fail closed on errors. Reservations are conservative and are not refunded after failures or ambiguous network responses.

Defaults:

| Resource | Limit |
| --- | --- |
| AI calls per account and per workspace | 20/minute, 200/UTC day |
| AI calls across the application | 1,000/UTC day, 10,000/UTC month |
| Reserved AI input across the application | 20 MB/UTC day, including a conservative prompt/schema allowance |
| Reserved AI output across the application | 2 million tokens/UTC day |
| Original resumes | 100 files/workspace, 1,000/application, 10 MiB/file |
| Jobs / candidates per workspace | 100 / 1,000 |
| Document metadata per workspace | 100 |
| Assessments, feedback, outcomes and screening records | 5,000 each/workspace |
| Individual application record | 1 MB |

Admins can pause or resume all new AI calls. Limits are server-owned in `security_limits`; the browser cannot change counters or grant itself credits. These are usage caps, not a dollar-denominated billing guarantee. Provider pricing and model configuration still matter. The fixed upload-count limit bounds storage even when upload size metadata is missing. Existing records are retained when a workspace reaches a cap.

The page pins and integrity-checks its Supabase browser dependency, blocks inline script execution with a Content Security Policy, and escapes user/model strings in candidate and job displays.

## Deployment and verification

The consolidated deployment installs the migration, enables email confirmation and the signup hook, deploys every AI handler, verifies live Auth configuration, and runs disposable account checks before publishing Pages. Older manual backend workflows delegate to this same path.

SQL tests cover approval, identity spoofing, unverified accounts, revoked sessions, storage writes, record limits, and budget caps. A separate PostgreSQL test runs 12 concurrent transactions against 3 available AI calls. Handler tests verify that denied or unavailable budget checks cannot reach the provider. Browser tests exercise approval, revocation and the AI pause control.

Live checks use randomly named synthetic accounts. They verify both public AI routes deny exhausted budgets, non-admins cannot change security controls, and revocation affects an existing session. They do not send confirmation email or call a model. The normal core integration check still exercises a small number of real model calls.

## Remaining operational checks

- Confirm a custom SMTP provider is configured and test confirmation/recovery delivery with a tester. Supabase's default email service has recipient/delivery restrictions; API tests cannot prove inbox delivery.
- CAPTCHA is not configured by this release. A provider site key and secret are needed. The deployed signup admission gate instead restricts registration to individually approved emails. Add CAPTCHA before moving to broad self-service signup.
- Validate backup recovery and commission an independent security review before a wider launch involving substantial candidate data.
- Training stays inactive. These changes do not authorize model training or change billing/payment features.

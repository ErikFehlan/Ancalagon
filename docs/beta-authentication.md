# Beta authentication

Ancalagon's beta uses Supabase passwordless email links. Accounts must be invited or created by an administrator; the sign-in form does not create new users.

## Configure a test URL

In Supabase, open **Authentication > URL Configuration**.

- Set **Site URL** to the deployed beta URL when one exists.
- Add every allowed test address under **Redirect URLs**.
- For local testing, add `http://localhost:4173/**`.

## Create the first tester

In Supabase, open **Authentication > Users**, select **Add user**, and choose **Send invitation**. Enter the tester's email address.

The database trigger automatically creates a private workspace and makes that user its owner. No manual database row is required.

## Run locally

From the repository folder:

```powershell
npx.cmd serve . -l 4173
```

Open `http://localhost:4173`, enter the invited address, and use the secure link delivered by email. Keep the local server running while opening the link.

## Expected checks

1. An unrecognized email cannot register through the app.
2. An invited tester can request a link and enter the app.
3. Refreshing restores the tester's session.
4. The header shows the tester's email and private workspace.
5. Signing out returns to the access screen.

Jobs and candidates remain in browser storage during this authentication slice. Moving them into the workspace-scoped Supabase tables is the next implementation phase.

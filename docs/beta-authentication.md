# Beta authentication

Ancalagon's beta uses Supabase email-and-password authentication. Accounts must be invited or created by an administrator; the sign-in form does not create new users and normal sign-in sends no email.

## Configure a test URL

In Supabase, open **Authentication > URL Configuration**.

- Set **Site URL** to the deployed beta URL when one exists.
- Add every allowed test address under **Redirect URLs**.
- For local testing, add `http://localhost:4173/**`.

## Create the first tester

In Supabase, open **Authentication > Users**, select **Add user**, and create the tester with an email and temporary password. Keep automatic public signup disabled.

The database trigger automatically creates a private workspace and makes that user its owner. No manual database row is required.

## Run locally

From the repository folder:

```powershell
npx.cmd serve . -l 4173
```

Open `http://localhost:4173`, then enter the tester's email and password.

An existing tester who previously used magic links can open their latest valid link one final time, go to **Settings > Account Security**, and set a password. Future sign-ins will not require an email.

## Expected checks

1. An unrecognized email cannot register through the app.
2. An invited tester can sign in with an email and password.
3. Refreshing restores the tester's session.
4. The header shows the tester's email and private workspace.
5. Signing out returns to the access screen.

Jobs, candidates, evaluations, and Pattern Engine results are stored in workspace-scoped Supabase tables. Browser storage is used only for the authenticated session, theme, connection settings, and one-time legacy-data migration.

# Beta authentication

Ancalagon's beta uses Supabase email-and-password authentication. A tester can create a profile from the access screen; Supabase automatically creates an isolated workspace for that account. Normal sign-in sends no email.

## Configure a test URL

In Supabase, open **Authentication > URL Configuration**.

- Set **Site URL** to the deployed beta URL when one exists.
- Add every allowed test address under **Redirect URLs**.
- For local testing, add `http://localhost:4173/**`.

## Create a tester profile

Open Ancalagon, select **Create Account**, and enter a name, work email, and password. The app displays a welcome confirmation and opens the tester's private workspace immediately.

The database trigger automatically creates a private workspace and makes that user its owner. No manual database row is required.

## Run locally

From the repository folder:

```powershell
npx.cmd serve . -l 4173
```

Open `http://localhost:4173`, then enter the tester's email and password.

An existing tester who previously used magic links can open their latest valid link one final time, go to **Settings > Account Security**, and set a password. Future sign-ins will not require an email.

## Expected checks

1. A tester can create an account with a name, work email, and password.
2. The new account receives its own private workspace.
3. Refreshing restores the tester's session.
4. The header shows the tester's email and private workspace.
5. Signing out returns to the access screen.

Jobs, candidates, evaluations, and Pattern Engine results are stored in workspace-scoped Supabase tables. Browser storage is used only for the authenticated session, theme, connection settings, and one-time legacy-data migration.

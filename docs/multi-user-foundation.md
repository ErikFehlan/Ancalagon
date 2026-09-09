# Multi-user foundation

This migration creates the private, workspace-scoped data layer for the Ancalagon closed beta without converting the product into a CRM.

## Data ownership

- A new authenticated user automatically receives a profile, workspace, and owner membership.
- Every job and candidate record is scoped to a workspace.
- Child records use composite foreign keys so a candidate cannot be attached to a job from another workspace.
- Deleting a job deletes its candidates and their associated documents, assessments, benchmarks, feedback, outcomes, and screening insights.

## Security

- Row Level Security is enabled on every application table.
- Authenticated users can access only workspaces where they are members.
- Resume files live in a private `resumes` bucket and must use paths beginning with the workspace UUID.
- AI usage events intentionally contain no resume text or screening notes.

## Apply the migration

From the repository root after linking the Supabase project:

```powershell
npx.cmd supabase@latest db push
```

The migration changes the backend only. The existing Git interface and GitHub Pages deployment remain unchanged until the authentication and persistence layer is connected in the next phase.

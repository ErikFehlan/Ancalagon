-- Personal navigation bookmarks. No resume content or shared workspace settings.
begin;
create table if not exists public.workspace_home (
 user_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 first_visited_at timestamptz not null default now(),
 last_job_id uuid,
 last_candidate_id uuid,
 last_page text check (last_page in ('dashboard','candidates','detail','pipeline','outcomes','rankings','compare','benchmarks','criteria','feedback','insights')),
 last_opened_at timestamptz,
 primary key(user_id,workspace_id)
);
-- Bookmarks deliberately tolerate deleted records. The UI resolves them against
-- the currently authorized workspace and falls back to Jobs if they no longer exist.
alter table public.workspace_home enable row level security;
revoke all on public.workspace_home from anon, authenticated;
grant select, insert, update on public.workspace_home to authenticated;
drop policy if exists home_select_own on public.workspace_home;
create policy home_select_own on public.workspace_home for select to authenticated using (user_id=auth.uid() and public.is_workspace_member(workspace_id));
drop policy if exists home_insert_own on public.workspace_home;
create policy home_insert_own on public.workspace_home for insert to authenticated with check (user_id=auth.uid() and public.is_workspace_member(workspace_id));
drop policy if exists home_update_own on public.workspace_home;
create policy home_update_own on public.workspace_home for update to authenticated using (user_id=auth.uid() and public.is_workspace_member(workspace_id)) with check (user_id=auth.uid() and public.is_workspace_member(workspace_id));
commit;

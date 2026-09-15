-- Tutorial progress is private to one user in one workspace. The existing
-- workspace_home RLS policies remain in force; no practice candidate is inserted.
begin;
alter table public.workspace_home add column if not exists tutorial_progress jsonb;
alter table public.workspace_home add column if not exists tutorial_revision integer not null default 0;
do $$begin
 if not exists(select from pg_constraint where conrelid='public.workspace_home'::regclass and conname='workspace_home_tutorial_valid') then
  alter table public.workspace_home add constraint workspace_home_tutorial_valid check (
   tutorial_revision >= 0 and (tutorial_progress is null or
    (jsonb_typeof(tutorial_progress)='object' and octet_length(tutorial_progress::text)<=32768))
  );
 end if;
end$$;
commit;

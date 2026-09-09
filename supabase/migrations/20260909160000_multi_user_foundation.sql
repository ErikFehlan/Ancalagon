-- Ancalagon closed-beta multi-user foundation.
-- Every application record belongs to a workspace. RLS prevents data from
-- crossing workspace boundaries, while cascading deletes support data removal.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.can_manage_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_workspace_member(uuid) from public;
revoke all on function public.can_manage_workspace(uuid) from public;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.can_manage_workspace(uuid) to authenticated;

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  client text,
  description text not null default '',
  manager_feedback text not null default '',
  criteria jsonb not null default '[]'::jsonb check (jsonb_typeof(criteria) = 'array'),
  knockouts jsonb not null default '[]'::jsonb check (jsonb_typeof(knockouts) = 'array'),
  weights jsonb not null default '[]'::jsonb check (jsonb_typeof(weights) = 'array'),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null,
  name text not null check (char_length(name) between 1 and 200),
  role text not null default '',
  stage text not null default 'Sourced' check (stage in ('Sourced', 'Screened', 'Submitted', 'Interviewing', 'Offer', 'Hired', 'Rejected', 'Withdrew')),
  resume_jd_score numeric(3,1) check (resume_jd_score between 0 and 10),
  jd_score numeric(3,1) check (jd_score between 0 and 10),
  original_manager_score numeric(3,1) check (original_manager_score between 0 and 10),
  manager_score numeric(3,1) check (manager_score between 0 and 10),
  confidence text check (confidence in ('Low', 'Medium', 'High')),
  recommendation text check (recommendation in ('Interview', 'Strong Consideration', 'Consider', 'Screen First', 'Not Recommended')),
  primary_signal text not null default '',
  strengths jsonb not null default '[]'::jsonb check (jsonb_typeof(strengths) = 'array'),
  concerns jsonb not null default '[]'::jsonb check (jsonb_typeof(concerns) = 'array'),
  tags jsonb not null default '[]'::jsonb check (jsonb_typeof(tags) = 'array'),
  screening_questions jsonb not null default '[]'::jsonb check (jsonb_typeof(screening_questions) = 'array'),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, job_id, workspace_id),
  foreign key (job_id, workspace_id) references public.jobs(id, workspace_id) on delete cascade
);

create table public.candidate_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null,
  candidate_id uuid not null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint check (file_size is null or (file_size >= 0 and file_size <= 10485760)),
  extracted_text text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (storage_path),
  foreign key (candidate_id, job_id, workspace_id) references public.candidates(id, job_id, workspace_id) on delete cascade
);

create table public.candidate_assessments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null,
  candidate_id uuid not null,
  assessment_type text not null check (assessment_type in ('resume', 'screening', 'manager_feedback', 'interview', 'manual_correction')),
  jd_score numeric(3,1) check (jd_score between 0 and 10),
  manager_score numeric(3,1) check (manager_score between 0 and 10),
  recommendation text,
  summary text not null default '',
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  model text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (candidate_id, job_id, workspace_id) references public.candidates(id, job_id, workspace_id) on delete cascade
);

create table public.candidate_benchmarks (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null,
  candidate_id uuid not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (job_id, candidate_id),
  foreign key (candidate_id, job_id, workspace_id) references public.candidates(id, job_id, workspace_id) on delete cascade
);

create table public.manager_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null,
  candidate_id uuid not null,
  feedback_type text not null,
  outcome text,
  feedback_text text not null check (char_length(feedback_text) between 1 and 10000),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (candidate_id, job_id, workspace_id) references public.candidates(id, job_id, workspace_id) on delete cascade
);

create table public.interview_outcomes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null,
  candidate_id uuid not null,
  interview_stage text not null,
  decision text not null,
  positives text not null default '',
  concerns text not null default '',
  notes text not null default '',
  previous_pipeline_stage text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (candidate_id, job_id, workspace_id) references public.candidates(id, job_id, workspace_id) on delete cascade
);

create table public.screening_insights (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  job_id uuid not null,
  candidate_id uuid not null,
  can_do_job text not null check (can_do_job in ('Yes', 'Maybe', 'No')),
  culture_working_style_fit text not null check (culture_working_style_fit in ('Strong', 'Mixed', 'Weak')),
  notes text not null check (char_length(notes) between 1 and 10000),
  previous_jd_score numeric(3,1) check (previous_jd_score between 0 and 10),
  resulting_jd_score numeric(3,1) check (resulting_jd_score between 0 and 10),
  previous_manager_score numeric(3,1) check (previous_manager_score between 0 and 10),
  resulting_manager_score numeric(3,1) check (resulting_manager_score between 0 and 10),
  assessment_summary text not null default '',
  assessment_source text not null default 'ai' check (assessment_source in ('ai', 'local', 'manual')),
  model text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (candidate_id, job_id, workspace_id) references public.candidates(id, job_id, workspace_id) on delete cascade
);

create table public.ai_usage_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  operation text not null check (operation in ('resume_analysis', 'screening_reassessment', 'pattern_analysis')),
  status text not null check (status in ('started', 'succeeded', 'failed')),
  model text,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  created_at timestamptz not null default now()
);

create index jobs_workspace_idx on public.jobs(workspace_id, updated_at desc);
create index candidates_job_idx on public.candidates(workspace_id, job_id, manager_score desc);
create index candidate_assessments_candidate_idx on public.candidate_assessments(candidate_id, created_at desc);
create index manager_feedback_candidate_idx on public.manager_feedback(candidate_id, created_at desc);
create index interview_outcomes_candidate_idx on public.interview_outcomes(candidate_id, created_at desc);
create index screening_insights_candidate_idx on public.screening_insights(candidate_id, created_at desc);
create index ai_usage_user_time_idx on public.ai_usage_events(user_id, created_at desc);

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger workspaces_set_updated_at before update on public.workspaces for each row execute function public.set_updated_at();
create trigger jobs_set_updated_at before update on public.jobs for each row execute function public.set_updated_at();
create trigger candidates_set_updated_at before update on public.candidates for each row execute function public.set_updated_at();
create trigger manager_feedback_set_updated_at before update on public.manager_feedback for each row execute function public.set_updated_at();
create trigger interview_outcomes_set_updated_at before update on public.interview_outcomes for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  workspace_uuid uuid;
  preferred_name text;
begin
  preferred_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(new.email, '@', 1), ''),
    'My'
  );

  insert into public.profiles (id, display_name)
  values (new.id, preferred_name);

  insert into public.workspaces (name, owner_id)
  values (preferred_name || '''s workspace', new.id)
  returning id into workspace_uuid;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (workspace_uuid, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- The project owner may already exist before this migration is installed.
do $$
declare
  account record;
  workspace_uuid uuid;
  preferred_name text;
begin
  for account in
    select id, email, raw_user_meta_data
    from auth.users
    where not exists (
      select 1 from public.workspace_members member_record where member_record.user_id = auth.users.id
    )
  loop
    preferred_name := coalesce(
      nullif(trim(account.raw_user_meta_data ->> 'display_name'), ''),
      nullif(split_part(account.email, '@', 1), ''),
      'My'
    );

    insert into public.profiles (id, display_name)
    values (account.id, preferred_name)
    on conflict (id) do nothing;

    insert into public.workspaces (name, owner_id)
    values (preferred_name || '''s workspace', account.id)
    returning id into workspace_uuid;

    insert into public.workspace_members (workspace_id, user_id, role)
    values (workspace_uuid, account.id, 'owner');
  end loop;
end;
$$;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.jobs enable row level security;
alter table public.candidates enable row level security;
alter table public.candidate_documents enable row level security;
alter table public.candidate_assessments enable row level security;
alter table public.candidate_benchmarks enable row level security;
alter table public.manager_feedback enable row level security;
alter table public.interview_outcomes enable row level security;
alter table public.screening_insights enable row level security;
alter table public.ai_usage_events enable row level security;

create policy "profiles_select_own" on public.profiles for select to authenticated using (id = auth.uid());
create policy "profiles_update_own" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "workspaces_select_member" on public.workspaces for select to authenticated using (public.is_workspace_member(id));
create policy "workspaces_update_admin" on public.workspaces for update to authenticated using (public.can_manage_workspace(id)) with check (public.can_manage_workspace(id));
create policy "workspaces_delete_owner" on public.workspaces for delete to authenticated using (owner_id = auth.uid());

create policy "members_select_member" on public.workspace_members for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "members_insert_admin" on public.workspace_members for insert to authenticated with check (public.can_manage_workspace(workspace_id));
create policy "members_update_admin" on public.workspace_members for update to authenticated using (public.can_manage_workspace(workspace_id)) with check (public.can_manage_workspace(workspace_id));
create policy "members_delete_admin" on public.workspace_members for delete to authenticated using (public.can_manage_workspace(workspace_id));

create policy "jobs_select_member" on public.jobs for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "jobs_insert_member" on public.jobs for insert to authenticated with check (public.is_workspace_member(workspace_id) and created_by = auth.uid());
create policy "jobs_update_member" on public.jobs for update to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "jobs_delete_member" on public.jobs for delete to authenticated using (public.is_workspace_member(workspace_id));

create policy "candidates_select_member" on public.candidates for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "candidates_insert_member" on public.candidates for insert to authenticated with check (public.is_workspace_member(workspace_id) and created_by = auth.uid());
create policy "candidates_update_member" on public.candidates for update to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "candidates_delete_member" on public.candidates for delete to authenticated using (public.is_workspace_member(workspace_id));

create policy "documents_select_member" on public.candidate_documents for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "documents_insert_member" on public.candidate_documents for insert to authenticated with check (public.is_workspace_member(workspace_id) and created_by = auth.uid());
create policy "documents_update_member" on public.candidate_documents for update to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "documents_delete_member" on public.candidate_documents for delete to authenticated using (public.is_workspace_member(workspace_id));

create policy "assessments_select_member" on public.candidate_assessments for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "assessments_insert_member" on public.candidate_assessments for insert to authenticated with check (public.is_workspace_member(workspace_id) and created_by = auth.uid());
create policy "assessments_update_member" on public.candidate_assessments for update to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "assessments_delete_member" on public.candidate_assessments for delete to authenticated using (public.is_workspace_member(workspace_id));

create policy "benchmarks_select_member" on public.candidate_benchmarks for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "benchmarks_insert_member" on public.candidate_benchmarks for insert to authenticated with check (public.is_workspace_member(workspace_id) and created_by = auth.uid());
create policy "benchmarks_delete_member" on public.candidate_benchmarks for delete to authenticated using (public.is_workspace_member(workspace_id));

create policy "feedback_select_member" on public.manager_feedback for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "feedback_insert_member" on public.manager_feedback for insert to authenticated with check (public.is_workspace_member(workspace_id) and created_by = auth.uid());
create policy "feedback_update_member" on public.manager_feedback for update to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "feedback_delete_member" on public.manager_feedback for delete to authenticated using (public.is_workspace_member(workspace_id));

create policy "outcomes_select_member" on public.interview_outcomes for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "outcomes_insert_member" on public.interview_outcomes for insert to authenticated with check (public.is_workspace_member(workspace_id) and created_by = auth.uid());
create policy "outcomes_update_member" on public.interview_outcomes for update to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "outcomes_delete_member" on public.interview_outcomes for delete to authenticated using (public.is_workspace_member(workspace_id));

create policy "screening_select_member" on public.screening_insights for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "screening_insert_member" on public.screening_insights for insert to authenticated with check (public.is_workspace_member(workspace_id) and created_by = auth.uid());
create policy "screening_update_member" on public.screening_insights for update to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "screening_delete_member" on public.screening_insights for delete to authenticated using (public.is_workspace_member(workspace_id));

create policy "usage_select_own" on public.ai_usage_events for select to authenticated using (user_id = auth.uid() and public.is_workspace_member(workspace_id));
create policy "usage_insert_own" on public.ai_usage_events for insert to authenticated with check (user_id = auth.uid() and public.is_workspace_member(workspace_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resumes',
  'resumes',
  false,
  10485760,
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_access_resume_path(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  path_workspace_id uuid;
begin
  path_workspace_id := ((storage.foldername(object_name))[1])::uuid;
  return public.is_workspace_member(path_workspace_id);
exception when others then
  return false;
end;
$$;

revoke all on function public.can_access_resume_path(text) from public;
grant execute on function public.can_access_resume_path(text) to authenticated;

create policy "resume_objects_select_member" on storage.objects
for select to authenticated
using (bucket_id = 'resumes' and public.can_access_resume_path(name));

create policy "resume_objects_insert_member" on storage.objects
for insert to authenticated
with check (bucket_id = 'resumes' and public.can_access_resume_path(name));

create policy "resume_objects_update_member" on storage.objects
for update to authenticated
using (bucket_id = 'resumes' and public.can_access_resume_path(name))
with check (bucket_id = 'resumes' and public.can_access_resume_path(name));

create policy "resume_objects_delete_member" on storage.objects
for delete to authenticated
using (bucket_id = 'resumes' and public.can_access_resume_path(name));

comment on table public.screening_insights is 'Job-related recruiter screening evidence used to reassess JD and manager fit; not a CRM activity log.';
comment on table public.ai_usage_events is 'Minimal operational telemetry for quotas and abuse protection; never store resume or screening text here.';

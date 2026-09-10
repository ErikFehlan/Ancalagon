-- Privacy-conscious product analytics for the Ancalagon closed beta.
-- Events contain action names and identifiers only; never candidate or resume content.

create table public.app_admins (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

insert into public.app_admins (email) values ('efehlan@gmail.com') on conflict (email) do nothing;

alter table public.app_admins enable row level security;

create or replace function public.is_app_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.app_admins
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_app_admin() from public;
grant execute on function public.is_app_admin() to authenticated;

create table public.app_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  event_type text not null check (event_type in (
    'signed_in', 'job_opened', 'job_created', 'candidate_added',
    'resume_analyzed', 'feedback_saved', 'interview_outcome_saved', 'hybrid_analysis_run'
  )),
  session_id uuid not null,
  page_path text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index app_events_user_time_idx on public.app_events(user_id, created_at desc);
create index app_events_type_time_idx on public.app_events(event_type, created_at desc);

alter table public.app_events enable row level security;

create policy "events_insert_own" on public.app_events for insert to authenticated
with check (
  user_id = auth.uid() and public.is_workspace_member(workspace_id)
  and (job_id is null or exists (
    select 1 from public.jobs tracked_job
    where tracked_job.id = app_events.job_id and tracked_job.workspace_id = app_events.workspace_id
  ))
);

create policy "events_select_admin" on public.app_events for select to authenticated
using (public.is_app_admin());

create or replace function public.get_admin_usage_summary()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_app_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'generated_at', now(),
    'totals', jsonb_build_object(
      'accounts', (select count(*) from auth.users),
      'active_7d', (select count(distinct user_id) from public.app_events where created_at >= now() - interval '7 days'),
      'active_30d', (select count(distinct user_id) from public.app_events where created_at >= now() - interval '30 days'),
      'sessions_30d', (select count(distinct session_id) from public.app_events where created_at >= now() - interval '30 days'),
      'events_30d', (select count(*) from public.app_events where created_at >= now() - interval '30 days')
    ),
    'users', coalesce((
      select jsonb_agg(user_row order by (user_row ->> 'last_activity') desc nulls last)
      from (
        select jsonb_build_object(
          'user_id', user_record.id, 'email', user_record.email,
          'created_at', user_record.created_at, 'last_sign_in_at', user_record.last_sign_in_at,
          'last_activity', max(event_record.created_at),
          'sessions', count(distinct event_record.session_id), 'events', count(event_record.id),
          'jobs_created', count(event_record.id) filter (where event_record.event_type = 'job_created'),
          'candidates_added', count(event_record.id) filter (where event_record.event_type = 'candidate_added'),
          'resumes_analyzed', count(event_record.id) filter (where event_record.event_type = 'resume_analyzed'),
          'feedback_saved', count(event_record.id) filter (where event_record.event_type = 'feedback_saved'),
          'outcomes_saved', count(event_record.id) filter (where event_record.event_type = 'interview_outcome_saved')
        ) user_row
        from auth.users user_record
        left join public.app_events event_record on event_record.user_id = user_record.id
        group by user_record.id, user_record.email, user_record.created_at, user_record.last_sign_in_at
      ) rows
    ), '[]'::jsonb),
    'event_breakdown', coalesce((
      select jsonb_object_agg(event_type, event_count)
      from (select event_type, count(*) event_count from public.app_events
            where created_at >= now() - interval '30 days' group by event_type) counts
    ), '{}'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.get_admin_usage_summary() from public;
grant execute on function public.get_admin_usage_summary() to authenticated;

comment on table public.app_events is 'Minimal product analytics. Never store candidate names, resume text, notes, passwords, or document content.';
comment on function public.get_admin_usage_summary() is 'Admin-only aggregate product usage and account activity for the closed beta.';

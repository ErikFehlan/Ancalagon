begin;
create table public.job_criteria_tasks (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  revision text not null,
  input jsonb not null,
  status text not null default 'queued' check(status in ('queued','processing','ready','failed')),
  attempts integer not null default 0,
  next_run_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  result jsonb,
  display_original boolean not null default false,
  error_code text,
  updated_at timestamptz not null default now()
);
alter table public.job_criteria_tasks enable row level security;
revoke all on public.job_criteria_tasks from anon, authenticated;
grant select on public.job_criteria_tasks to authenticated;
grant all on public.job_criteria_tasks to service_role;
create policy criteria_tasks_read on public.job_criteria_tasks for select to authenticated
  using(public.is_workspace_member(workspace_id));
create index criteria_tasks_due on public.job_criteria_tasks(next_run_at) where status in ('queued','processing');

create function public.enqueue_job_criteria() returns trigger language plpgsql security definer set search_path = '' as $$
declare payload jsonb; fingerprint text;
begin
  payload := jsonb_build_object('title',new.title,'description',new.description,'criteria',new.criteria,'manager_notes',new.manager_feedback,'knockouts',new.knockouts);
  fingerprint := md5(payload::text);
  insert into public.job_criteria_tasks(job_id,workspace_id,revision,input,next_run_at)
  values(new.id,new.workspace_id,fingerprint,payload,now()+interval '10 seconds')
  on conflict(job_id) do update set revision=excluded.revision,input=excluded.input,status='queued',attempts=0,
    next_run_at=excluded.next_run_at,lease_id=null,lease_until=null,result=null,display_original=false,error_code=null,updated_at=now()
  where job_criteria_tasks.revision is distinct from excluded.revision;
  return new;
end $$;
create trigger enqueue_job_criteria after insert or update of title,description,criteria,manager_feedback,knockouts on public.jobs
for each row execute function public.enqueue_job_criteria();
revoke all on function public.enqueue_job_criteria() from public,anon,authenticated;

create function public.claim_job_criteria() returns setof public.job_criteria_tasks
language plpgsql security definer set search_path = '' as $$
begin
  update public.job_criteria_tasks set status='failed',error_code='retry_limit',lease_id=null,lease_until=null,updated_at=now()
  where attempts>=3 and (status='queued' or (status='processing' and lease_until<now()));
  return query
  with due as (select job_id from public.job_criteria_tasks
    where attempts<3 and ((status='queued' and next_run_at<=now()) or (status='processing' and lease_until<now()))
    order by next_run_at for update skip locked limit 1)
  update public.job_criteria_tasks t set status='processing',attempts=t.attempts+1,lease_id=gen_random_uuid(),
    lease_until=now()+interval '3 minutes',updated_at=now() from due where t.job_id=due.job_id returning t.*;
end $$;
revoke all on function public.claim_job_criteria() from public,anon,authenticated;
grant execute on function public.claim_job_criteria() to service_role;

create function public.finish_job_criteria(p_job uuid,p_revision text,p_lease uuid,p_result jsonb,p_error text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  update public.job_criteria_tasks set
    status=case when p_error is null then 'ready' when attempts>=3 then 'failed' else 'queued' end,
    result=case when p_error is null then p_result else null end,
    error_code=case when p_error is null then null else left(p_error,80) end,
    next_run_at=now()+interval '1 minute'*power(2,attempts),lease_id=null,lease_until=null,updated_at=now()
  where job_id=p_job and revision=p_revision and lease_id=p_lease and status='processing' and lease_until>=now();
  get diagnostics changed=row_count;
  return changed=1;
end $$;
revoke all on function public.finish_job_criteria(uuid,text,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.finish_job_criteria(uuid,text,uuid,jsonb,text) to service_role;

create function public.use_original_job_criteria(p_job uuid,p_revision text,p_original boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.job_criteria_tasks set display_original=p_original,updated_at=now()
  where job_id=p_job and revision=p_revision and public.is_workspace_member(workspace_id) and status='ready';
  return found;
end $$;
revoke all on function public.use_original_job_criteria(uuid,text,boolean) from public,anon;
grant execute on function public.use_original_job_criteria(uuid,text,boolean) to authenticated;
commit;

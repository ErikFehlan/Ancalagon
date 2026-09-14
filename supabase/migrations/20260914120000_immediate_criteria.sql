begin;
-- Existing queue remains durable. Newly changed sources are eligible immediately.
create or replace function public.enqueue_job_criteria() returns trigger language plpgsql security definer set search_path = '' as $$
declare payload jsonb; fingerprint text;
begin
  payload := jsonb_build_object('title',new.title,'description',new.description,'criteria',new.criteria,'manager_notes',new.manager_feedback,'knockouts',new.knockouts);
  fingerprint := md5(payload::text);
  insert into public.job_criteria_tasks(job_id,workspace_id,revision,input,next_run_at)
  values(new.id,new.workspace_id,fingerprint,payload,now())
  on conflict(job_id) do update set revision=excluded.revision,input=excluded.input,status='queued',attempts=0,
    next_run_at=excluded.next_run_at,lease_id=null,lease_until=null,result=null,display_original=false,error_code=null,updated_at=now()
  where job_criteria_tasks.revision is distinct from excluded.revision;
  return new;
end $$;
create or replace function public.claim_job_criteria_for_job(p_job uuid) returns setof public.job_criteria_tasks
language plpgsql security definer set search_path = '' as $$
begin
  update public.job_criteria_tasks set status='failed',error_code='retry_limit',lease_id=null,lease_until=null,updated_at=now()
  where attempts>=3 and (status='queued' or (status='processing' and lease_until<now()));
  return query
  with due as (select job_id from public.job_criteria_tasks
    where (p_job is null or job_id=p_job) and attempts<3 and ((status='queued' and next_run_at<=now()) or (status='processing' and lease_until<now()))
    order by next_run_at for update skip locked limit 1)
  update public.job_criteria_tasks t set status='processing',attempts=t.attempts+1,lease_id=gen_random_uuid(),
    lease_until=now()+interval '3 minutes',updated_at=now() from due where t.job_id=due.job_id returning t.*;
end $$;

revoke all on function public.claim_job_criteria_for_job(uuid) from public,anon,authenticated;
grant execute on function public.claim_job_criteria_for_job(uuid) to service_role;
create or replace function public.claim_job_criteria() returns setof public.job_criteria_tasks
language sql security definer set search_path='' as $$
  select * from public.claim_job_criteria_for_job(null);
$$;

create or replace function public.wake_criteria_worker() returns trigger
language plpgsql security definer set search_path='' as $$
declare worker_url text; worker_secret text;
begin
  if new.status <> 'queued' then return new; end if;
  if tg_op='UPDATE' and old.revision is not distinct from new.revision then return new; end if;
  select decrypted_secret into worker_url from vault.decrypted_secrets where name='criteria_worker_url';
  select decrypted_secret into worker_secret from vault.decrypted_secrets where name='criteria_worker_secret';
  if nullif(worker_url,'') is null or nullif(worker_secret,'') is null then return new; end if;
  -- pg_net sends only after commit. Payload contains only the task identifier.
  perform net.http_post(url:=worker_url,
    headers:=jsonb_build_object('Content-Type','application/json','x-worker-secret',worker_secret),
    body:=jsonb_build_object('job_id',new.job_id),timeout_milliseconds:=90000);
  return new;
exception when others then
  -- A dispatch failure must not undo the recruiter's save. Cron retries the queue.
  raise warning 'Immediate criteria dispatch unavailable; scheduler will retry';
  return new;
end $$;
revoke all on function public.wake_criteria_worker() from public,anon,authenticated;
drop trigger if exists wake_criteria_worker on public.job_criteria_tasks;
create trigger wake_criteria_worker after insert or update of revision on public.job_criteria_tasks
for each row execute function public.wake_criteria_worker();
commit;

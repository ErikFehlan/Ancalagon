\set ON_ERROR_STOP on
-- Run after criteria-queue.sql; it leaves the initial migration installed.
create schema vault;
create table vault.decrypted_secrets(name text primary key, decrypted_secret text);
create schema net;
create table net.test_requests(id bigserial primary key, body jsonb);
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 2000)
returns bigint language plpgsql as $$ declare request_id bigint; begin
  if current_setting('test.dispatch_failure',true)='yes' then raise exception 'simulated transport failure'; end if;
  insert into net.test_requests(body) values(body) returning id into request_id;
  return request_id;
end $$;
insert into vault.decrypted_secrets values ('criteria_worker_url','https://example.invalid/worker'),('criteria_worker_secret','test-only-secret');
\ir ../supabase/migrations/20260914120000_immediate_criteria.sql
insert into jobs values
('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','QA','Test','["5+ years"]','','[]'),
('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000002','QA2','Test','["8+ years"]','','[]');
do $$ declare claimed public.job_criteria_tasks; begin
  if (select count(*) from net.test_requests)<>2 then raise exception 'save did not dispatch'; end if;
  if exists(select 1 from net.test_requests where body - 'job_id' <> '{}'::jsonb) then raise exception 'recruiting data leaked into dispatch'; end if;
  select * into claimed from public.claim_job_criteria_for_job('00000000-0000-0000-0000-000000000005');
  if claimed.job_id is distinct from '00000000-0000-0000-0000-000000000005'::uuid then raise exception 'wrong job claimed or not immediately eligible'; end if;
  if exists(select 1 from public.claim_job_criteria_for_job(claimed.job_id)) then raise exception 'duplicate dispatch claimed twice'; end if;
  if (select status from job_criteria_tasks where job_id='00000000-0000-0000-0000-000000000004')<>'queued' then raise exception 'unrelated work claimed'; end if;
  update jobs set title=title;
  if (select count(*) from net.test_requests)<>2 then raise exception 'unchanged save dispatched'; end if;
  update jobs set criteria='["New requirement"]' where id=claimed.job_id;
  if (select count(*) from net.test_requests)<>3 then raise exception 'changed source did not dispatch'; end if;
  if public.finish_job_criteria(claimed.job_id,claimed.revision,claimed.lease_id,'{}') then raise exception 'stale result accepted'; end if;
  if has_function_privilege('authenticated','public.claim_job_criteria_for_job(uuid)','EXECUTE') then raise exception 'claim exposed'; end if;
  if has_function_privilege('authenticated','public.wake_criteria_worker()','EXECUTE') then raise exception 'dispatch exposed'; end if;
end $$;
set test.dispatch_failure='yes';
update jobs set criteria='["Save survives network failure"]' where id='00000000-0000-0000-0000-000000000004';
do $$ begin
  if not exists(select 1 from public.claim_job_criteria()) then raise exception 'cron fallback lost the durable task'; end if;
end $$;
reset test.dispatch_failure;
begin;
update jobs set criteria='["Rollback me"]';
rollback;
do $$ begin
  if (select count(*) from net.test_requests)<>3 then raise exception 'rolled back save leaked dispatch'; end if;
end $$;

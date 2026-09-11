\set ON_ERROR_STOP on
create role anon; create role authenticated; create role service_role bypassrls;
create table public.workspaces(id uuid primary key);
create table public.jobs(id uuid primary key,workspace_id uuid not null references public.workspaces(id),title text,description text,criteria jsonb,manager_feedback text,knockouts jsonb);
create function public.is_workspace_member(w uuid) returns boolean language sql stable as $$select w::text=current_setting('test.workspace',true)$$;
\ir ../supabase/migrations/20260911180000_criteria_automation.sql
insert into workspaces values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into jobs values('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','QA','Test','["5+ years required"]','Manual focus','[]');
do $$ declare claimed public.job_criteria_tasks; newer public.job_criteria_tasks; ok boolean; begin
 if (select count(*) from public.job_criteria_tasks)<>1 then raise exception 'enqueue failed'; end if;
 if exists(select 1 from public.claim_job_criteria()) then raise exception 'debounce failed'; end if;
 update public.job_criteria_tasks set next_run_at=now()-interval '1 second';
 select * into claimed from public.claim_job_criteria();
 if claimed.lease_id is null then raise exception 'claim failed'; end if;
 if exists(select 1 from public.claim_job_criteria()) then raise exception 'double claim'; end if;
 update public.jobs set criteria='["8+ years required"]';
 ok:=public.finish_job_criteria(claimed.job_id,claimed.revision,claimed.lease_id,'{}');
 if ok then raise exception 'stale result applied'; end if;
 update public.job_criteria_tasks set next_run_at=now()-interval '1 second';select * into newer from public.claim_job_criteria();
 ok:=public.finish_job_criteria(newer.job_id,newer.revision,newer.lease_id,'{"criteria":[]}');if not ok then raise exception 'completion failed'; end if;
 update public.jobs set title=title;
 if (select status from public.job_criteria_tasks)<>'ready' then raise exception 'unchanged save queued work'; end if;
 if has_function_privilege('authenticated','public.claim_job_criteria()','EXECUTE') then raise exception 'worker permission leaked'; end if;
 if has_table_privilege('authenticated','public.job_criteria_tasks','UPDATE') then raise exception 'client write leaked'; end if;
end $$;
set role authenticated;set test.workspace='00000000-0000-0000-0000-000000000002';
do $$ begin if exists(select 1 from public.job_criteria_tasks) then raise exception 'workspace isolation failed'; end if; end $$;
reset role;
update jobs set criteria='["New input"]';
update public.job_criteria_tasks set next_run_at=now()-interval '1 minute';select * from public.claim_job_criteria();
update public.job_criteria_tasks set lease_until=now()-interval '1 second';select * from public.claim_job_criteria();
update public.job_criteria_tasks set lease_until=now()-interval '1 second';select * from public.claim_job_criteria();
update public.job_criteria_tasks set lease_until=now()-interval '1 second';select * from public.claim_job_criteria();
do $$ begin if (select status from public.job_criteria_tasks)<>'failed' then raise exception 'bounded retry failed'; end if; end $$;
delete from jobs;
do $$ begin if exists(select 1 from public.job_criteria_tasks) then raise exception 'orphan task'; end if; end $$;

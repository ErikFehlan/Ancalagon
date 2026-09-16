-- Counts describe committed work, not form submissions or polling activity.
begin;
-- Take the required table locks before changing schema. If a worker or request
-- is using one, abort immediately; the deployment runner retries the whole
-- transaction after rollback. Do not wait while holding partial schema locks.
set local lock_timeout='1s';
lock table public.jobs,public.candidates,public.candidate_documents,
 public.manager_feedback,public.screening_insights,public.interview_outcomes,
 public.resume_intake_tasks,public.job_reassessment_tasks,public.job_criteria_tasks,
 public.ai_usage_events,public.app_events in access exclusive mode nowait;
create table if not exists public.product_usage_events (
 id bigint generated always as identity primary key,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid references auth.users(id) on delete cascade,
 event_type text not null check(event_type in (
  'job_created','candidate_added','resume_uploaded','feedback_saved','screening_saved','interview_outcome_saved',
  'job_updated','job_closed','job_reopened','candidate_stage_changed','feedback_updated','screening_updated','interview_outcome_updated','assessment_approved','assessment_dismissed',
  'resume_analysis_completed','candidate_reassessment_completed','criteria_refinement_completed',
  'screening_analysis_completed','pattern_analysis_completed',
  'resume_analysis_failed','candidate_reassessment_failed','criteria_refinement_failed','screening_analysis_failed','pattern_analysis_failed')),
 source_key text not null unique,
 occurred_at timestamptz not null default now(),
 background boolean not null default false,
 recovered boolean not null default false
);
create index if not exists product_usage_user_time on public.product_usage_events(user_id,occurred_at desc);
create index if not exists product_usage_workspace_time on public.product_usage_events(workspace_id,occurred_at desc);
alter table public.product_usage_events enable row level security;
revoke all on public.product_usage_events from public,anon,authenticated;
grant select on public.product_usage_events to authenticated;
grant all on public.product_usage_events to service_role;
grant usage,select on sequence public.product_usage_events_id_seq to service_role;
drop policy if exists usage_read on public.product_usage_events;
create policy usage_read on public.product_usage_events for select to authenticated
 using(public.is_app_admin() or (user_id=auth.uid() and public.is_workspace_member(workspace_id)));

create table if not exists public.usage_tracking_state(singleton boolean primary key default true check(singleton),started_at timestamptz not null default now());
revoke all on public.usage_tracking_state from public,anon,authenticated;

create or replace function public.record_product_usage(w uuid,u uuid,kind text,source text,happened timestamptz,automated boolean default false,historical boolean default false)
returns void language sql security definer set search_path='' as $$
 insert into public.product_usage_events(workspace_id,user_id,event_type,source_key,occurred_at,background,recovered)
 values(w,u,kind,source,happened,automated,historical) on conflict(source_key) do nothing;
$$;
revoke all on function public.record_product_usage(uuid,uuid,text,text,timestamptz,boolean,boolean) from public,anon,authenticated;

create or replace function public.record_saved_usage() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform public.record_product_usage(new.workspace_id,new.created_by,tg_argv[0],tg_table_name||':'||new.id,clock_timestamp());
 return new;
end$$;

-- Edits are activity, but are not another newly created job, candidate or note.
-- Only human-editable fields count; generated scores and polling saves do not.
create or replace function public.record_updated_usage() returns trigger
language plpgsql security definer set search_path='' as $$
declare before_value jsonb;after_value jsonb;kind text:=tg_argv[0];
begin
 if auth.uid() is null or not public.is_workspace_member(new.workspace_id) then return new;end if;
 select jsonb_object_agg(k,to_jsonb(old)->k),jsonb_object_agg(k,to_jsonb(new)->k) into before_value,after_value
 from unnest(string_to_array(tg_argv[1],',')) k;
 if before_value is not distinct from after_value then return new;end if;
 if tg_table_name='jobs' and to_jsonb(old)->>'status' is distinct from to_jsonb(new)->>'status' then
  kind:=case when to_jsonb(new)->>'status'='closed' then 'job_closed' else 'job_reopened' end;
 end if;
 perform public.record_product_usage(new.workspace_id,auth.uid(),kind,tg_table_name||':'||new.id||':'||kind||':'||txid_current(),clock_timestamp());
 return new;
end$$;
revoke all on function public.record_updated_usage() from public,anon,authenticated;
do $$declare t text;kind text;fields text;begin
 for t,kind,fields in select * from (values
  ('jobs','job_updated','title,client,description,manager_feedback,criteria,knockouts,weights,status'),
  ('candidates','candidate_stage_changed','stage'),('manager_feedback','feedback_updated','feedback_type,outcome,feedback_text'),
  ('screening_insights','screening_updated','can_do_job,culture_working_style_fit,notes'),
  ('interview_outcomes','interview_outcome_updated','interview_stage,decision,positives,concerns,notes')) v(t,k,f)
 loop
  execute format('drop trigger if exists record_updated_usage on public.%I',t);
  execute format('create trigger record_updated_usage after update on public.%I for each row execute function public.record_updated_usage(%L,%L)',t,kind,fields);
 end loop;
end$$;
revoke all on function public.record_saved_usage() from public,anon,authenticated;
do $$declare table_name text;kind text;begin
 for table_name,kind in select * from (values
  ('jobs','job_created'),('candidates','candidate_added'),('candidate_documents','resume_uploaded'),
  ('manager_feedback','feedback_saved'),('screening_insights','screening_saved'),('interview_outcomes','interview_outcome_saved')) v(t,k)
 loop
  execute format('drop trigger if exists record_saved_usage on public.%I',table_name);
  execute format('create trigger record_saved_usage after insert on public.%I for each row execute function public.record_saved_usage(%L)',table_name,kind);
 end loop;
end$$;

-- One operation identity survives retries and approval; a newly queued version
-- receives a new identity, including when the input returns to an earlier value.
alter table public.resume_intake_tasks add column if not exists usage_run_id uuid not null default gen_random_uuid();
alter table public.resume_intake_tasks add column if not exists usage_actor_id uuid references auth.users(id) on delete set null;
alter table public.job_reassessment_tasks add column if not exists usage_run_id uuid not null default gen_random_uuid();
alter table public.job_reassessment_tasks add column if not exists usage_actor_id uuid references auth.users(id) on delete set null;
alter table public.job_criteria_tasks add column if not exists usage_run_id uuid not null default gen_random_uuid();
alter table public.job_criteria_tasks add column if not exists usage_actor_id uuid references auth.users(id) on delete set null;
create or replace function public.identify_usage_operation() returns trigger
language plpgsql security definer set search_path='' as $$
declare fresh boolean;creator uuid;
begin
 fresh:=tg_op='INSERT';
 if tg_op='UPDATE' then
  fresh:=new.revision is distinct from old.revision or (new.status='queued' and old.status in ('ready','approved','ignored','cancelled'));
 end if;
 if fresh then new.usage_run_id:=gen_random_uuid();end if;
 if fresh then
  if tg_table_name='job_criteria_tasks' then select created_by into creator from public.jobs where id=new.job_id;
  else select created_by into creator from public.candidates where id=new.candidate_id;end if;
  new.usage_actor_id:=coalesce(case when public.is_workspace_member(new.workspace_id) then auth.uid() end,creator);
 end if;
 return new;
end$$;
revoke all on function public.identify_usage_operation() from public,anon,authenticated;

create or replace function public.usage_result_time(result jsonb,fallback timestamptz) returns timestamptz
language plpgsql stable set search_path='' as $$
begin return coalesce((result->>'generated_at')::timestamptz,fallback);
exception when others then return fallback;
end$$;
revoke all on function public.usage_result_time(jsonb,timestamptz) from public,anon,authenticated;
create or replace function public.record_task_usage() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text;
begin
 if new.status not in ('ready','approved','ignored','failed') then return new;end if;
 if new.status<>'failed' and new.result is null then return new;end if;
 -- Empty criteria are resolved locally without an AI operation.
 if tg_table_name='job_criteria_tasks' and new.status<>'failed' and coalesce(jsonb_array_length(new.result->'criteria'),0)=0 then return new;end if;
 kind:=case tg_table_name when 'resume_intake_tasks' then 'resume_analysis' when 'job_reassessment_tasks' then 'candidate_reassessment' else 'criteria_refinement' end;
 kind:=kind||case when new.status='failed' then '_failed' else '_completed' end;
 perform public.record_product_usage(new.workspace_id,new.usage_actor_id,kind,tg_table_name||':'||new.usage_run_id||':'||kind,clock_timestamp(),true);
 if tg_table_name<>'job_criteria_tasks' and new.status in ('approved','ignored') then
  if new.reviewed_by is not null and new.reviewed_at is not null then
   kind:=case when new.status='approved' then 'assessment_approved' else 'assessment_dismissed' end;
   perform public.record_product_usage(new.workspace_id,new.reviewed_by,kind,tg_table_name||':'||new.usage_run_id||':'||kind,new.reviewed_at);
  end if;
 end if;
 return new;
end$$;
revoke all on function public.record_task_usage() from public,anon,authenticated;
do $$declare t text;begin
 foreach t in array array['resume_intake_tasks','job_reassessment_tasks','job_criteria_tasks'] loop
  execute format('drop trigger if exists identify_usage_operation on public.%I',t);
  execute format('create trigger identify_usage_operation before insert or update on public.%I for each row execute function public.identify_usage_operation()',t);
  execute format('drop trigger if exists record_task_usage on public.%I',t);
  execute format('create trigger record_task_usage after insert or update of status,revision on public.%I for each row execute function public.record_task_usage()',t);
 end loop;
end$$;

-- Authenticated analysis requests use a server-generated identity for telemetry
-- retries. Only the authenticated Edge Function may write AI completion records.
alter table public.ai_usage_events add column if not exists request_id uuid;
create unique index if not exists ai_usage_request_status on public.ai_usage_events(request_id,status);
grant all on public.ai_usage_events to service_role;
grant usage,select on sequence public.ai_usage_events_id_seq to service_role;
-- Retain compatibility with in-flight older handlers until the service-writing
-- handlers have deployed. Activation closes the old client-write permission.
create or replace function public.activate_confirmed_usage() returns void
language plpgsql security definer set search_path='' as $$
begin
 drop policy if exists usage_insert_own on public.ai_usage_events;
 revoke insert,update,delete on public.ai_usage_events from authenticated,anon;
end$$;
revoke all on function public.activate_confirmed_usage() from public,anon,authenticated;
grant execute on function public.activate_confirmed_usage() to service_role;
create or replace function public.record_direct_ai_usage() returns trigger
language plpgsql security definer set search_path='' as $$
declare kind text;
begin
 if new.status='started' then return new;end if;
 kind:=case new.operation when 'resume_analysis' then 'resume_analysis' when 'screening_reassessment' then 'screening_analysis' else 'pattern_analysis' end;
 kind:=kind||case when new.status='succeeded' then '_completed' else '_failed' end;
 perform public.record_product_usage(new.workspace_id,new.user_id,kind,'direct-ai:'||coalesce(new.request_id::text,new.id::text)||':'||kind,new.created_at);
 return new;
end$$;
revoke all on function public.record_direct_ai_usage() from public,anon,authenticated;
drop trigger if exists record_direct_ai_usage on public.ai_usage_events;
create trigger record_direct_ai_usage after insert on public.ai_usage_events for each row execute function public.record_direct_ai_usage();

-- Recover only facts supported by retained records. Old click counts cannot
-- establish whether a save succeeded, and superseded task history is unavailable.
do $$declare t text;kind text;r record;begin
 if exists(select from public.usage_tracking_state) then return;end if;
 insert into public.usage_tracking_state(singleton) values(true);
 for t,kind in select * from (values
  ('jobs','job_created'),('candidates','candidate_added'),('candidate_documents','resume_uploaded'),
  ('manager_feedback','feedback_saved'),('screening_insights','screening_saved'),('interview_outcomes','interview_outcome_saved')) v(t,k)
 loop
  execute format('insert into public.product_usage_events(workspace_id,user_id,event_type,source_key,occurred_at,recovered)
   select workspace_id,created_by,%L,%L||id,created_at,true from public.%I on conflict(source_key) do nothing',kind,t||':',t);
 end loop;
 foreach t in array array['resume_intake_tasks','job_reassessment_tasks','job_criteria_tasks'] loop
  if t='job_criteria_tasks' then
   execute format('update public.%I t set usage_actor_id=j.created_by from public.jobs j where t.job_id=j.id and t.usage_actor_id is null',t);
  else
   execute format('update public.%I t set usage_actor_id=c.created_by from public.candidates c where t.candidate_id=c.id and t.usage_actor_id is null',t);
  end if;
  kind:=case t when 'resume_intake_tasks' then 'resume_analysis' when 'job_reassessment_tasks' then 'candidate_reassessment' else 'criteria_refinement' end;
  for r in execute format('select * from public.%I where (status in (''ready'',''approved'',''ignored'') and result is not null) or status=''failed''',t) loop
   if t='job_criteria_tasks' and r.status<>'failed' and coalesce(jsonb_array_length(r.result->'criteria'),0)=0 then continue;end if;
   perform public.record_product_usage(r.workspace_id,r.usage_actor_id,kind||case when r.status='failed' then '_failed' else '_completed' end,
    t||':'||r.usage_run_id||':'||kind||case when r.status='failed' then '_failed' else '_completed' end,
    public.usage_result_time(r.result,r.updated_at),true,true);
   if t<>'job_criteria_tasks' and r.status in ('approved','ignored') then
    if r.reviewed_by is not null and r.reviewed_at is not null then
     perform public.record_product_usage(r.workspace_id,r.reviewed_by,case when r.status='approved' then 'assessment_approved' else 'assessment_dismissed' end,
      t||':'||r.usage_run_id||':'||case when r.status='approved' then 'assessment_approved' else 'assessment_dismissed' end,r.reviewed_at,false,true);
    end if;
   end if;
  end loop;
 end loop;
 for r in select * from public.ai_usage_events where status in ('succeeded','failed') loop
  kind:=(case r.operation when 'resume_analysis' then 'resume_analysis' when 'screening_reassessment' then 'screening_analysis' else 'pattern_analysis' end)||case when r.status='succeeded' then '_completed' else '_failed' end;
  perform public.record_product_usage(r.workspace_id,r.user_id,kind,'direct-ai:'||coalesce(r.request_id::text,r.id::text)||':'||kind,r.created_at,false,true);
 end loop;
end$$;

-- Browser events describe navigation only. Stale clients cannot inflate saved
-- work totals with the earlier form-submit events.
alter table public.app_events add column if not exists event_id uuid;
create unique index if not exists app_events_identity on public.app_events(event_id);
drop policy if exists events_insert_own on public.app_events;
create policy events_insert_own on public.app_events for insert to authenticated with check(
 user_id=auth.uid() and public.is_workspace_member(workspace_id) and event_type in ('signed_in','job_opened')
 and (job_id is null or exists(select from public.jobs j where j.id=app_events.job_id and j.workspace_id=app_events.workspace_id)));

create or replace function public.get_admin_usage_summary() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare report jsonb;
begin
 if not public.is_app_admin() then raise exception 'Admin access required' using errcode='42501';end if;
 with events as materialized (
  select user_id,workspace_id,event_type,occurred_at as happened,background,null::uuid as session_id from public.product_usage_events
  union all
  select user_id,workspace_id,event_type,created_at,false,session_id from public.app_events where event_type in ('signed_in','job_opened')
 ), people as (
  select u.id,jsonb_build_object('user_id',u.id,'email',u.email,'created_at',u.created_at,'last_sign_in_at',u.last_sign_in_at,
   'last_activity',greatest(u.last_sign_in_at,max(e.happened) filter(where not e.background)),'sessions',count(distinct e.session_id),
   'events',count(e.event_type),'jobs_created',count(*) filter(where e.event_type='job_created'),
   'candidates_added',count(*) filter(where e.event_type='candidate_added'),
   'resumes_analyzed',count(*) filter(where e.event_type='resume_analysis_completed'),
   'ai_completed',count(*) filter(where e.event_type like '%\_completed' escape '\'),
   'feedback_saved',count(*) filter(where e.event_type in ('feedback_saved','screening_saved')),
   'outcomes_saved',count(*) filter(where e.event_type='interview_outcome_saved')) as user_row
  from auth.users u left join events e on e.user_id=u.id group by u.id,u.email,u.created_at,u.last_sign_in_at
 ) select jsonb_build_object(
  'generated_at',now(),'tracking_started_at',(select started_at from public.usage_tracking_state),
  'totals',jsonb_build_object('accounts',(select count(*) from auth.users),
   'active_7d',(select count(*) from auth.users u where u.last_sign_in_at>=now()-interval '7 days' or exists(select from events e where e.user_id=u.id and not e.background and e.happened>=now()-interval '7 days')),
   'active_30d',(select count(*) from auth.users u where u.last_sign_in_at>=now()-interval '30 days' or exists(select from events e where e.user_id=u.id and not e.background and e.happened>=now()-interval '30 days')),
   'sessions_30d',(select count(distinct (user_id,session_id)) from events where session_id is not null and happened>=now()-interval '30 days'),
   'events_30d',(select count(*) from events where happened>=now()-interval '30 days')),
  'users',coalesce((select jsonb_agg(user_row order by (user_row->>'last_activity') desc nulls last) from people),'[]'::jsonb),
  'event_breakdown',coalesce((select jsonb_object_agg(event_type,n) from (select event_type,count(*) n from events where happened>=now()-interval '30 days' group by event_type) b),'{}'::jsonb)
 ) into report;
 return report;
end$$;
revoke all on function public.get_admin_usage_summary() from public,anon;
grant execute on function public.get_admin_usage_summary() to authenticated;
create or replace function public.get_personal_usage() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('jobs',count(*) filter(where event_type='job_created'),
 'candidates',count(*) filter(where event_type='candidate_added'),'ai_completed',count(*) filter(where event_type like '%\_completed' escape '\'))
 from public.product_usage_events where user_id=auth.uid() and occurred_at>=now()-interval '30 days' and public.is_workspace_member(workspace_id);
$$;
revoke all on function public.get_personal_usage() from public,anon;
grant execute on function public.get_personal_usage() to authenticated;
comment on table public.product_usage_events is 'Confirmed saved work and completed or terminally failed AI operations. No resume, note, document, or model content.';
notify pgrst,'reload schema';
commit;

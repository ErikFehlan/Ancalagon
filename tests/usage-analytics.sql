\set ON_ERROR_STOP on
-- Real production tables/triggers; external worker dispatch is stubbed locally.
do $$begin
 if not exists(select from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;
end$$;
create schema auth;create schema storage;create schema vault;create schema net;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',created_at timestamptz default now(),last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('sub',auth.uid(),'email',current_setting('test.email',true))$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text);
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
create table vault.decrypted_secrets(name text,decrypted_secret text);
create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$select 1::bigint$$;
grant usage on schema auth,storage to authenticated,service_role;
grant execute on function auth.uid(),auth.jwt(),storage.foldername(text) to authenticated,service_role;
\ir ../supabase/migrations/20260909160000_multi_user_foundation.sql
\ir ../supabase/migrations/20260909220000_remote_pattern_analysis.sql
\ir ../supabase/migrations/20260910160000_admin_usage_analytics.sql
\ir ../supabase/migrations/20260910190000_job_lifecycle.sql
\ir ../supabase/migrations/20260911180000_criteria_automation.sql
\ir ../supabase/migrations/20260914120000_immediate_criteria.sql
\ir ../supabase/migrations/20260914160000_job_reassessments.sql
\ir ../supabase/migrations/20260914180000_resume_intake.sql
\ir ../supabase/migrations/20260915090000_core_intake.sql
grant select,insert,update,delete on all tables in schema public to authenticated;
grant usage,select on all sequences in schema public to authenticated;
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000000001','admin@example.test'),('00000000-0000-0000-0000-000000000002','other@example.test');
insert into app_admins values('admin@example.test',now());
-- Stable synthetic workspace for assertions. Auth-created workspaces stay empty.
insert into workspaces(id,name,owner_id) values
 ('00000000-0000-0000-0000-000000000011','Fixture','00000000-0000-0000-0000-000000000001');
insert into workspace_members(workspace_id,user_id) values('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001');
set test.actor='00000000-0000-0000-0000-000000000001';set test.email='admin@example.test';
insert into jobs(id,workspace_id,title,description,criteria,created_at) values
 ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000011','Historical QA','Synthetic role','["Manual testing"]',now()-interval '40 days');
insert into candidates(id,job_id,workspace_id,name,role,created_at) values
 ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000011','Synthetic Candidate','QA',now()-interval '40 days');
insert into resume_intake_tasks(candidate_id,job_id,workspace_id,revision,input,status,result,updated_at) values
 ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000011','old','{}','ready',jsonb_build_object('generated_at',now()-interval '40 days'),now());
insert into ai_usage_events(workspace_id,user_id,operation,status) values
 ('00000000-0000-0000-0000-000000000011',auth.uid(),'screening_reassessment','succeeded');
-- These click records are deliberately false. They must not inflate confirmed work.
insert into app_events(workspace_id,user_id,event_type,session_id)
 select '00000000-0000-0000-0000-000000000011',auth.uid(),t,gen_random_uuid()
 from unnest(array['job_created','candidate_added','resume_analyzed','hybrid_analysis_run']) t;
\ir ../supabase/migrations/20260916120000_accurate_usage.sql
select activate_confirmed_usage();
create temp table first_install as select count(*) n from product_usage_events;
\ir ../supabase/migrations/20260916120000_accurate_usage.sql
do $$declare r jsonb;u jsonb;begin
 if (select count(*) from product_usage_events)<>(select n from first_install) then raise exception 'Migration duplicated recovered history';end if;
 r:=get_admin_usage_summary();select value into u from jsonb_array_elements(r->'users') where value->>'email'='admin@example.test';
 if (u->>'jobs_created')::int<>1 or (u->>'candidates_added')::int<>1 or (u->>'ai_completed')::int<>2 then raise exception 'Recoverable history or click exclusion incorrect: %',u;end if;
 if r#>'{event_breakdown,job_created}' is not null or r#>'{event_breakdown,resume_analysis_completed}' is not null then raise exception 'Historical activity shifted into 30-day window';end if;
 if get_personal_usage()->>'jobs'<>'0' or get_personal_usage()->>'ai_completed'<>'1' then raise exception 'Personal time window differs';end if;
end$$;
-- Client writes cannot fabricate saved-work or AI completion events.
set role authenticated;
do $$begin
 if has_table_privilege(current_user,'public.product_usage_events','INSERT') or has_table_privilege(current_user,'public.ai_usage_events','INSERT') then raise exception 'Usage write privileges exposed';end if;
 if has_function_privilege(current_user,'public.record_product_usage(uuid,uuid,text,text,timestamptz,boolean,boolean)','EXECUTE') then raise exception 'Private recorder exposed';end if;
 begin insert into app_events(workspace_id,user_id,event_type,session_id) values('00000000-0000-0000-0000-000000000011',auth.uid(),'candidate_added',gen_random_uuid());raise exception 'Client fabricated save';exception when insufficient_privilege then null;end;
end$$;
reset role;
-- A failed transaction leaves neither a candidate nor a usage record.
do $$declare n bigint;begin
 select count(*) into n from product_usage_events;
 begin
  insert into candidates(id,job_id,workspace_id,name) values('00000000-0000-0000-0000-000000000039','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000011','Rolled back');
  raise exception 'intentional rollback';
 exception when raise_exception then null;end;
 if (select count(*) from product_usage_events)<>n then raise exception 'Failed save counted';end if;
end$$;
insert into jobs(id,workspace_id,title,description) values('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000011','New job','Synthetic');
insert into candidates(id,job_id,workspace_id,name,role) values
 ('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000011','Manual','QA'),
 ('00000000-0000-0000-0000-000000000033','00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000011','Uploaded','Resume awaiting analysis');
insert into candidate_assessments(workspace_id,job_id,candidate_id,assessment_type,evidence) values
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000033','manual_correction','{"resume_intake":{"phase":"uploading","backend":"durable-v1"}}');
insert into candidate_documents(workspace_id,job_id,candidate_id,file_name,mime_type,file_size,storage_path,extracted_text)
 values('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000033','Synthetic.txt','text/plain',80,
 '00000000-0000-0000-0000-000000000011/00000000-0000-0000-0000-000000000022/00000000-0000-0000-0000-000000000033/source.txt','Synthetic Candidate performed manual testing of a fictional billing application.');
insert into manager_feedback(id,workspace_id,job_id,candidate_id,feedback_type,feedback_text) values
 ('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000032','General note','Synthetic note');
insert into interview_outcomes(workspace_id,job_id,candidate_id,interview_stage,decision) values
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000032','Screen','Advance');
insert into screening_insights(workspace_id,job_id,candidate_id,can_do_job,culture_working_style_fit,notes) values
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000032','Yes','Strong','Screening note');
update manager_feedback set feedback_text='Edited synthetic note' where id='00000000-0000-0000-0000-000000000041';
insert into manager_feedback(id,workspace_id,job_id,candidate_id,feedback_type,feedback_text) values
 ('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000032','General note','Edited synthetic note') on conflict(id) do nothing;
do $$begin
 if (select count(*) from product_usage_events where event_type='candidate_added')<>3 then raise exception 'Manual/upload candidate totals incorrect';end if;
 if (select count(*) from product_usage_events where event_type='feedback_saved')<>1 then raise exception 'Edit/retry counted as another note';end if;
 if (select count(*) from product_usage_events where event_type='resume_uploaded')<>1 then raise exception 'Upload missing';end if;
end$$;
-- Accepted completion counts with no browser open. Polls and review do not recount it.
update resume_intake_tasks set status='processing',attempts=1 where candidate_id='00000000-0000-0000-0000-000000000033';
update resume_intake_tasks set status='ready',result='{"generated_at":"2026-01-01T00:00:00Z"}' where candidate_id='00000000-0000-0000-0000-000000000033';
update resume_intake_tasks set status='ready' where candidate_id='00000000-0000-0000-0000-000000000033';
update resume_intake_tasks set status='approved' where candidate_id='00000000-0000-0000-0000-000000000033';
do $$begin
 if (select count(*) from product_usage_events where event_type='resume_analysis_completed')<>2 then raise exception 'Resume completion omitted or duplicated';end if;
 if not exists(select from product_usage_events where event_type='resume_analysis_completed' and not recovered and occurred_at>now()-interval '1 hour') then raise exception 'Completion trusted a supplied timestamp';end if;
end$$;
-- A collaborator's revision is attributed to that collaborator, not the creator.
insert into workspace_members(workspace_id,user_id) values('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000002');
set test.actor='00000000-0000-0000-0000-000000000002';set test.email='other@example.test';
update job_reassessment_tasks set revision='collaborator-revision',status='queued',result=null where candidate_id='00000000-0000-0000-0000-000000000032';
set test.actor='';
update job_reassessment_tasks set status='processing',attempts=1 where candidate_id='00000000-0000-0000-0000-000000000032';
update job_reassessment_tasks set status='failed' where candidate_id='00000000-0000-0000-0000-000000000032';
update job_reassessment_tasks set status='queued' where candidate_id='00000000-0000-0000-0000-000000000032';
update job_reassessment_tasks set status='ready',result='{}' where candidate_id='00000000-0000-0000-0000-000000000032';
update job_reassessment_tasks set status='ignored' where candidate_id='00000000-0000-0000-0000-000000000032';
update job_criteria_tasks set status='ready',result='{"criteria":[]}' where job_id='00000000-0000-0000-0000-000000000022';
update job_criteria_tasks set status='ready',result='{"criteria":[{"index":0,"label":"Manual testing","question":"Example?"}]}' where job_id='00000000-0000-0000-0000-000000000021';
do $$begin
 if (select count(*) from product_usage_events where event_type='candidate_reassessment_completed' and user_id='00000000-0000-0000-0000-000000000002')<>1 then raise exception 'Background actor/retry attribution incorrect';end if;
 if (select count(*) from product_usage_events where event_type='candidate_reassessment_failed')<>1 then raise exception 'Failure not separated';end if;
 if (select count(*) from product_usage_events where event_type='criteria_refinement_completed')<>1 then raise exception 'Empty criteria counted as AI';end if;
end$$;
-- Stable request IDs deduplicate transport retries, while distinct requests count.
insert into ai_usage_events(workspace_id,user_id,operation,status,request_id) values
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','pattern_analysis','started','00000000-0000-0000-0000-000000000051'),
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','pattern_analysis','succeeded','00000000-0000-0000-0000-000000000051');
insert into ai_usage_events(workspace_id,user_id,operation,status,request_id) values
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','pattern_analysis','succeeded','00000000-0000-0000-0000-000000000051') on conflict(request_id,status) do nothing;
-- Deleting the business record must not erase the fact that work occurred.
delete from candidates where id='00000000-0000-0000-0000-000000000033';
set test.actor='00000000-0000-0000-0000-000000000001';set test.email='admin@example.test';
do $$declare r jsonb;u jsonb;begin
 r:=get_admin_usage_summary();select value into u from jsonb_array_elements(r->'users') where value->>'email'='admin@example.test';
 if (u->>'jobs_created')::int<>2 or (u->>'candidates_added')::int<>3 or (u->>'feedback_saved')::int<>2 or (u->>'outcomes_saved')::int<>1 then raise exception 'Confirmed totals incorrect: %',u;end if;
 if (u->>'ai_completed')::int<>5 then raise exception 'AI completion total incorrect: %',u;end if;
 if get_personal_usage()->>'ai_completed'<>'4' or get_personal_usage()->>'candidates'<>'2' then raise exception 'Personal totals missed completed/deleted work';end if;
 if (r#>>'{totals,active_7d}')::int<>1 then raise exception 'Background worker marked collaborator active';end if;
 if r#>>'{event_breakdown,pattern_analysis_completed}'<>'1' then raise exception 'AI retry doubled count';end if;
end$$;
update auth.users set last_sign_in_at=now() where id='00000000-0000-0000-0000-000000000002';
do $$begin if get_admin_usage_summary()#>>'{totals,active_7d}'<>'2' then raise exception 'Server-confirmed sign-in missing from active users';end if;end$$;
-- Same browser-session UUID under different accounts means two account sessions.
insert into app_events(workspace_id,user_id,event_type,session_id) values
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','signed_in','00000000-0000-0000-0000-000000000061'),
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000002','signed_in','00000000-0000-0000-0000-000000000061');
do $$begin if get_admin_usage_summary()#>>'{totals,sessions_30d}'<>'2' then raise exception 'Account sessions merged';end if;end$$;
set test.actor='00000000-0000-0000-0000-000000000002';set test.email='other@example.test';
set role authenticated;
do $$begin
 begin perform get_admin_usage_summary();raise exception 'Non-admin accessed report';exception when insufficient_privilege then null;end;
 if exists(select from product_usage_events where user_id<>'00000000-0000-0000-0000-000000000002') then raise exception 'Other user telemetry exposed';end if;
 if get_personal_usage()->>'ai_completed'<>'1' then raise exception 'Personal scope incorrect';end if;
end$$;
reset role;
-- Account deletion still removes its telemetry and nulls retained task attribution.
delete from auth.users where id='00000000-0000-0000-0000-000000000002';
do $$begin
 if exists(select from product_usage_events where user_id='00000000-0000-0000-0000-000000000002') then raise exception 'Deleted account telemetry retained';end if;
 if not exists(select from jobs where id='00000000-0000-0000-0000-000000000022') then raise exception 'Account deletion crossed workspace';end if;
end$$;
select 'Usage analytics passed: saved work, failed transactions, retries, background completions, attribution, history, periods, deletion retention, and isolation.' as result;

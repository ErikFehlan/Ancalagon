\set ON_ERROR_STOP on
\ir job-reassessments.sql
create table candidate_documents(id uuid primary key default gen_random_uuid(),workspace_id uuid,job_id uuid,candidate_id uuid,storage_path text unique,file_name text,extracted_text text,created_at timestamptz default now(),
 foreign key(candidate_id,job_id,workspace_id) references candidates(id,job_id,workspace_id) on delete cascade);
\ir ../supabase/migrations/20260915090000_core_intake.sql
\ir review-conflicts.sql
insert into jobs(id,workspace_id,title,description) values('00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000000001','Core QA','Hands-on manual testing');
insert into candidates(id,job_id,workspace_id,role) values
 ('00000000-0000-0000-0000-000000000121','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000000001','Resume awaiting analysis'),
 ('00000000-0000-0000-0000-000000000122','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000000001','Resume awaiting analysis');
insert into candidate_assessments(workspace_id,job_id,candidate_id,assessment_type,evidence)
 select workspace_id,job_id,id,'manual_correction','{"resume_intake":{"phase":"uploading","backend":"durable-v1"},"submission_draft":{"text":"Preserve draft"}}' from candidates where job_id='00000000-0000-0000-0000-000000000111';
do $$begin if exists(select 1 from resume_intake_tasks) then raise exception 'AI queued before document saved';end if;end$$;
insert into candidate_documents(workspace_id,job_id,candidate_id,storage_path,file_name,extracted_text)
 select workspace_id,job_id,id,workspace_id||'/'||job_id||'/'||id||'/source.txt','Synthetic.txt','Synthetic Candidate. Owned manual regression testing for billing systems and documented defects.'
 from candidates where job_id='00000000-0000-0000-0000-000000000111';
do $$begin
 if (select count(*) from resume_intake_tasks)<>2 then raise exception 'Saved documents not queued';end if;
 if has_function_privilege('authenticated','public.claim_resume_intakes(uuid)','EXECUTE') or has_function_privilege('authenticated','public.resume_intake_input(uuid)','EXECUTE') then raise exception 'Private worker function exposed';end if;
 if has_table_privilege('authenticated','public.resume_intake_tasks','UPDATE') then raise exception 'Client can fabricate result';end if;
end$$;
create temp table intake_before as select * from resume_intake_tasks;
update candidates set role='Synthetic QA',primary_signal='Generated summary' where id='00000000-0000-0000-0000-000000000121';
select enqueue_resume_intake('00000000-0000-0000-0000-000000000121');
do $$begin if exists(select 1 from resume_intake_tasks t join intake_before b using(candidate_id) where t.revision<>b.revision) then raise exception 'Generated output changed intake revision';end if;end$$;
-- No artificial clock advance: a saved resume is immediately claimable.
create temp table intake_leases as select * from claim_resume_intakes();
do $$begin if (select count(*) from intake_leases)<>2 or exists(select 1 from claim_resume_intakes()) then raise exception 'Lease concurrency failed';end if;end$$;
insert into manager_feedback(id,workspace_id,job_id,candidate_id,feedback_text) values('00000000-0000-0000-0000-000000000131','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000000121','Candidate-specific manual testing ownership verified');
do $$declare t record;begin
 select * into t from intake_leases where candidate_id='00000000-0000-0000-0000-000000000121';
 if exists(select 1 from job_reassessment_tasks where job_id='00000000-0000-0000-0000-000000000111' and status in ('queued','processing','ready')) then raise exception 'Pending intake entered both AI pipelines';end if;
 if finish_resume_intake(t.candidate_id,t.revision,t.lease_id,'{}') then raise exception 'Stale result accepted';end if;
 if (select a.revision<>b.revision from resume_intake_tasks a join intake_before b using(candidate_id) where a.candidate_id='00000000-0000-0000-0000-000000000122') then raise exception 'Private note changed another candidate';end if;
end$$;
set role authenticated;
set test.workspace='00000000-0000-0000-0000-000000000002';
do $$begin
 if exists(select 1 from resume_intake_tasks) then raise exception 'Foreign intake exposed';end if;
 begin perform request_resume_intake('00000000-0000-0000-0000-000000000121');raise exception 'Foreign request accepted';exception when insufficient_privilege then null;end;
 begin perform review_resume_intake('00000000-0000-0000-0000-000000000121','wrong','approve');raise exception 'Foreign approval accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
update resume_intake_tasks set next_run_at=now()-interval '1 second',lease_until=now()-interval '1 second';
do $$declare t record;begin
 for t in select * from claim_resume_intakes() loop
  if not finish_resume_intake(t.candidate_id,t.revision,t.lease_id,'{"name":"Synthetic Candidate","role":"QA","score":8,"manager_score":8.5,"primary_signal":"Manual testing","jd_reason":"Testing demonstrated","manager_reason":"Ownership demonstrated","resume_evidence":[{"claim":"Manual testing","quote":"Owned manual regression testing for billing systems"}],"concerns":[],"tags":[],"screening_questions":[],"context_signature":"test"}') then raise exception 'Valid completion rejected';end if;
 end loop;
 if exists(select 1 from candidates where job_id='00000000-0000-0000-0000-000000000111' and manager_score<>7) then raise exception 'Intake changed score without review';end if;
end$$;
-- Both stale intake guards must return a non-retryable conflict as well.
set test.workspace='00000000-0000-0000-0000-000000000001';
do $$declare rev text;begin
 select revision into rev from resume_intake_tasks where candidate_id='00000000-0000-0000-0000-000000000121';
 begin perform review_resume_intake('00000000-0000-0000-0000-000000000121',null,'approve');raise exception 'Missing intake revision accepted';exception when sqlstate 'PT409' then null;end;
 update resume_intake_tasks set revision='old-intake-input' where candidate_id='00000000-0000-0000-0000-000000000121';
 begin perform review_resume_intake('00000000-0000-0000-0000-000000000121','old-intake-input','approve');raise exception 'Stale intake evidence accepted';exception when sqlstate 'PT409' then null;end;
 if (select manager_score<>7 from candidates where id='00000000-0000-0000-0000-000000000121') then raise exception 'Stale intake changed score';end if;
 update resume_intake_tasks set revision=rev where candidate_id='00000000-0000-0000-0000-000000000121';
end$$;
set role authenticated;
set test.workspace='00000000-0000-0000-0000-000000000001';
do $$declare result jsonb;rev text;begin
 select revision into rev from resume_intake_tasks where candidate_id='00000000-0000-0000-0000-000000000121';
 result:=review_resume_intake('00000000-0000-0000-0000-000000000121',rev,'approve');
 if (result#>>'{candidate,manager_score}')::numeric<>8.5 or (result#>>'{candidate,resume_jd_score}')::numeric<>8 then raise exception 'Approval not atomic';end if;
 if result#>>'{assessment,evidence,submission_draft,text}'<>'Preserve draft' then raise exception 'Draft lost';end if;
 if (select status from resume_intake_tasks where candidate_id='00000000-0000-0000-0000-000000000121')<>'approved' then raise exception 'Approval requeued intake';end if;
 result:=review_resume_intake('00000000-0000-0000-0000-000000000121',rev,'approve');
 if (result#>>'{candidate,manager_score}')::numeric<>8.5 then raise exception 'Lost approval response could not recover';end if;
end$$;
reset role;
-- Recover only the pre-release, unreviewed legacy verification failure.
update resume_intake_tasks set status='failed',error_code='verification_failed',attempts=3,updated_at='2026-09-15T16:00:00Z'
 where candidate_id='00000000-0000-0000-0000-000000000122';
\ir ../supabase/maintenance/20260915_retry_intakes.sql
do $$begin
 if (select status<>'queued' or attempts<>0 or error_code is not null from resume_intake_tasks where candidate_id='00000000-0000-0000-0000-000000000122') then raise exception 'Legacy intake did not recover';end if;
 if (select status<>'approved' from resume_intake_tasks where candidate_id='00000000-0000-0000-0000-000000000121') then raise exception 'Recovery changed a reviewed assessment';end if;
end$$;
update resume_intake_tasks set status='failed',error_code='verification_failed',attempts=3,updated_at='2026-09-15T18:00:00Z'
 where candidate_id='00000000-0000-0000-0000-000000000122';
\ir ../supabase/maintenance/20260915_retry_intakes.sql
do $$begin if (select status<>'failed' from resume_intake_tasks where candidate_id='00000000-0000-0000-0000-000000000122') then raise exception 'Repeated deployment retried a later failure';end if;end$$;
update jobs set status='closed' where id='00000000-0000-0000-0000-000000000111';
do $$begin if exists(select 1 from claim_resume_intakes()) then raise exception 'Closed job processed';end if;end$$;
update jobs set status='active' where id='00000000-0000-0000-0000-000000000111';
update resume_intake_tasks set attempts=3,next_run_at=now()-interval '1 second' where status='queued';
select count(*) from claim_resume_intakes();
do $$begin
 if exists(select 1 from resume_intake_tasks where candidate_id='00000000-0000-0000-0000-000000000122' and status<>'failed') then raise exception 'Retry limit missing';end if;
 if not can_access_resume_path('00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000111/00000000-0000-0000-0000-000000000121/source.txt') then raise exception 'Owner cannot access source';end if;
 if can_access_resume_path('00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000012/00000000-0000-0000-0000-000000000121/source.txt') then raise exception 'Mixed job storage path allowed';end if;
 begin update candidate_documents set storage_path='wrong/path' where candidate_id='00000000-0000-0000-0000-000000000121';raise exception 'Mixed document scope allowed';exception when check_violation then null;end;
end$$;
-- A completed intake immediately dispatches the next batch without a cron tick.
create table public.intake_dispatches(id bigserial primary key,body jsonb);
create or replace function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$insert into public.intake_dispatches(body) values($3) returning id$$;
delete from vault.decrypted_secrets where name in ('job_reassessment_url','job_reassessment_secret');
insert into vault.decrypted_secrets values('job_reassessment_url','https://worker.invalid'),('job_reassessment_secret','test-only');
insert into candidates(id,job_id,workspace_id,role) values
 ('00000000-0000-0000-0000-000000000123','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000000001','Resume awaiting analysis'),
 ('00000000-0000-0000-0000-000000000124','00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000000001','Resume awaiting analysis');
insert into candidate_assessments(workspace_id,job_id,candidate_id,assessment_type,evidence)
 select workspace_id,job_id,id,'manual_correction','{"resume_intake":{"phase":"uploading","backend":"durable-v1"}}' from candidates where id in ('00000000-0000-0000-0000-000000000123','00000000-0000-0000-0000-000000000124');
insert into candidate_documents(workspace_id,job_id,candidate_id,storage_path,file_name,extracted_text)
 select workspace_id,job_id,id,workspace_id||'/'||job_id||'/'||id||'/source.txt','Synthetic.txt','Synthetic Candidate. Owned manual regression testing for billing systems and documented defects.'
 from candidates where id in ('00000000-0000-0000-0000-000000000123','00000000-0000-0000-0000-000000000124');
update resume_intake_tasks set status='queued',attempts=0,next_run_at=now() where candidate_id='00000000-0000-0000-0000-000000000122';
create temp table batch_leases as select * from claim_resume_intakes();
truncate intake_dispatches;
do $$declare t record;r jsonb;begin
 if (select count(*) from batch_leases)<>2 or exists(select 1 from claim_resume_intakes()) then raise exception 'Intake concurrency limit changed';end if;
 select * into t from batch_leases order by candidate_id limit 1;
 select result into r from resume_intake_tasks where candidate_id='00000000-0000-0000-0000-000000000121';
 if not finish_resume_intake(t.candidate_id,t.revision,t.lease_id,r) then raise exception 'First batch did not complete';end if;
 if (select count(*) from intake_dispatches where body='{}'::jsonb)<>1 then raise exception 'Next batch waits for scheduler';end if;
 if (select count(*) from claim_resume_intakes())<>1 then raise exception 'Released slot was not filled immediately';end if;
 if (select count(*) from resume_intake_tasks where status='processing')<>2 then raise exception 'Batch refill exceeded concurrency';end if;
end$$;
delete from jobs where id='00000000-0000-0000-0000-000000000111';
do $$begin
 if exists(select 1 from resume_intake_tasks) then raise exception 'Deleted job left processing tasks';end if;
 if can_access_resume_path('00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000111/00000000-0000-0000-0000-000000000121/source.txt') then raise exception 'Deleted candidate still grants file access';end if;
end$$;

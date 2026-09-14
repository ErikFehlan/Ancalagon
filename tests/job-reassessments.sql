\set ON_ERROR_STOP on
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.user',true),'')::uuid$$;
create schema vault;
create table vault.decrypted_secrets(name text,decrypted_secret text);
create schema net;
create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$select 1::bigint$$;
create table public.workspaces(id uuid primary key);
create function public.is_workspace_member(w uuid) returns boolean language sql stable as $$select w::text=current_setting('test.workspace',true)$$;
create table public.jobs(id uuid primary key,workspace_id uuid references workspaces(id),title text,description text default '',criteria jsonb default '[]',manager_feedback text default '',knockouts jsonb default '[]',weights jsonb default '[]',status text default 'active',unique(id,workspace_id));
create table public.candidates(
 id uuid primary key,workspace_id uuid,job_id uuid,name text default 'Candidate',role text default '',stage text default 'Sourced',
 resume_jd_score numeric default 7,jd_score numeric default 7,original_manager_score numeric default 7,manager_score numeric default 7,
 confidence text default 'Low',recommendation text default 'Consider',primary_signal text default '',strengths jsonb default '[]',concerns jsonb default '[]',tags jsonb default '[]',screening_questions jsonb default '[]',
 created_at timestamptz default now(),updated_at timestamptz default now(),created_by uuid,
 unique(id,job_id,workspace_id),foreign key(job_id,workspace_id) references jobs(id,workspace_id) on delete cascade
);
create table public.manager_feedback(id uuid primary key,workspace_id uuid,job_id uuid,candidate_id uuid,feedback_type text default 'General note',outcome text default '',feedback_text text,created_at timestamptz default now(),updated_at timestamptz default now(),
 foreign key(candidate_id,job_id,workspace_id) references candidates(id,job_id,workspace_id) on delete cascade);
create table public.candidate_assessments(id uuid primary key default gen_random_uuid(),workspace_id uuid,job_id uuid,candidate_id uuid,assessment_type text,evidence jsonb default '{}',summary text default '',model text,jd_score numeric,manager_score numeric,recommendation text,created_by uuid,created_at timestamptz default now(),
 foreign key(candidate_id,job_id,workspace_id) references candidates(id,job_id,workspace_id) on delete cascade);
create table public.screening_insights(id uuid primary key default gen_random_uuid(),workspace_id uuid,job_id uuid,candidate_id uuid,notes text,can_do_job text,culture_working_style_fit text,created_at timestamptz default now(),
 foreign key(candidate_id,job_id,workspace_id) references candidates(id,job_id,workspace_id) on delete cascade);
create table public.interview_outcomes(id uuid primary key default gen_random_uuid(),workspace_id uuid,job_id uuid,candidate_id uuid,interview_stage text,decision text,positives text,concerns text,notes text,created_at timestamptz default now(),updated_at timestamptz default now(),
 foreign key(candidate_id,job_id,workspace_id) references candidates(id,job_id,workspace_id) on delete cascade);
\ir ../supabase/migrations/20260914160000_job_reassessments.sql
insert into auth.users values('00000000-0000-0000-0000-000000000001');
insert into workspaces values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into jobs(id,workspace_id,title) values
 ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','QA'),
 ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000002','PRIVATE JOB');
insert into candidates(id,workspace_id,job_id,strengths) values
 ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','["Manual testing"]'),
 ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','["Automation testing"]'),
 ('00000000-0000-0000-0000-000000000023','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000012','["PRIVATE CANDIDATE"]');
do $$begin if exists(select 1 from job_reassessment_tasks) then raise exception 'New candidates were charged for a duplicate assessment';end if;end$$;
update jobs set manager_feedback='Prioritize hands-on manual testing' where title='QA';
do $$declare a text;b text;begin
 if (select count(*) from job_reassessment_tasks)<>2 then raise exception 'Job change did not fan out';end if;
 if exists(select 1 from public.claim_job_reassessments(null)) then raise exception 'Debounce failed';end if;
 if exists(select 1 from job_reassessment_tasks where input::text like '%PRIVATE%') then raise exception 'Foreign evidence leaked';end if;
 select revision into a from job_reassessment_tasks where candidate_id='00000000-0000-0000-0000-000000000021';
 update jobs set title=title;
 select revision into b from job_reassessment_tasks where candidate_id='00000000-0000-0000-0000-000000000021';
 if a<>b then raise exception 'Unchanged save invalidated work';end if;
end$$;
-- A note affects its candidate, while an explicitly approved preference affects both.
create temp table before_revisions as select candidate_id,revision from job_reassessment_tasks;
insert into manager_feedback(id,workspace_id,job_id,candidate_id,feedback_text) values
 ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000021','CANDIDATE ONLY observation');
do $$begin
 if (select t.revision=b.revision from job_reassessment_tasks t join before_revisions b using(candidate_id) where t.candidate_id='00000000-0000-0000-0000-000000000021') then raise exception 'Candidate note not queued';end if;
 if (select t.revision<>b.revision from job_reassessment_tasks t join before_revisions b using(candidate_id) where t.candidate_id='00000000-0000-0000-0000-000000000022') then raise exception 'Candidate-only note affected another candidate';end if;
 if (select input::text like '%CANDIDATE ONLY%' from job_reassessment_tasks where candidate_id='00000000-0000-0000-0000-000000000022') then raise exception 'Candidate-only evidence leaked';end if;
end$$;
insert into candidate_assessments(workspace_id,job_id,candidate_id,assessment_type,evidence) values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000021','manager_feedback',
 '{"feedback_id":"00000000-0000-0000-0000-000000000031","learning_scope":"job","signal_status":"approved","signal_direction":"positive","signal_label":"Manual testing ownership"}');
do $$begin
 if not (select input::text like '%Manual testing ownership%' from job_reassessment_tasks where candidate_id='00000000-0000-0000-0000-000000000022') then raise exception 'Approved preference missing';end if;
end$$;
-- Latest source wins; leases cannot complete a superseded revision.
update job_reassessment_tasks set next_run_at=now()-interval '1 second';
create temp table leases as select * from public.claim_job_reassessments(null);
do $$begin
 if (select count(*) from leases)<>2 then raise exception 'Expected two claims';end if;
 if exists(select 1 from public.claim_job_reassessments(null)) then raise exception 'Duplicate claim';end if;
end$$;
update jobs set criteria='["Must Have | Manual testing ownership"]' where title='QA';
do $$declare l record;begin
 for l in select * from leases loop
 if public.finish_job_reassessment(l.candidate_id,l.revision,l.lease_id,'{"manager_score":9,"evidence_ids":["job-description"],"context_signature":"test"}') then raise exception 'Stale lease accepted';end if;
 end loop;
end$$;
-- Drafts survive an atomic score approval, and repeat approval is rejected.
insert into candidate_assessments(workspace_id,job_id,candidate_id,assessment_type,evidence) values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000021','manual_correction',
 '{"submission_draft":{"text":"Keep this draft","updatedAt":1},"review":null}');
update job_reassessment_tasks set next_run_at=now()-interval '1 second';
do $$declare l record;begin
 for l in select * from public.claim_job_reassessments(null) loop
 if not public.finish_job_reassessment(l.candidate_id,l.revision,l.lease_id,'{"manager_score":9,"jd_score":7,"manager_reason":"Ownership evidence supports this priority.","jd_reason":"Qualification baseline unchanged.","evidence_ids":["criterion-1"],"questions":[],"confidence":"medium","context_signature":"test-context","model":"test"}') then raise exception 'Valid completion rejected';end if;
 end loop;
 if exists(select 1 from candidates where manager_score<>7) then raise exception 'AI changed a score without review';end if;
 if has_function_privilege('authenticated','public.claim_job_reassessments(uuid)','EXECUTE') then raise exception 'Worker permission leaked';end if;
 if has_function_privilege('authenticated','public.reassessment_input(uuid)','EXECUTE') then raise exception 'Private input function leaked';end if;
 if has_table_privilege('authenticated','public.job_reassessment_tasks','UPDATE') then raise exception 'Direct proposal writes permitted';end if;
end$$;
set role authenticated;
set test.workspace='00000000-0000-0000-0000-000000000002';
set test.user='00000000-0000-0000-0000-000000000001';
do $$begin
 if exists(select 1 from job_reassessment_tasks) then raise exception 'RLS isolation failed';end if;
 begin perform public.review_job_reassessment('00000000-0000-0000-0000-000000000021','wrong','approve');raise exception 'Foreign review allowed';exception when insufficient_privilege then null;end;
 begin perform public.request_candidate_reassessment('00000000-0000-0000-0000-000000000021');raise exception 'Foreign enqueue allowed';exception when insufficient_privilege then null;end;
end$$;
set test.workspace='00000000-0000-0000-0000-000000000001';
do $$declare rev text;result jsonb;begin
 select revision into rev from job_reassessment_tasks where candidate_id='00000000-0000-0000-0000-000000000021';
 begin perform public.review_job_reassessment('00000000-0000-0000-0000-000000000021',null,'approve');raise exception 'Missing revision accepted';exception when serialization_failure then null;end;
 result:=public.review_job_reassessment('00000000-0000-0000-0000-000000000021',rev,'approve');
 if result#>>'{candidate,manager_score}'<>'9.0' and result#>>'{candidate,manager_score}'<>'9' then raise exception 'Score not saved atomically';end if;
 if result#>>'{assessment,evidence,submission_draft,text}'<>'Keep this draft' then raise exception 'Draft overwritten';end if;
 if result#>>'{assessment,evidence,review,history,0,previousScore}'<>'7' then raise exception 'Audit absent';end if;
 if (select status from job_reassessment_tasks where candidate_id='00000000-0000-0000-0000-000000000021')<>'approved' then raise exception 'Approval requeued itself';end if;
end$$;
reset role;
-- Ignoring a proposal keeps scores, and closed jobs cannot process.
set test.workspace='00000000-0000-0000-0000-000000000001';
select public.review_job_reassessment(candidate_id,revision,'ignore') from job_reassessment_tasks where candidate_id='00000000-0000-0000-0000-000000000022';
do $$begin if (select manager_score from candidates where id='00000000-0000-0000-0000-000000000022')<>7 then raise exception 'Ignore changed score';end if;end$$;
update jobs set title='QA updated' where title='QA';
update jobs set status='closed' where title='QA updated';
do $$begin if exists(select 1 from public.claim_job_reassessments(null)) then raise exception 'Closed job claimed';end if;end$$;
update jobs set status='active' where title='QA updated';
update job_reassessment_tasks set attempts=3,next_run_at=now()-interval '1 second';
select * from public.claim_job_reassessments(null);
do $$begin if exists(select 1 from job_reassessment_tasks where status<>'failed') then raise exception 'Retry limit missing';end if;end$$;
delete from jobs where title='QA updated';
do $$begin if exists(select 1 from job_reassessment_tasks) then raise exception 'Orphaned task';end if;end$$;

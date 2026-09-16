-- Exercise an upgrade from the deployed error codes, not only a fresh install.
do $$declare signature text;definition text;begin
 foreach signature in array array['public.review_job_reassessment(uuid,text,text)','public.review_resume_intake(uuid,text,text)'] loop
  select pg_get_functiondef(signature::regprocedure) into definition;
  execute replace(definition,'PT409','40001');
 end loop;
end$$;
\ir ../supabase/migrations/20260916190000_review_conflicts.sql
\ir ../supabase/migrations/20260916190000_review_conflicts.sql

do $$declare signature text;definition text;begin
 foreach signature in array array['public.review_job_reassessment(uuid,text,text)','public.review_resume_intake(uuid,text,text)'] loop
  select pg_get_functiondef(signature::regprocedure) into definition;
  if position('40001' in definition)>0 or position('PT409' in definition)=0 then raise exception 'Stale reviews still emit a retryable failure';end if;
  if has_function_privilege('anon',signature,'EXECUTE') or not has_function_privilege('authenticated',signature,'EXECUTE') then raise exception 'Review access changed';end if;
 end loop;
end$$;
insert into jobs(id,workspace_id,title) values('00000000-0000-0000-0000-000000000191','00000000-0000-0000-0000-000000000001','Conflict recovery fixture');
insert into candidates(id,workspace_id,job_id,role) values('00000000-0000-0000-0000-000000000192','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000191','QA');
insert into candidate_assessments(workspace_id,job_id,candidate_id,assessment_type,evidence) values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000191','00000000-0000-0000-0000-000000000192','manual_correction','{"submission_draft":{"text":"Keep conflict draft"},"review":null}');
select enqueue_job_reassessments('00000000-0000-0000-0000-000000000191');
-- The browser and task agree, but the current source fingerprint has changed:
-- this is the exact guard and error message from the incident.
update job_reassessment_tasks set status='ready',revision='old-input-shape',input='{}' where candidate_id='00000000-0000-0000-0000-000000000192';
set role authenticated;
set test.workspace='00000000-0000-0000-0000-000000000002';
do $$begin
 begin perform review_job_reassessment('00000000-0000-0000-0000-000000000192','old-input-shape','approve');raise exception 'Foreign stale review allowed';exception when insufficient_privilege then null;end;
end$$;
set test.workspace='00000000-0000-0000-0000-000000000001';
do $$declare decision text;begin
 begin perform review_job_reassessment('00000000-0000-0000-0000-000000000192',null,'approve');raise exception 'Missing revision accepted';exception when sqlstate 'PT409' then null;end;
 foreach decision in array array['approve','ignore'] loop
  begin perform review_job_reassessment('00000000-0000-0000-0000-000000000192','old-input-shape',decision);raise exception 'Stale evidence accepted';
  exception when sqlstate 'PT409' then
   if sqlerrm<>'Evidence changed. Review a fresh assessment.' then raise exception 'Wrong conflict guard exercised';end if;
  end;
 end loop;
 if (select status<>'ready' from job_reassessment_tasks where candidate_id='00000000-0000-0000-0000-000000000192') then raise exception 'Stale decision changed proposal';end if;
 perform request_candidate_reassessment('00000000-0000-0000-0000-000000000192');
 if not exists(select 1 from job_reassessment_tasks where candidate_id='00000000-0000-0000-0000-000000000192' and status='queued' and revision<>'old-input-shape') then raise exception 'Fresh request did not recover';end if;
end$$;
reset role;
do $$begin
 if (select manager_score<>7 or jd_score<>7 from candidates where id='00000000-0000-0000-0000-000000000192') then raise exception 'Stale decision changed scores';end if;
 if (select evidence#>>'{submission_draft,text}' from candidate_assessments where candidate_id='00000000-0000-0000-0000-000000000192')<>'Keep conflict draft' then raise exception 'Stale decision erased draft';end if;
end$$;
update job_reassessment_tasks set next_run_at=now()-interval '1 second' where candidate_id='00000000-0000-0000-0000-000000000192';
do $$declare t record;begin
 for t in select * from claim_job_reassessments('00000000-0000-0000-0000-000000000191') loop
  if not finish_job_reassessment(t.candidate_id,t.revision,t.lease_id,'{"manager_score":9,"jd_score":8,"manager_reason":"Updated evidence","jd_reason":"Updated role evidence","evidence_ids":["job-description"],"context_signature":"fresh-test"}') then raise exception 'Fresh result rejected';end if;
 end loop;
end$$;
set role authenticated;
do $$declare rev text;r jsonb;begin
 select revision into rev from job_reassessment_tasks where candidate_id='00000000-0000-0000-0000-000000000192' and status='ready';
 r:=review_job_reassessment('00000000-0000-0000-0000-000000000192',rev,'approve');
 if (r#>>'{candidate,manager_score}')::numeric<>9 or r#>>'{assessment,evidence,submission_draft,text}'<>'Keep conflict draft' then raise exception 'Fresh approval failed or erased draft';end if;
end$$;
reset role;
delete from jobs where id='00000000-0000-0000-0000-000000000191';

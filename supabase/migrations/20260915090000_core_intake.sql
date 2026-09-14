begin;

create or replace function public.reassessment_input(p_candidate uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
  select public.reassessment_job_input(c.job_id)||jsonb_build_object(
    'candidate',jsonb_build_object('id',c.id,'jobId',c.job_id,'role',c.role,'signal',c.primary_signal,
      'tags',c.tags,'strengths',c.strengths,'concerns',c.concerns,'resumeJDScore',coalesce(c.resume_jd_score,c.jd_score,0),
      'jdScore',coalesce(c.jd_score,0),'managerScore',coalesce(c.manager_score,0),'rec',coalesce(c.recommendation,'Screen First'),
      'screeningInsight',case when s.id is null then null else jsonb_build_object('notes',s.notes,'canDoJob',s.can_do_job,
        'cultureFit',s.culture_working_style_fit,'createdAt',coalesce(s.source_updated_at,floor(extract(epoch from s.created_at)*1000))) end,
      'resumeIntake',case when a.evidence->'resume_intake' is null or a.evidence->'resume_intake'='null'::jsonb then null else
        jsonb_build_object('brief',jsonb_build_object('resume_evidence',a.evidence#>'{resume_intake,brief,resume_evidence}'),
        'reviewedAt',a.evidence#>'{resume_intake,reviewedAt}') end,
      'aiReview',case when a.evidence#>>'{review,source}'='hybrid_reevaluation'
        then jsonb_build_object('source','hybrid_reevaluation','priorCorrection',a.evidence#>'{review,priorCorrection}')
        else a.evidence->'review' end),
    'feedback',coalesce((select jsonb_agg(f order by f->>'id') from jsonb_array_elements(public.reassessment_feedback(c.job_id)) f
      where f->>'candidateId'=c.id::text or (f->>'learningScope'='job' and f->>'signalStatus'='approved')),'[]'::jsonb),
    'outcomes',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'jobId',o.job_id,'candidateId',o.candidate_id,
      'stage',o.interview_stage,'decision',o.decision,'positives',o.positives,'concerns',o.concerns,'notes',o.notes,
      'createdAt',floor(extract(epoch from o.created_at)*1000),'updatedAt',coalesce(o.source_updated_at,floor(extract(epoch from o.updated_at)*1000))) order by o.id)
      from public.interview_outcomes o where o.candidate_id=c.id and o.job_id=c.job_id and o.workspace_id=c.workspace_id),'[]'::jsonb))
  from public.candidates c
  left join lateral(select * from public.screening_insights s where s.candidate_id=c.id and s.job_id=c.job_id and s.workspace_id=c.workspace_id order by s.created_at desc,s.id desc limit 1) s on true
  left join lateral(select evidence from public.candidate_assessments a where a.candidate_id=c.id and a.job_id=c.job_id and a.workspace_id=c.workspace_id and a.assessment_type='manual_correction' order by a.created_at desc,a.id desc limit 1) a on true
  where c.id=p_candidate;
$$;

create or replace function public.enqueue_job_reassessments(p_job uuid,p_candidate uuid default null,p_reason text default 'Job priorities changed') returns integer
language plpgsql security definer set search_path='' as $$
declare c record; payload jsonb; shared_revision text; n integer:=0; affected integer; active boolean;
begin
  select status='active' into active from public.jobs where id=p_job;
  if active is distinct from true then
    update public.job_reassessment_tasks set status='cancelled',lease_id=null,lease_until=null,updated_at=now()
      where job_id=p_job and status in ('queued','processing');
    return 0;
  end if;
  shared_revision:=md5(public.reassessment_job_input(p_job)::text);
  for c in select id,workspace_id,role from public.candidates where job_id=p_job and (p_candidate is null or id=p_candidate) order by id loop
    payload:=public.reassessment_input(c.id);
    -- Initial intake owns unreviewed resumes. Feedback still updates its revision,
    -- but must not start a second model pipeline against an empty profile.
    if c.role='Resume awaiting analysis' or
      (coalesce(payload#>'{candidate,resumeIntake}','null'::jsonb)<>'null'::jsonb
       and payload#>>'{candidate,resumeIntake,reviewedAt}' is null
       and coalesce(payload#>'{candidate,aiReview}','null'::jsonb)='null'::jsonb) then
      update public.job_reassessment_tasks set status='cancelled',lease_id=null,lease_until=null,result=null,updated_at=now()
      where candidate_id=c.id and status in ('queued','processing','ready','failed');
      continue;
    end if;
    insert into public.job_reassessment_tasks(candidate_id,job_id,workspace_id,revision,job_revision,input,reason,next_run_at)
      values(c.id,p_job,c.workspace_id,md5(payload::text),shared_revision,payload,p_reason,now()+interval '3 seconds')
    on conflict(candidate_id) do update set revision=excluded.revision,job_revision=excluded.job_revision,input=excluded.input,
      reason=excluded.reason,status='queued',attempts=0,next_run_at=excluded.next_run_at,lease_id=null,lease_until=null,
      result=null,error_code=null,reviewed_at=null,reviewed_by=null,updated_at=now()
      where job_reassessment_tasks.revision is distinct from excluded.revision or job_reassessment_tasks.status='cancelled';
    get diagnostics affected=row_count;n:=n+affected;
  end loop;
  if n>0 then perform public.wake_job_reassessments(p_job); end if;
  return n;
end $$;

-- Intake output is durable and independently versioned. Clients cannot publish
-- proposals or leases, and only an explicit authenticated review changes scores.
create table if not exists public.resume_intake_tasks (
  candidate_id uuid primary key, job_id uuid not null, workspace_id uuid not null,
  revision text not null, input jsonb not null,
  status text not null default 'queued' check(status in ('queued','processing','ready','approved','failed','cancelled')),
  attempts integer not null default 0, next_run_at timestamptz not null default now(),
  lease_id uuid, lease_until timestamptz, result jsonb, error_code text,
  updated_at timestamptz not null default now(), reviewed_at timestamptz, reviewed_by uuid references auth.users(id) on delete set null,
  foreign key(candidate_id,job_id,workspace_id) references public.candidates(id,job_id,workspace_id) on delete cascade
);
alter table public.resume_intake_tasks enable row level security;
revoke all on public.resume_intake_tasks from public,anon,authenticated;
grant select on public.resume_intake_tasks to authenticated;
grant all on public.resume_intake_tasks to service_role;
drop policy if exists resume_intake_read on public.resume_intake_tasks;
create policy resume_intake_read on public.resume_intake_tasks for select to authenticated using(public.is_workspace_member(workspace_id));
create index if not exists resume_intake_due on public.resume_intake_tasks(next_run_at) where status in ('queued','processing');
create index if not exists resume_intake_workspace on public.resume_intake_tasks(workspace_id,job_id);

create or replace function public.resume_intake_input(p_candidate uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
 select public.reassessment_input(c.id)||jsonb_build_object('document_id',d.id,'file_name',d.file_name,'resume_text',d.extracted_text)
 from public.candidates c join public.jobs j on j.id=c.job_id and j.workspace_id=c.workspace_id
 join lateral(select * from public.candidate_documents d where d.candidate_id=c.id and d.job_id=c.job_id and d.workspace_id=c.workspace_id order by d.created_at desc,d.id desc limit 1) d on true
 left join lateral(select evidence from public.candidate_assessments a where a.candidate_id=c.id and a.assessment_type='manual_correction' order by a.created_at desc,a.id desc limit 1) a on true
 where c.id=p_candidate and j.status='active' and length(trim(d.extracted_text)) between 40 and 120000
 and (c.role='Resume awaiting analysis' or (a.evidence->'resume_intake' is not null and a.evidence->'resume_intake'<>'null'::jsonb))
 and a.evidence#>>'{resume_intake,backend}'='durable-v1'
 and a.evidence#>>'{resume_intake,reviewedAt}' is null and coalesce(a.evidence->'review','null'::jsonb)='null'::jsonb;
$$;

create or replace function public.resume_intake_revision(p_input jsonb) returns text
language sql immutable set search_path='' as $$
 -- Profile summaries are generated output, not a new input to pending intake.
 select md5((p_input||jsonb_build_object('candidate',(p_input->'candidate')-'role'-'signal'-'tags'-'strengths'-'concerns'-'resumeJDScore'-'jdScore'-'managerScore'-'rec'-'aiReview'-'resumeIntake'))::text);
$$;

create or replace function public.enqueue_resume_intake(p_candidate uuid) returns void
language plpgsql security definer set search_path='' as $$
declare payload jsonb;c public.candidates;affected integer;
begin
 select * into c from public.candidates where id=p_candidate;
 if not found then return;end if;
 payload:=public.resume_intake_input(p_candidate);
 if payload is null then
  update public.resume_intake_tasks set status='cancelled',lease_id=null,lease_until=null,result=null,updated_at=now() where candidate_id=p_candidate and status<>'approved';return;
 end if;
 insert into public.resume_intake_tasks(candidate_id,job_id,workspace_id,revision,input,next_run_at)
 values(c.id,c.job_id,c.workspace_id,public.resume_intake_revision(payload),payload,now()+interval '3 seconds')
 on conflict(candidate_id) do update set revision=excluded.revision,input=excluded.input,status='queued',attempts=0,next_run_at=excluded.next_run_at,
  lease_id=null,lease_until=null,result=null,error_code=null,updated_at=now()
 where resume_intake_tasks.revision is distinct from excluded.revision or resume_intake_tasks.status='cancelled';
 get diagnostics affected=row_count;
 if affected>0 then perform public.wake_job_reassessments(c.job_id);end if;
end $$;

create or replace function public.intake_source_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare j uuid;c record;
begin
 if tg_table_name='jobs' then
  if row(new.title,new.description,new.criteria,new.manager_feedback,new.knockouts,new.weights,new.status)
    is not distinct from row(old.title,old.description,old.criteria,old.manager_feedback,old.knockouts,old.weights,old.status) then return new;end if;
  j:=new.id;
 elsif tg_op='DELETE' then j:=old.job_id;else j:=new.job_id;end if;
 -- Revisions decide which candidates changed. Candidate-only notes do not
 -- invalidate another candidate; approved preferences do.
 for c in select id from public.candidates where job_id=j and
  (role='Resume awaiting analysis' or exists(select 1 from public.resume_intake_tasks t where t.candidate_id=candidates.id)) loop
  perform public.enqueue_resume_intake(c.id);
 end loop;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
drop trigger if exists core_intake_job on public.jobs;
create trigger core_intake_job after update on public.jobs for each row execute function public.intake_source_changed();
do $$declare t text;begin
 foreach t in array array['candidate_documents','manager_feedback','candidate_assessments','interview_outcomes','screening_insights'] loop
  execute format('drop trigger if exists core_intake_source on public.%I',t);
  execute format('create trigger core_intake_source after insert or update or delete on public.%I for each row execute function public.intake_source_changed()',t);
 end loop;
end $$;

create or replace function public.request_resume_intake(p_candidate uuid,p_retry boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare c public.candidates;
begin
 select * into c from public.candidates where id=p_candidate;
 if not found or not public.is_workspace_member(c.workspace_id) then raise exception 'Candidate unavailable' using errcode='42501';end if;
 perform public.enqueue_resume_intake(c.id);
 if p_retry then update public.resume_intake_tasks set status='queued',attempts=0,error_code=null,next_run_at=now(),updated_at=now() where candidate_id=c.id and status='failed';end if;
 if exists(select 1 from public.resume_intake_tasks where candidate_id=c.id and status='queued') then perform public.wake_job_reassessments(c.job_id);end if;
end $$;

create or replace function public.claim_resume_intakes(p_job uuid default null) returns setof public.resume_intake_tasks
language plpgsql security definer set search_path='' as $$
declare slots integer;
begin
 perform pg_advisory_xact_lock(15090000);
 update public.resume_intake_tasks set status='failed',error_code='retry_limit',lease_id=null,lease_until=null,updated_at=now()
 where attempts>=3 and (status='queued' or (status='processing' and lease_until<now()));
 slots:=greatest(0,2-(select count(*)::integer from public.resume_intake_tasks where status='processing' and lease_until>=now()));
 return query with due as (
  select t.candidate_id from public.resume_intake_tasks t join public.jobs j on j.id=t.job_id and j.workspace_id=t.workspace_id
  where j.status='active' and (p_job is null or t.job_id=p_job) and attempts<3
  and ((t.status='queued' and next_run_at<=now()) or (t.status='processing' and lease_until<now()))
  order by next_run_at,t.candidate_id for update of t skip locked limit slots)
 update public.resume_intake_tasks t set status='processing',attempts=t.attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes',updated_at=now()
 from due where t.candidate_id=due.candidate_id returning t.*;
end $$;

create or replace function public.finish_resume_intake(p_candidate uuid,p_revision text,p_lease uuid,p_result jsonb,p_error text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare t public.resume_intake_tasks;payload jsonb;
begin
 select * into t from public.resume_intake_tasks where candidate_id=p_candidate for update;
 if not found or t.revision<>p_revision or t.lease_id is distinct from p_lease or t.status<>'processing' or t.lease_until<now() then return false;end if;
 payload:=public.resume_intake_input(p_candidate);
 if payload is null or public.resume_intake_revision(payload) is distinct from p_revision then perform public.enqueue_resume_intake(p_candidate);return false;end if;
 if p_error is null and (jsonb_typeof(p_result->'score') is distinct from 'number' or (p_result->>'score')::numeric not between 0 and 10
  or jsonb_typeof(p_result->'manager_score') is distinct from 'number' or (p_result->>'manager_score')::numeric not between 0 and 10
  or jsonb_typeof(p_result->'resume_evidence') is distinct from 'array' or nullif(p_result->>'context_signature','') is null) then raise exception 'Invalid intake result';end if;
 update public.resume_intake_tasks set status=case when p_error is null then 'ready' when attempts>=3 then 'failed' else 'queued' end,
 result=case when p_error is null then p_result else null end,error_code=left(p_error,80),next_run_at=now()+interval '20 seconds'*power(2,attempts),
 lease_id=null,lease_until=null,updated_at=now() where candidate_id=p_candidate;
 return true;
end $$;

create or replace function public.review_resume_intake(p_candidate uuid,p_revision text,p_decision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.resume_intake_tasks;c public.candidates;a public.candidate_assessments;r jsonb;review jsonb;intake jsonb;stamp bigint;rec text;
begin
 if p_decision is distinct from 'approve' then raise exception 'Invalid decision';end if;
 select * into c from public.candidates where id=p_candidate for update;
 if not found or not public.is_workspace_member(c.workspace_id) then raise exception 'Candidate unavailable' using errcode='42501';end if;
 select * into t from public.resume_intake_tasks where candidate_id=c.id for update;
 if not found or t.revision is distinct from p_revision then
  raise exception 'Evidence changed. Review the latest assessment.' using errcode='40001';end if;
 select * into a from public.candidate_assessments where candidate_id=c.id and assessment_type='manual_correction' order by created_at desc,id desc limit 1 for update;
 -- Recover a response lost after the transaction committed. Return current
 -- records, never replay old scores over subsequent recruiter corrections.
 if t.status='approved' then return jsonb_build_object('status','approved','candidate',to_jsonb(c),'assessment',to_jsonb(a));end if;
 if t.status<>'ready' or public.resume_intake_revision(public.resume_intake_input(c.id)) is distinct from p_revision then
  raise exception 'Evidence changed. Review the latest assessment.' using errcode='40001';end if;
 r:=t.result;stamp:=floor(extract(epoch from now())*1000);
 rec:=case when (r->>'manager_score')::numeric>=9.2 then 'Interview' when (r->>'manager_score')::numeric>=8.3 then 'Strong Consideration' when (r->>'manager_score')::numeric>=7.2 then 'Consider' when (r->>'manager_score')::numeric>=6 then 'Screen First' else 'Not Recommended' end;
 review:=jsonb_build_object('source','resume_intake','verdict','Needs Adjustment','correctedScore',r->'manager_score','correctedJDScore',r->'score',
 'notes',r->>'manager_reason','jdReason',r->>'jd_reason','createdAt',stamp,'reasons',jsonb_build_array('Resume assessment reviewed'),'model',r->>'model');
 intake:=coalesce(a.evidence->'resume_intake','{}'::jsonb)||jsonb_build_object('brief',r,'signature',r->>'context_signature','remoteRevision',t.revision,'phase','ready','stored',true,'reviewedAt',stamp,'updatedAt',stamp,'error','');
 update public.candidates set name=case when r->>'name'='Candidate' then name else r->>'name' end,role=r->>'role',
 primary_signal=r->>'primary_signal',strengths=coalesce((select jsonb_agg((e->>'claim')||' — Resume: “'||(e->>'quote')||'”') from jsonb_array_elements(r->'resume_evidence') e),'[]'::jsonb),
 concerns=r->'concerns',tags=r->'tags',screening_questions=r->'screening_questions',resume_jd_score=(r->>'score')::numeric,jd_score=(r->>'score')::numeric,
 original_manager_score=(r->>'manager_score')::numeric,manager_score=(r->>'manager_score')::numeric,recommendation=rec,confidence='Low' where id=c.id returning * into c;
 if a.id is null then
  insert into public.candidate_assessments(workspace_id,job_id,candidate_id,assessment_type,jd_score,manager_score,recommendation,summary,evidence,created_by)
  values(c.workspace_id,c.job_id,c.id,'manual_correction',c.jd_score,c.manager_score,rec,review->>'notes',jsonb_build_object('review',review,'resume_intake',intake),auth.uid()) returning * into a;
 else
  update public.candidate_assessments set jd_score=c.jd_score,manager_score=c.manager_score,recommendation=rec,summary=review->>'notes',
  evidence=a.evidence||jsonb_build_object('review',review,'resume_intake',intake) where id=a.id returning * into a;
 end if;
 update public.resume_intake_tasks set status='approved',result=r,reviewed_at=now(),reviewed_by=auth.uid(),updated_at=now() where candidate_id=c.id;
 return jsonb_build_object('status','approved','candidate',to_jsonb(c),'assessment',to_jsonb(a));
end $$;

-- Storage authorization covers the candidate and job as well as the workspace.
create or replace function public.can_access_resume_path(object_name text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare parts text[]:=string_to_array(object_name,'/');
begin
 if array_length(parts,1)<>4 then return false;end if;
 return public.is_workspace_member(parts[1]::uuid) and exists(select 1 from public.candidates where id=parts[3]::uuid and job_id=parts[2]::uuid and workspace_id=parts[1]::uuid);
exception when others then return false;
end $$;
create or replace function public.check_resume_document_path() returns trigger language plpgsql set search_path='' as $$
begin
 if split_part(new.storage_path,'/',1)<>new.workspace_id::text or split_part(new.storage_path,'/',2)<>new.job_id::text
 or split_part(new.storage_path,'/',3)<>new.candidate_id::text or array_length(string_to_array(new.storage_path,'/'),1)<>4 then raise exception 'Invalid document scope' using errcode='23514';end if;
 return new;
end $$;
drop trigger if exists core_document_scope on public.candidate_documents;
create trigger core_document_scope before insert or update on public.candidate_documents for each row execute function public.check_resume_document_path();

revoke all on function public.resume_intake_input(uuid),public.resume_intake_revision(jsonb),public.enqueue_resume_intake(uuid),public.intake_source_changed(),
 public.request_resume_intake(uuid,boolean),public.claim_resume_intakes(uuid),public.finish_resume_intake(uuid,text,uuid,jsonb,text),public.review_resume_intake(uuid,text,text),public.check_resume_document_path() from public,anon,authenticated;
grant execute on function public.request_resume_intake(uuid,boolean),public.review_resume_intake(uuid,text,text) to authenticated;
grant execute on function public.claim_resume_intakes(uuid),public.finish_resume_intake(uuid,text,uuid,jsonb,text) to service_role;
commit;

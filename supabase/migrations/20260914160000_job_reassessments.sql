begin;
create table if not exists public.job_reassessment_tasks (
  candidate_id uuid primary key,
  job_id uuid not null,
  workspace_id uuid not null,
  revision text not null,
  job_revision text not null,
  input jsonb not null,
  reason text not null,
  status text not null default 'queued' check(status in ('queued','processing','ready','approved','ignored','failed','cancelled')),
  attempts integer not null default 0,
  next_run_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  result jsonb,
  error_code text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key(candidate_id,job_id,workspace_id) references public.candidates(id,job_id,workspace_id) on delete cascade
);
alter table public.job_reassessment_tasks enable row level security;
revoke all on public.job_reassessment_tasks from public,anon,authenticated;
grant select on public.job_reassessment_tasks to authenticated;
grant all on public.job_reassessment_tasks to service_role;
create policy job_reassessment_read on public.job_reassessment_tasks for select to authenticated using(public.is_workspace_member(workspace_id));
create index job_reassessment_due on public.job_reassessment_tasks(next_run_at) where status in ('queued','processing');
create index job_reassessment_job on public.job_reassessment_tasks(workspace_id,job_id);

-- Read only the most recent metadata for each observation. Candidate-only
-- interpretation drafts never become shared manager preferences.
create function public.reassessment_feedback(p_job uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',f.id,'jobId',f.job_id,'candidateId',f.candidate_id,'type',f.feedback_type,'outcome',coalesce(f.outcome,''),
    'text',f.feedback_text,'createdAt',floor(extract(epoch from f.created_at)*1000),
    'updatedAt',case when jsonb_typeof(a.evidence->'source_updated_at')='number' then a.evidence->'source_updated_at' else to_jsonb(floor(extract(epoch from f.updated_at)*1000)) end,
    'learningScope',coalesce(a.evidence->>'learning_scope','candidate'),
    'signalStatus',coalesce(a.evidence->>'signal_status','candidate_only'),
    'signalLabel',coalesce(a.evidence->>'signal_label',''),
    'signalDirection',coalesce(a.evidence->>'signal_direction','neutral'),
    'interpretation',case when a.evidence#>>'{interpretation,source}'='recruiter' then a.evidence->'interpretation' else null end
  ) order by f.id),'[]'::jsonb)
  from public.manager_feedback f left join lateral (
    select evidence from public.candidate_assessments a
    where a.job_id=f.job_id and a.workspace_id=f.workspace_id and a.candidate_id=f.candidate_id
      and a.assessment_type='manager_feedback' and a.evidence->>'feedback_id'=f.id::text
    order by a.created_at desc,a.id desc limit 1
  ) a on true where f.job_id=p_job;
$$;
create function public.reassessment_job_input(p_job uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
  select jsonb_build_object('job',jsonb_build_object('id',j.id,'title',j.title,'description',j.description,
    'criteria',j.criteria,'managerFeedback',j.manager_feedback,'knockouts',j.knockouts,'weights',j.weights),
    'preferences',coalesce((select jsonb_agg(f-'interpretation' order by f->>'id') from jsonb_array_elements(public.reassessment_feedback(j.id)) f
      where f->>'learningScope'='job' and f->>'signalStatus'='approved'),'[]'::jsonb))
  from public.jobs j where j.id=p_job;
$$;
create function public.reassessment_input(p_candidate uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
  select public.reassessment_job_input(c.job_id)||jsonb_build_object(
    'candidate',jsonb_build_object('id',c.id,'jobId',c.job_id,'role',c.role,'signal',c.primary_signal,
      'tags',c.tags,'strengths',c.strengths,'concerns',c.concerns,'resumeJDScore',coalesce(c.resume_jd_score,c.jd_score,0),
      'jdScore',coalesce(c.jd_score,0),'managerScore',coalesce(c.manager_score,0),'rec',coalesce(c.recommendation,'Screen First'),
      'screeningInsight',case when s.id is null then null else jsonb_build_object('notes',s.notes,'canDoJob',s.can_do_job,
        'cultureFit',s.culture_working_style_fit,'createdAt',floor(extract(epoch from s.created_at)*1000)) end,
      'aiReview',case when a.evidence#>>'{review,source}'='hybrid_reevaluation'
        then jsonb_build_object('source','hybrid_reevaluation','priorCorrection',a.evidence#>'{review,priorCorrection}')
        else a.evidence->'review' end),
    'feedback',coalesce((select jsonb_agg(f order by f->>'id') from jsonb_array_elements(public.reassessment_feedback(c.job_id)) f
      where f->>'candidateId'=c.id::text or (f->>'learningScope'='job' and f->>'signalStatus'='approved')),'[]'::jsonb),
    'outcomes',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'jobId',o.job_id,'candidateId',o.candidate_id,
      'stage',o.interview_stage,'decision',o.decision,'positives',o.positives,'concerns',o.concerns,'notes',o.notes,
      'createdAt',floor(extract(epoch from o.created_at)*1000),'updatedAt',floor(extract(epoch from o.updated_at)*1000)) order by o.id)
      from public.interview_outcomes o where o.candidate_id=c.id and o.job_id=c.job_id and o.workspace_id=c.workspace_id),'[]'::jsonb))
  from public.candidates c
  left join lateral(select * from public.screening_insights s where s.candidate_id=c.id and s.job_id=c.job_id and s.workspace_id=c.workspace_id order by s.created_at desc,s.id desc limit 1) s on true
  left join lateral(select evidence from public.candidate_assessments a where a.candidate_id=c.id and a.job_id=c.job_id and a.workspace_id=c.workspace_id and a.assessment_type='manual_correction' order by a.created_at desc,a.id desc limit 1) a on true
  where c.id=p_candidate;
$$;

create function public.wake_job_reassessments(p_job uuid default null) returns void
language plpgsql security definer set search_path='' as $$
declare worker_url text; worker_secret text;
begin
  select decrypted_secret into worker_url from vault.decrypted_secrets where name='job_reassessment_url';
  select decrypted_secret into worker_secret from vault.decrypted_secrets where name='job_reassessment_secret';
  if nullif(worker_url,'') is null or nullif(worker_secret,'') is null then return; end if;
  perform net.http_post(url:=worker_url,headers:=jsonb_build_object('Content-Type','application/json','x-worker-secret',worker_secret),
    body:=case when p_job is null then '{}'::jsonb else jsonb_build_object('job_id',p_job) end,timeout_milliseconds:=90000);
exception when others then
  raise warning 'Reassessment dispatch unavailable; scheduler will retry';
end $$;

create function public.enqueue_job_reassessments(p_job uuid,p_candidate uuid default null,p_reason text default 'Job priorities changed') returns integer
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
  for c in select id,workspace_id from public.candidates where job_id=p_job and (p_candidate is null or id=p_candidate) order by id loop
    payload:=public.reassessment_input(c.id);
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

create function public.reassessment_job_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if row(new.title,new.description,new.criteria,new.manager_feedback,new.knockouts,new.weights,new.status)
    is distinct from row(old.title,old.description,old.criteria,old.manager_feedback,old.knockouts,old.weights,old.status) then
    perform public.enqueue_job_reassessments(new.id,null,'Job requirements or priorities changed');
  end if;
  return new;
end $$;
create trigger reassessment_job_changed after update of title,description,criteria,manager_feedback,knockouts,weights,status
on public.jobs for each row execute function public.reassessment_job_changed();

create function public.reassessment_evidence_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare j uuid; c uuid; shared_revision text; approved boolean:=false;
begin
  if tg_op='DELETE' then
    j:=old.job_id;if tg_table_name='candidates' then c:=old.id;else c:=old.candidate_id;end if;
  else
    j:=new.job_id;if tg_table_name='candidates' then c:=new.id;else c:=new.candidate_id;end if;
  end if;
  if tg_table_name='candidate_assessments' and tg_op<>'DELETE' then
    approved:=new.assessment_type='manager_feedback' and new.evidence->>'learning_scope'='job' and new.evidence->>'signal_status'='approved';
  end if;
  shared_revision:=md5(public.reassessment_job_input(j)::text);
  if exists(select 1 from public.job_reassessment_tasks where job_id=j and job_revision is distinct from shared_revision) or approved then
    perform public.enqueue_job_reassessments(j,null,'Approved manager preferences changed');
  elsif tg_table_name in ('manager_feedback','interview_outcomes','screening_insights')
    or exists(select 1 from public.job_reassessment_tasks where candidate_id=c)
    or (tg_table_name='candidates' and tg_op='INSERT' and exists(select 1 from public.job_reassessment_tasks where job_id=j)) then
    perform public.enqueue_job_reassessments(j,c,'Candidate evidence changed');
  end if;
  if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger reassessment_candidate_changed after insert or update on public.candidates for each row execute function public.reassessment_evidence_changed();
create trigger reassessment_feedback_changed after insert or update or delete on public.manager_feedback for each row execute function public.reassessment_evidence_changed();
create trigger reassessment_metadata_changed after insert or update or delete on public.candidate_assessments for each row execute function public.reassessment_evidence_changed();
create trigger reassessment_outcomes_changed after insert or update or delete on public.interview_outcomes for each row execute function public.reassessment_evidence_changed();
create trigger reassessment_screening_changed after insert or update or delete on public.screening_insights for each row execute function public.reassessment_evidence_changed();

create function public.claim_job_reassessments(p_job uuid default null) returns setof public.job_reassessment_tasks
language plpgsql security definer set search_path='' as $$
declare slots integer;
begin
  -- Serialize claims briefly; a second HTTP dispatch cannot exceed the limit.
  perform pg_advisory_xact_lock(14160000);
  update public.job_reassessment_tasks set status='failed',error_code='retry_limit',lease_id=null,lease_until=null,updated_at=now()
    where attempts>=3 and (status='queued' or (status='processing' and lease_until<now()));
  slots:=greatest(0,4-(select count(*)::integer from public.job_reassessment_tasks where status='processing' and lease_until>=now()));
  return query with due as (
    select t.candidate_id from public.job_reassessment_tasks t join public.jobs j on j.id=t.job_id
    where j.status='active' and (p_job is null or t.job_id=p_job) and attempts<3
      and ((t.status='queued' and next_run_at<=now()) or (t.status='processing' and lease_until<now()))
    order by next_run_at,t.candidate_id for update of t skip locked limit least(2,slots))
  update public.job_reassessment_tasks t set status='processing',attempts=t.attempts+1,lease_id=gen_random_uuid(),
    lease_until=now()+interval '3 minutes',updated_at=now() from due where t.candidate_id=due.candidate_id returning t.*;
end $$;

create function public.finish_job_reassessment(p_candidate uuid,p_revision text,p_lease uuid,p_result jsonb,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare task public.job_reassessment_tasks;
begin
  select * into task from public.job_reassessment_tasks where candidate_id=p_candidate for update;
  if not found or task.revision<>p_revision or task.lease_id is distinct from p_lease or task.status<>'processing' or task.lease_until<now() then return false;end if;
  if md5(public.reassessment_input(p_candidate)::text) is distinct from p_revision then
    perform public.enqueue_job_reassessments(task.job_id,p_candidate,'Evidence changed during assessment');return false;
  end if;
  if p_error is null and (jsonb_typeof(p_result->'manager_score') is distinct from 'number'
      or (p_result->>'manager_score')::numeric not between 0 and 10
      or jsonb_typeof(p_result->'evidence_ids') is distinct from 'array'
      or nullif(p_result->>'context_signature','') is null) then raise exception 'Invalid assessment result';end if;
  update public.job_reassessment_tasks set status=case when p_error is null then 'ready' when attempts>=3 then 'failed' else 'queued' end,
    result=case when p_error is null then p_result else null end,error_code=case when p_error is null then null else left(p_error,80) end,
    next_run_at=now()+interval '15 seconds'*power(2,attempts),lease_id=null,lease_until=null,updated_at=now()
    where candidate_id=p_candidate;
  return true;
end $$;

create function public.continue_job_reassessments(p_job uuid default null) returns void
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.job_reassessment_tasks where (p_job is null or job_id=p_job) and status='queued' and next_run_at<=now()+interval '3 seconds')
    then perform public.wake_job_reassessments(p_job);end if;
end $$;

create function public.request_candidate_reassessment(p_candidate uuid) returns void language plpgsql security definer set search_path='' as $
declare c public.candidates;
begin
 select * into c from public.candidates where id=p_candidate;
 if not found or not public.is_workspace_member(c.workspace_id) then raise exception 'Candidate unavailable' using errcode='42501';end if;
 perform public.enqueue_job_reassessments(c.job_id,c.id,'Candidate feedback updated');
end $;

create function public.review_job_reassessment(p_candidate uuid,p_revision text,p_decision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare task public.job_reassessment_tasks; c public.candidates; a public.candidate_assessments;
  prior jsonb; review jsonb; audit jsonb; score numeric; recommendation text; stamp bigint; history jsonb;
begin
  if p_decision is null or p_decision not in ('approve','ignore','retry') then raise exception 'Invalid decision';end if;
  select * into task from public.job_reassessment_tasks where candidate_id=p_candidate for update;
  if not found or not public.is_workspace_member(task.workspace_id) then raise exception 'Assessment unavailable' using errcode='42501';end if;
  if not exists(select 1 from public.jobs where id=task.job_id and status='active') then raise exception 'Reopen the job before reviewing assessments';end if;
  if task.revision is distinct from p_revision then raise exception 'Evidence changed. Review the latest assessment.' using errcode='40001';end if;
  if p_decision='retry' then
    if task.status<>'failed' then raise exception 'Only failed assessments can be retried';end if;
    update public.job_reassessment_tasks set status='queued',attempts=0,next_run_at=now(),error_code=null,updated_at=now() where candidate_id=p_candidate;
    perform public.wake_job_reassessments(task.job_id);return jsonb_build_object('status','queued');
  end if;
  if task.status<>'ready' then raise exception 'Assessment is not ready for review';end if;
  if md5(public.reassessment_input(p_candidate)::text) is distinct from p_revision then raise exception 'Evidence changed. Review a fresh assessment.' using errcode='40001';end if;
  if p_decision='ignore' then
    update public.job_reassessment_tasks set status='ignored',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where candidate_id=p_candidate;
    return jsonb_build_object('status','ignored');
  end if;
  select * into c from public.candidates where id=p_candidate for update;
  select * into a from public.candidate_assessments where candidate_id=c.id and job_id=c.job_id and workspace_id=c.workspace_id and assessment_type='manual_correction'
    order by created_at desc,id desc limit 1 for update;
  prior:=a.evidence->'review';score:=(task.result->>'manager_score')::numeric;
  if score is null or score not between 0 and 10 then raise exception 'Invalid proposed score';end if;
  score:=round(score,1);stamp:=floor(extract(epoch from now())*1000);
  recommendation:=case when score>=9.2 then 'Interview' when score>=8.3 then 'Strong Consideration' when score>=7.2 then 'Consider' when score>=6 then 'Screen First' else 'Not Recommended' end;
  audit:=jsonb_build_object('previousScore',c.manager_score,'newScore',score,'previousRecommendation',c.recommendation,'newRecommendation',recommendation,
    'reasons',jsonb_build_array(task.result->>'manager_reason',task.result->>'jd_reason'),'appliedAt',stamp,'source','job_reassessment','revision',task.revision);
  select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) into history from (
    select value,ord from jsonb_array_elements(coalesce(prior->'history','[]'::jsonb)||jsonb_build_array(audit)) with ordinality as h(value,ord) order by ord desc limit 20
  ) h;
  review:=jsonb_build_object('verdict','Needs Adjustment','correctedScore',score,'reasons',jsonb_build_array('Job-wide AI assessment'),
    'notes',concat_ws(' · ',task.result->>'manager_reason',task.result->>'jd_reason'),'source','hybrid_reevaluation',
    'priorCorrection',case when prior->>'source'='hybrid_reevaluation' then prior->'priorCorrection' else prior end,
    'contextSignature',task.result->>'context_signature','model',task.result->>'model','history',history,'createdAt',stamp);
  update public.candidates set manager_score=score,recommendation=recommendation where id=c.id returning * into c;
  if a.id is null then
    insert into public.candidate_assessments(workspace_id,job_id,candidate_id,assessment_type,jd_score,manager_score,recommendation,summary,evidence,created_by)
      values(c.workspace_id,c.job_id,c.id,'manual_correction',c.jd_score,score,recommendation,review->>'notes',jsonb_build_object('review',review),auth.uid()) returning * into a;
  else
    update public.candidate_assessments set manager_score=score,recommendation=recommendation,summary=review->>'notes',
      evidence=jsonb_set(a.evidence,'{review}',review) where id=a.id returning * into a;
  end if;
  -- Source triggers may have invalidated the proposal while persisting approval.
  -- Finish in the same transaction with the new baseline and the original audit.
  update public.job_reassessment_tasks set status='approved',revision=md5(public.reassessment_input(c.id)::text),
    input=public.reassessment_input(c.id),result=task.result,lease_id=null,lease_until=null,
    reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where candidate_id=c.id;
  return jsonb_build_object('status','approved','candidate',to_jsonb(c),'assessment',to_jsonb(a));
end $$;

revoke all on function public.reassessment_feedback(uuid),public.reassessment_job_input(uuid),public.reassessment_input(uuid),
 public.wake_job_reassessments(uuid),public.enqueue_job_reassessments(uuid,uuid,text),public.reassessment_job_changed(),
 public.reassessment_evidence_changed(),public.claim_job_reassessments(uuid),public.finish_job_reassessment(uuid,text,uuid,jsonb,text),
 public.continue_job_reassessments(uuid),public.review_job_reassessment(uuid,text,text),public.request_candidate_reassessment(uuid) from public,anon,authenticated;
grant execute on function public.claim_job_reassessments(uuid),public.finish_job_reassessment(uuid,text,uuid,jsonb,text),public.continue_job_reassessments(uuid) to service_role;
grant execute on function public.review_job_reassessment(uuid,text,text),public.request_candidate_reassessment(uuid) to authenticated;
commit;

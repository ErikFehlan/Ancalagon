-- Stale evidence is an application conflict, not a serialization failure.
-- SQLSTATE 40001 can cause transaction-level retries of the same stale review.
-- PT409 returns one HTTP 409 so the client can request and review fresh evidence.
-- Replace deployed functions as well as fixing the initial migrations.
begin;
set local lock_timeout = '5s';

create or replace function public.review_job_reassessment(p_candidate uuid,p_revision text,p_decision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare task public.job_reassessment_tasks; c public.candidates; a public.candidate_assessments;
  prior jsonb; review jsonb; audit jsonb; score numeric; jdscore numeric; proposed_recommendation text; stamp bigint; history jsonb;
begin
  if p_decision is null or p_decision not in ('approve','ignore','retry') then raise exception 'Invalid decision';end if;
  select * into task from public.job_reassessment_tasks where candidate_id=p_candidate for update;
  if not found or not public.is_workspace_member(task.workspace_id) then raise exception 'Assessment unavailable' using errcode='42501';end if;
  if not exists(select 1 from public.jobs where id=task.job_id and status='active') then raise exception 'Reopen the job before reviewing assessments';end if;
  if task.revision is distinct from p_revision then raise exception 'Evidence changed. Review the latest assessment.' using errcode='PT409';end if;
  if p_decision='retry' then
    if task.status<>'failed' then raise exception 'Only failed assessments can be retried';end if;
    update public.job_reassessment_tasks set status='queued',attempts=0,next_run_at=now(),error_code=null,updated_at=now() where candidate_id=p_candidate;
    perform public.wake_job_reassessments(task.job_id);return jsonb_build_object('status','queued');
  end if;
  if task.status<>'ready' then raise exception 'Assessment is not ready for review';end if;
  if md5(public.reassessment_input(p_candidate)::text) is distinct from p_revision then raise exception 'Evidence changed. Review a fresh assessment.' using errcode='PT409';end if;
  if p_decision='ignore' then
    update public.job_reassessment_tasks set status='ignored',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where candidate_id=p_candidate;
    return jsonb_build_object('status','ignored');
  end if;
  select * into c from public.candidates where id=p_candidate for update;
  select * into a from public.candidate_assessments where candidate_id=c.id and job_id=c.job_id and workspace_id=c.workspace_id and assessment_type='manual_correction'
    order by created_at desc,id desc limit 1 for update;
  prior:=a.evidence->'review';score:=(task.result->>'manager_score')::numeric;
  if score is null or score not between 0 and 10 then raise exception 'Invalid proposed score';end if;
  jdscore:=(task.result->>'jd_score')::numeric;if jdscore is null or jdscore not between 0 and 10 then raise exception 'Invalid proposed JD score';end if;
  jdscore:=round(jdscore,1);score:=round(score,1);stamp:=floor(extract(epoch from now())*1000);
  proposed_recommendation:=case when score>=9.2 then 'Interview' when score>=8.3 then 'Strong Consideration' when score>=7.2 then 'Consider' when score>=6 then 'Screen First' else 'Not Recommended' end;
  audit:=jsonb_build_object('previousScore',c.manager_score,'newScore',score,'previousJDScore',c.jd_score,'newJDScore',jdscore,'previousRecommendation',c.recommendation,'newRecommendation',proposed_recommendation,
    'reasons',jsonb_build_array(task.result->>'manager_reason',task.result->>'jd_reason'),'appliedAt',stamp,'source','job_reassessment','revision',task.revision);
  select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) into history from (
    select value,ord from jsonb_array_elements(coalesce(prior->'history','[]'::jsonb)||jsonb_build_array(audit)) with ordinality as h(value,ord) order by ord desc limit 20
  ) h;
  review:=jsonb_build_object('verdict','Needs Adjustment','correctedScore',score,'correctedJDScore',jdscore,'reasons',jsonb_build_array('Job-wide AI assessment'),
    'notes',concat_ws(' · ',task.result->>'manager_reason',task.result->>'jd_reason'),'source','hybrid_reevaluation',
    'priorCorrection',case when prior->>'source'='hybrid_reevaluation' then prior->'priorCorrection' else prior end,
    'contextSignature',task.result->>'context_signature','model',task.result->>'model','history',history,'createdAt',stamp);
  update public.candidates set jd_score=jdscore,manager_score=score,recommendation=proposed_recommendation where id=c.id returning * into c;
  if a.id is null then
    insert into public.candidate_assessments(workspace_id,job_id,candidate_id,assessment_type,jd_score,manager_score,recommendation,summary,evidence,created_by)
      values(c.workspace_id,c.job_id,c.id,'manual_correction',c.jd_score,score,proposed_recommendation,review->>'notes',jsonb_build_object('review',review),auth.uid()) returning * into a;
  else
    update public.candidate_assessments set jd_score=jdscore,manager_score=score,recommendation=proposed_recommendation,summary=review->>'notes',
      evidence=jsonb_set(a.evidence,'{review}',review) where id=a.id returning * into a;
  end if;
  -- Source triggers may have invalidated the proposal while persisting approval.
  -- Finish in the same transaction with the new baseline and the original audit.
  update public.job_reassessment_tasks set status='approved',revision=md5(public.reassessment_input(c.id)::text),
    input=public.reassessment_input(c.id),result=task.result,lease_id=null,lease_until=null,
    reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where candidate_id=c.id;
  return jsonb_build_object('status','approved','candidate',to_jsonb(c),'assessment',to_jsonb(a));
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
  raise exception 'Evidence changed. Review the latest assessment.' using errcode='PT409';end if;
 select * into a from public.candidate_assessments where candidate_id=c.id and assessment_type='manual_correction' order by created_at desc,id desc limit 1 for update;
 -- Recover a response lost after the transaction committed. Return current
 -- records, never replay old scores over subsequent recruiter corrections.
 if t.status='approved' then return jsonb_build_object('status','approved','candidate',to_jsonb(c),'assessment',to_jsonb(a));end if;
 if t.status<>'ready' or public.resume_intake_revision(public.resume_intake_input(c.id)) is distinct from p_revision then
  raise exception 'Evidence changed. Review the latest assessment.' using errcode='PT409';end if;
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

revoke all on function public.review_job_reassessment(uuid,text,text),public.review_resume_intake(uuid,text,text) from public,anon;
grant execute on function public.review_job_reassessment(uuid,text,text),public.review_resume_intake(uuid,text,text) to authenticated;
commit;

with eligible as (
    select t.candidate_id from public.resume_intake_tasks t
    where t.status='failed' and t.error_code='verification_failed'
      and t.updated_at <= '2026-09-15T17:05:52Z'::timestamptz
      and public.resume_intake_input(t.candidate_id) is not null
      and public.resume_intake_revision(public.resume_intake_input(t.candidate_id))=t.revision
    for update of t
  ), retried as (
    update public.resume_intake_tasks t set status='queued',attempts=0,error_code=null,
      next_run_at=now(),lease_id=null,lease_until=null,updated_at=now()
    from eligible e where t.candidate_id=e.candidate_id
    returning t.candidate_id,t.job_id
  ) select candidate_id,public.wake_job_reassessments(job_id) from retried;

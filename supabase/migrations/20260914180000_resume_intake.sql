begin;
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
  for c in select id,workspace_id from public.candidates where job_id=p_job and (p_candidate is null or id=p_candidate) order by id loop
    if exists(select 1 from public.candidates x where x.id=c.id and x.role='Resume awaiting analysis')
      or exists(select 1 from public.candidate_assessments a where a.candidate_id=c.id and a.assessment_type='manual_correction'
        and a.evidence->'resume_intake' is not null and a.evidence->'resume_intake'<>'null'::jsonb
        and a.evidence#>>'{resume_intake,reviewedAt}' is null and coalesce(a.evidence->'review','null'::jsonb)='null'::jsonb) then
      update public.job_reassessment_tasks set status='cancelled',lease_id=null,lease_until=null,result=null,updated_at=now()
        where candidate_id=c.id and status in ('queued','processing','ready','failed');
      continue;
    end if;
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


commit;

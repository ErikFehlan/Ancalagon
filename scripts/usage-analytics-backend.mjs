import {readFile} from 'node:fs/promises';
const token=process.env.SUPABASE_ACCESS_TOKEN?.trim(),ref=process.env.SUPABASE_PROJECT_REF?.trim();
if(!token||!/^[a-z0-9]{20}$/.test(ref||''))throw Error('Configure the existing criteria-backend environment.');
const mode=process.argv[2]||'prepare',verify=mode==='verify';
if(!['prepare','activate','verify'].includes(mode))throw Error('Unknown usage deployment mode.');
const query=mode==='activate'?'select public.activate_confirmed_usage();':verify?`
with saved as (
 select 'jobs:'||id k from public.jobs union all select 'candidates:'||id from public.candidates
 union all select 'candidate_documents:'||id from public.candidate_documents union all select 'manager_feedback:'||id from public.manager_feedback
 union all select 'screening_insights:'||id from public.screening_insights union all select 'interview_outcomes:'||id from public.interview_outcomes
), completed as (
 select 'resume_intake_tasks:'||usage_run_id||':resume_analysis_completed' k from public.resume_intake_tasks where status in ('ready','approved') and result is not null
 union all select 'job_reassessment_tasks:'||usage_run_id||':candidate_reassessment_completed' from public.job_reassessment_tasks where status in ('ready','approved','ignored') and result is not null
 union all select 'job_criteria_tasks:'||usage_run_id||':criteria_refinement_completed' from public.job_criteria_tasks where status='ready' and jsonb_array_length(result->'criteria')>0
) select (select count(*) from saved s where not exists(select from public.product_usage_events e where e.source_key=s.k)) as missing_saved,
 (select count(*) from completed s where not exists(select from public.product_usage_events e where e.source_key=s.k)) as missing_completed;
`:await readFile('supabase/migrations/20260916120000_accurate_usage.sql','utf8');
const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',
 headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
 body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});
if(!response.ok)throw Error(`Usage migration failed (${response.status}). No query result was logged.`);
if(verify){const rows=await response.json();if(!Array.isArray(rows)||rows.length!==1||Number(rows[0].missing_saved)!==0||Number(rows[0].missing_completed)!==0)throw Error('Usage verification found missing saved work or completed processing.');console.log('Usage coverage verified: zero missing saved records or retained completed tasks.');}
else console.log(mode==='activate'?'Confirmed usage write permissions activated.':'Confirmed usage recording and recoverable history installed.');

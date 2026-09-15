// Read-only, allowlisted operational counts. Never print source data or identifiers.
const token=process.env.SUPABASE_ACCESS_TOKEN,ref=process.env.SUPABASE_PROJECT_REF;
if(!token||!/^[a-z0-9]{20}$/.test(ref||''))throw Error('Diagnostic environment unavailable');
const response=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query:`select status, error_code, attempts, count(*)::int as total from public.resume_intake_tasks where updated_at > now()-interval '24 hours' group by status,error_code,attempts order by status,error_code,attempts`}),signal:AbortSignal.timeout(20000)});
if(!response.ok)throw Error('Read-only diagnostics failed: HTTP '+response.status);
const rows=await response.json();
const status=new Set(['queued','processing','ready','failed','approved','rejected']);
const codes=new Set(['invalid_scope','invalid_resume','input_too_large','ai_rate_limit','verification_failed','ai_unavailable','processing_failed','retry_limit']);
for(const row of rows)console.log(JSON.stringify({status:status.has(row.status)?row.status:'other',error_code:row.error_code===null?null:codes.has(row.error_code)?row.error_code:'other',attempts:Number(row.attempts),total:Number(row.total)}));

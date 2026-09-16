const token=process.env.SUPABASE_ACCESS_TOKEN?.trim(),ref=process.env.SUPABASE_PROJECT_REF?.trim();
if(!token||!/^[a-z0-9]{20}$/.test(ref||''))throw Error('Missing deployment environment');
const query=`select exists(select from pg_locks l join pg_class c on c.oid=l.relation join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('resume_intake_tasks','job_reassessment_tasks','job_criteria_tasks','ai_usage_events','app_events') and l.granted and l.pid<>pg_backend_pid()) as busy;`;
const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query,read_only:true}),signal:AbortSignal.timeout(60000)});
if(!r.ok)throw Error(`Read-only deployment check failed (${r.status})`);
const rows=await r.json();
console.log(rows[0]?.busy===true?'Tables requiring column changes are currently busy.':'Tables requiring column changes have no competing locks.');

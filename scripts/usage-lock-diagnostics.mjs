const token=process.env.SUPABASE_ACCESS_TOKEN?.trim(),ref=process.env.SUPABASE_PROJECT_REF?.trim();
if(!token||!/^[a-z0-9]{20}$/.test(ref||''))throw Error('Missing deployment environment');
// Identifiers remain in memory only for a stability comparison. Logs contain
// only fixed yes/no diagnoses, never raw metadata, queries, or customer data.
const query=`select distinct l.pid,a.query='<insufficient privilege>' or a.state is null as hidden
from pg_locks l join pg_class c on c.oid=l.relation join pg_namespace n on n.oid=c.relnamespace left join pg_stat_activity a on a.pid=l.pid
where n.nspname='public' and c.relname in ('resume_intake_tasks','job_reassessment_tasks','job_criteria_tasks','ai_usage_events','app_events')
and l.granted and l.pid<>pg_backend_pid();`;
async function read(){const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query,read_only:true}),signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('Read-only check failed');return r.json();}
const first=await read();await new Promise(r=>setTimeout(r,10000));const second=await read();
console.log(second.some(x=>first.some(y=>y.pid===x.pid))?'A competing database connection persists across checks.':'Competing connections have cleared or changed.');
console.log(second.some(x=>x.hidden)?'Database role cannot inspect the competing operation.':'Competing operation details are visible to the database role.');

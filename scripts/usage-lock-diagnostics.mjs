const token=process.env.SUPABASE_ACCESS_TOKEN?.trim(),ref=process.env.SUPABASE_PROJECT_REF?.trim();
if(!token||!/^[a-z0-9]{20}$/.test(ref||''))throw Error('Missing deployment environment');
const query=`with holders as (
select distinct a.pid,a.query,a.state,a.application_name,a.query_start
from pg_locks l join pg_class c on c.oid=l.relation join pg_namespace n on n.oid=c.relnamespace join pg_stat_activity a on a.pid=l.pid
where n.nspname='public' and c.relname in ('jobs','resume_intake_tasks','job_reassessment_tasks','job_criteria_tasks','ai_usage_events','app_events') and l.granted and l.pid<>pg_backend_pid()
) select
exists(select from holders where application_name ilike '%postgrest%') as postgrest,
exists(select from holders where query ilike '%pg_catalog%') as catalog_query,
exists(select from holders where query_start<now()-interval '2 minutes' and state='active' and query ilike '%pg_catalog%') as persistent_catalog_query,
exists(select from holders where query ilike '%pg_attribute%' and query ilike '%pg_class%') as relation_metadata_query,
exists(select from holders where query ilike '%pg_get_functiondef%') as function_metadata_query,
exists(select from holders where query ilike '%pg_relation_size%' or query ilike '%pg_total_relation_size%') as size_metadata_query;`;
const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query,read_only:true}),signal:AbortSignal.timeout(60000)});
if(!r.ok)throw Error(`Read-only deployment check failed (${r.status})`);
const rows=await r.json(),d=rows[0]||{};
for(const [key,label] of Object.entries({postgrest:'PostgREST work',catalog_query:'Catalog inspection',persistent_catalog_query:'Persistent catalog inspection',relation_metadata_query:'Table metadata inspection',function_metadata_query:'Function metadata inspection',size_metadata_query:'Table size inspection'}))console.log(label+': '+(d[key]===true?'detected':'not detected'));

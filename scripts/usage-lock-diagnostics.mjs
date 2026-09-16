const token=process.env.SUPABASE_ACCESS_TOKEN?.trim(),ref=process.env.SUPABASE_PROJECT_REF?.trim();
if(!token||!/^[a-z0-9]{20}$/.test(ref||''))throw Error('Missing deployment environment');
// Emit only a fixed aggregate diagnosis. Never return process identifiers,
// query text, connection details, transaction timing, or customer records.
const query=`with holders as (
select a.query,a.state from pg_locks l join pg_class c on c.oid=l.relation
join pg_namespace n on n.oid=c.relnamespace join pg_stat_activity a on a.pid=l.pid
where n.nspname='public' and c.relname='jobs' and l.granted and l.pid<>pg_backend_pid()
) select
exists(select from holders where query like '%-- Counts describe committed work, not form submissions or polling activity.%') as prior_analytics_migration,
exists(select from holders where query not like '%-- Counts describe committed work, not form submissions or polling activity.%') as other_holder,
exists(select from holders where query like '%-- Counts describe committed work, not form submissions or polling activity.%' and state='idle in transaction') as idle_analytics_migration;`;
const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query,read_only:true}),signal:AbortSignal.timeout(60000)});
if(!r.ok)throw Error(`Read-only deployment check failed (${r.status})`);
const rows=await r.json();const d=rows[0]||{};
console.log(d.prior_analytics_migration===true?'Prior analytics migration is holding the required lock.':'No prior analytics migration lock detected.');
console.log(d.idle_analytics_migration===true?'The prior analytics migration has an unfinished transaction.':'No unfinished idle analytics migration detected.');
console.log(d.other_holder===true?'Other database work also holds the required lock.':'No other holder detected.');

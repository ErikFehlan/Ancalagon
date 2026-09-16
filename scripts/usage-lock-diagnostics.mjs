const token=process.env.SUPABASE_ACCESS_TOKEN?.trim(),ref=process.env.SUPABASE_PROJECT_REF?.trim();
if(!token||!/^[a-z0-9]{20}$/.test(ref||''))throw Error('Missing deployment environment');
// Classification happens inside Supabase. Raw logs never leave the log service.
const end=new Date(),start=new Date(end.getTime()-15*60000);
const url=new URL(`https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs`);
url.searchParams.set('iso_timestamp_start',start.toISOString());url.searchParams.set('iso_timestamp_end',end.toISOString());
url.searchParams.set('sql',"select distinct case when lower(event_message) like '%statement timeout%' then 'statement timeout' when lower(event_message) like '%out of shared memory%' then 'out of shared memory' when lower(event_message) like '%permission denied%' then 'permission denied' when lower(event_message) like '%cached plan must not change result type%' then 'cached plan must not change result type' when lower(event_message) like '%deadlock detected%' then 'deadlock detected' when lower(event_message) like '%does not exist%' then 'does not exist' when lower(event_message) like '%return type mismatch%' then 'return type mismatch' when lower(event_message) like '%stack depth limit%' then 'stack depth limit' when lower(event_message) like '%read-only transaction%' then 'read-only transaction' when lower(event_message) like '%schema cache%' then 'schema cache' when lower(event_message) like '%connection refused%' then 'connection refused' when lower(event_message) like '%too many connections%' then 'too many connections' when lower(event_message) like '%connection reset%' then 'connection reset' else 'other' end as category from logs where source in ('postgrest_logs','postgres_logs') limit 30");
const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
if(!r.ok)throw Error(`Aggregate schema diagnostic failed (${r.status})`);
const body=await r.json();
if(body.error){console.log('Aggregate log query could not be evaluated.');process.exitCode=1;}
else{
const allowed=new Set(["statement timeout","out of shared memory","permission denied","cached plan must not change result type","deadlock detected","does not exist","return type mismatch","stack depth limit","read-only transaction","schema cache","connection refused","too many connections","connection reset","other"]);
console.log('Schema diagnostic categories:',JSON.stringify([...new Set((body.result||[]).map(x=>x.category).filter(x=>allowed.has(x)))]));
}

// Approved read-only diagnostics: report only fixed validation categories and counts.
const token=process.env.SUPABASE_ACCESS_TOKEN,ref=process.env.SUPABASE_PROJECT_REF;
if(!token||!/^[a-z0-9]{20}$/.test(ref||''))throw Error('Diagnostic environment unavailable');
const end=new Date(),start=new Date(end.getTime()-23*60*60*1000);
const url=new URL('https://api.supabase.com/v1/projects/'+ref+'/analytics/endpoints/logs.all');
url.searchParams.set('iso_timestamp_start',start.toISOString());url.searchParams.set('iso_timestamp_end',end.toISOString());
url.searchParams.set('sql',"select event_message from function_logs where event_message like 'Resume intake validation%' limit 1000");
const response=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
if(!response.ok)throw Error('Validation diagnostics failed: HTTP '+response.status);
const body=await response.json(),rows=body.result||[],counts={};
for(const row of rows){const match=String(row.event_message||'').trim().match(/^Resume intake validation (invalid_score|invalid_profile|invalid_concerns|invalid_questions|invalid_tags|invalid_evidence|unmatched_quote|unsupported_score|incomplete_output|invalid_json) attempt ([12])$/);if(match){const key=match[1]+' attempt '+match[2];counts[key]=(counts[key]||0)+1;}}
console.log(JSON.stringify({validation_categories:counts}));

const token=process.env.SUPABASE_ACCESS_TOKEN?.trim(),ref=process.env.SUPABASE_PROJECT_REF?.trim();
if(!token||!/^[a-z0-9]{20}$/.test(ref||''))throw Error('Missing deployment environment');
const kr=await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
if(!kr.ok)throw Error('Credential access failed');
const keys=await kr.json(),service=keys.find(x=>x.name==='service_role')?.api_key;
if(!service)throw Error('Missing service credential');
for(const [label,path] of [['membership','workspace_members?select=workspace_id&limit=0'],['usage','product_usage_events?select=id&limit=0'],['task','resume_intake_tasks?select=usage_run_id&limit=0']]){
const r=await fetch(`https://${ref}.supabase.co/rest/v1/${path}`,{headers:{apikey:service,Authorization:`Bearer ${service}`},signal:AbortSignal.timeout(15000)});
const body=await r.json().catch(()=>null);
const code=typeof body?.code==='string'&&/^(PGRST[0-9]{3}|[0-9A-Z]{5})$/.test(body.code)?body.code:null;
console.log('Read-only API readiness:',JSON.stringify({check:label,status:r.status,code}));
}

const token=process.env.SUPABASE_ACCESS_TOKEN?.trim(),ref=process.env.SUPABASE_PROJECT_REF?.trim();
if(!token||!/^[a-z0-9]{20}$/.test(ref||''))throw Error('Missing deployment environment');
const kr=await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
if(!kr.ok)throw Error('Credential access failed');
const keys=await kr.json(),service=keys.find(x=>x.name==='service_role')?.api_key;
if(!service)throw Error('Missing service credential');
const reload=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:"notify pgrst, 'reload schema';"}),signal:AbortSignal.timeout(20000)});
if(!reload.ok)throw Error('Schema reload request failed');
console.log('Schema reload requested.');
let healthy=false;
for(let attempt=1;attempt<=30;attempt++){
const r=await fetch(`https://${ref}.supabase.co/rest/v1/product_usage_events?select=id&limit=0`,{headers:{apikey:service,Authorization:`Bearer ${service}`},signal:AbortSignal.timeout(10000)});
const body=await r.json().catch(()=>null);
if(r.ok){healthy=true;console.log('API schema readiness verified.');break;}
const code=typeof body?.code==='string'&&/^(PGRST[0-9]{3}|[0-9A-Z]{5})$/.test(body.code)?body.code:null;
if(attempt===1||attempt%10===0)console.log('API readiness:',JSON.stringify({status:r.status,code}));
if(r.status!==503)throw Error('API readiness encountered a non-transient error');
await new Promise(r=>setTimeout(r,2000));
}
if(!healthy)throw Error('API schema cache did not recover within the bounded readiness check');

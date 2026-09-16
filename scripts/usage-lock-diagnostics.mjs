const token=process.env.SUPABASE_ACCESS_TOKEN?.trim(),ref=process.env.SUPABASE_PROJECT_REF?.trim();
if(!token||!/^[a-z0-9]{20}$/.test(ref||''))throw Error('Missing deployment environment');
const kr=await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
if(!kr.ok)throw Error('Credential access failed');
const keys=await kr.json(),service=keys.find(x=>x.name==='service_role')?.api_key;if(!service)throw Error('Missing service credential');
const before=await fetch(`https://${ref}.supabase.co/rest/v1/product_usage_events?select=id&limit=0`,{headers:{apikey:service,Authorization:`Bearer ${service}`},signal:AbortSignal.timeout(10000)});
const beforeBody=await before.json().catch(()=>null);
if(before.ok){console.log('API is healthy; restart is unnecessary.');}
else{
if(before.status!==503||beforeBody?.code!=='PGRST002')throw Error('Restart precondition not met; API error is not the diagnosed schema-cache failure.');
const r=await fetch(`https://api.supabase.com/v1/projects/${ref}/restart`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(60000)});
if(!r.ok)throw Error(`Backend recovery request failed (${r.status})`);
console.log('Backend restart requested for persistent schema-cache failure.');
let healthy=false;
for(let attempt=1;attempt<=36;attempt++){
await new Promise(r=>setTimeout(r,5000));
try{const check=await fetch(`https://${ref}.supabase.co/rest/v1/product_usage_events?select=id&limit=0`,{headers:{apikey:service,Authorization:`Bearer ${service}`},signal:AbortSignal.timeout(10000)});
await check.arrayBuffer();
if(check.ok){healthy=true;console.log('API schema readiness verified after recovery.');break;}}catch{}
}
if(!healthy)throw Error('API did not recover within the bounded readiness check.');
}

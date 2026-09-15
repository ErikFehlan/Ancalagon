import {readFile} from 'node:fs/promises';
// One-time recovery of legacy quotation failures observed before this release.
// Only non-identifying status counts are logged. Never log SQL results, source
// text, model output, record IDs or credentials.
const token=process.env.SUPABASE_ACCESS_TOKEN?.trim(),ref=process.env.SUPABASE_PROJECT_REF?.trim();
if(!token||!/^[a-z0-9]{20}$/.test(ref||''))throw Error('Intake recovery requires the existing deployment environment.');
async function query(sql){
  const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error(`Intake recovery database request failed (${response.status}).`);
  return response.json();
}
const recovered=await query(await readFile(new URL('../supabase/maintenance/20260915_retry_intakes.sql',import.meta.url),'utf8'));
console.log('Legacy resume assessments queued for recovery: '+recovered.length);
if(recovered.length){
  const ids=recovered.map(row=>row.candidate_id);
  if(!ids.every(id=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)))throw Error('Unexpected recovery identifier.');
  let complete=false;
  for(let attempt=0;attempt<100;attempt++){
    const rows=await query(`select status,count(*)::int as total from public.resume_intake_tasks where candidate_id in (${ids.map(id=>`'${id}'::uuid`).join(',')}) group by status`);
    if(rows.some(row=>row.status==='failed'))throw Error('A recovered resume assessment still needs attention. No resume content was logged.');
    const ready=rows.filter(row=>['ready','approved'].includes(row.status)).reduce((sum,row)=>sum+Number(row.total),0);
    if(ready===ids.length){console.log('Recovered resume assessments ready or already reviewed: '+ready);complete=true;break;}
    await new Promise(resolve=>setTimeout(resolve,3000));
  }
  if(!complete)throw Error('Resume recovery is still pending; check the durable queue.');
}

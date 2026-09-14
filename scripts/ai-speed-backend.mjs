import {readFile} from 'node:fs/promises';

const token=process.env.SUPABASE_ACCESS_TOKEN?.trim();
const ref=process.env.SUPABASE_PROJECT_REF?.trim();
if(!token||!ref||!/^[a-z0-9]{20}$/.test(ref))throw Error('Configure SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF in criteria-backend.');
async function sql(query,parameters=[]){
  const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query,parameters}),signal:AbortSignal.timeout(60000)
  });
  if(!response.ok)throw Error(`Database deployment request failed (${response.status}). Check Supabase; no secret or query result has been logged.`);
  return response.json();
}
const workerUrl=`https://${ref}.supabase.co/functions/v1/refine-job-criteria`;
if(process.argv[2]==='install'){
  const rows=await sql("select to_regclass('public.job_criteria_tasks') is not null as installed");
  if(!rows[0]?.installed)throw Error('Activate the original criteria queue before this upgrade.');
  await sql(await readFile('supabase/migrations/20260914120000_immediate_criteria.sql','utf8'));
  console.log('Immediate eligibility and per-job claims installed; existing tasks preserved.');
}else if(process.argv[2]==='activate'){
  const credentials=await sql("select decrypted_secret from vault.decrypted_secrets where name='criteria_worker_secret'");
  const health=await fetch(workerUrl,{method:'POST',headers:{'Content-Type':'application/json','x-worker-secret':credentials[0]?.decrypted_secret||''},body:'{"health":true}',signal:AbortSignal.timeout(30000)});
  if(!health.ok||(await health.json()).immediate_criteria!==true)throw Error('Updated worker configuration check failed. Immediate dispatch was not enabled.');
  await sql("select vault.update_secret(id,$1) from vault.secrets where name='criteria_worker_url'",[workerUrl]);
  await sql("select vault.create_secret($1,'criteria_worker_url') where not exists(select 1 from vault.secrets where name='criteria_worker_url')",[workerUrl]);
  // Exercise the committed pg_net transport without touching recruiting records or spending AI tokens.
  const [{request_id}]=await sql("select net.http_post(url:=$1,headers:=jsonb_build_object('Content-Type','application/json','x-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='criteria_worker_secret')),body:='{\"health\":true}'::jsonb,timeout_milliseconds:=30000) as request_id",[workerUrl]);
  let ok=false;
  for(let i=0;i<30;i++){
    await new Promise(resolve=>setTimeout(resolve,1000));
    const rows=await sql('select status_code,timed_out,error_msg is not null as failed from net._http_response where id=$1',[String(request_id)]);
    if(rows.length){ok=rows[0].status_code===200&&!rows[0].timed_out&&!rows[0].failed;break;}
  }
  if(!ok){
    // Keep the prior cron fallback if the new immediate transport cannot be verified.
    await sql("select vault.update_secret(id,'') from vault.secrets where name='criteria_worker_url'");
    throw Error('Database-to-worker transport check failed; immediate dispatch paused. The durable scheduler remains available.');
  }
  console.log('Immediate dispatch enabled and database-to-worker transport verified. Cron remains the retry fallback.');
}else throw Error('Specify install or activate');

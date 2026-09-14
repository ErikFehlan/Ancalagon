import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
const token=process.env.SUPABASE_ACCESS_TOKEN?.trim(),ref=process.env.SUPABASE_PROJECT_REF?.trim();
if(!token||!ref||!/^[a-z0-9]{20}$/.test(ref))throw Error('Configure the existing criteria-backend environment.');
async function api(path,body){
 const r=await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error(`Backend setup failed (${r.status}) at ${path}. No secret or query result has been logged.`);
 return r.json().catch(()=>null);
}
const sql=(query,parameters=[])=>api('/database/query',{query,parameters});
const url=`https://${ref}.supabase.co/functions/v1/reassess-job`;
if(process.argv[2]==='prepare'){
 const found=await sql("select to_regclass('public.job_reassessment_tasks') is not null as installed");
 if(!found?.[0]?.installed)await sql(await readFile('supabase/migrations/20260914160000_job_reassessments.sql','utf8'));
 const stored=await sql("select decrypted_secret from vault.decrypted_secrets where name='job_reassessment_secret'");
 const secret=stored?.[0]?.decrypted_secret||randomBytes(32).toString('hex');
 await api('/secrets',[{name:'JOB_REASSESSMENT_SECRET',value:secret}]);
 await sql("select vault.create_secret($1,'job_reassessment_secret') where not exists(select 1 from vault.secrets where name='job_reassessment_secret')",[secret]);
 console.log('Durable reassessment queue and protected review functions installed; worker credential configured.');
}else if(process.argv[2]==='activate'){
 const credentials=await sql("select decrypted_secret from vault.decrypted_secrets where name='job_reassessment_secret'");
 const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-worker-secret':credentials[0]?.decrypted_secret||''},body:'{"health":true}',signal:AbortSignal.timeout(30000)});
 if(!r.ok||(await r.json()).job_reassessment!==true)throw Error('Worker health check failed; scheduler not activated.');
 await sql("select vault.update_secret(id,$1) from vault.secrets where name='job_reassessment_url'",[url]);
 await sql("select vault.create_secret($1,'job_reassessment_url') where not exists(select 1 from vault.secrets where name='job_reassessment_url')",[url]);
 const [{request_id}]=await sql("select net.http_post(url:=$1,headers:=jsonb_build_object('Content-Type','application/json','x-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='job_reassessment_secret')),body:='{\"health\":true}'::jsonb,timeout_milliseconds:=30000) as request_id",[url]);
 let verified=false;
 for(let i=0;i<30;i++){await new Promise(resolve=>setTimeout(resolve,1000));const rows=await sql('select status_code,timed_out,error_msg is not null as failed from net._http_response where id=$1',[String(request_id)]);if(rows.length){verified=rows[0].status_code===200&&!rows[0].timed_out&&!rows[0].failed;break;}}
 if(!verified){await sql("select vault.update_secret(id,'') from vault.secrets where name='job_reassessment_url'");throw Error('Database transport check failed; automatic dispatch remains paused.');}
 await sql("select cron.schedule('ancalagon-job-reassessment','* * * * *','select public.wake_job_reassessments(null)')");
 const schedule=await sql("select active from cron.job where jobname='ancalagon-job-reassessment'");
 if(!schedule[0]?.active)throw Error('Scheduler activation failed');
 console.log('Worker and database transport verified. Immediate dispatch and the retry scheduler are active.');
}else throw Error('Specify prepare or activate');

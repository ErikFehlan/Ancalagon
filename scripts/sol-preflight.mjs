import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
const token=process.env.SUPABASE_ACCESS_TOKEN,ref=process.env.SUPABASE_PROJECT_REF;
if(!token||!/^[a-z0-9]{20}$/.test(ref||''))throw Error('Use the existing backend deployment environment.');
async function management(path,method='GET',body){
 const r=await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error(`Sol validation setup failed (${r.status}).`);return r.json();
}
const keys=await management('/api-keys?reveal=true'),service=keys.find(k=>k.name==='service_role')?.api_key;
assert.ok(service,'Deployment service credential missing');
let workerSecret;
async function request(path,method='GET',body){
 const credentials=path.startsWith('/functions/')?{'x-worker-secret':workerSecret}:{apikey:service,Authorization:`Bearer ${service}`};
 const r=await fetch(`https://${ref}.supabase.co${path}`,{method,headers:{...credentials,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(125000)});
 const data=await r.json().catch(()=>null);
 if(!r.ok){console.error('Synthetic Sol check failed:',JSON.stringify({status:r.status,case:data?.case,result:data?.result?.error}));throw Error(`Sol validation request failed (${r.status}); production model rollout stopped.`);}
 return data;
}
const query=(query,parameters=[])=>management('/database/query','POST',{query,parameters});
const transport=await query("select decrypted_secret from vault.decrypted_secrets where name='job_reassessment_secret'");
workerSecret=transport?.[0]?.decrypted_secret;
assert.ok(workerSecret,'Private worker transport is not configured');
const anonymous=await fetch(`https://${ref}.supabase.co/functions/v1/sol-model-check`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(20000)});
assert.equal(anonymous.status,401,'Private model validation accepted an unauthenticated caller');
const email=`ancalagon-sol-test-${randomUUID()}@example.invalid`;let user,workspace;
try{
 await query('insert into public.beta_access(email) values($1)',[email]);
 const created=await request('/auth/v1/admin/users','POST',{email,password:randomBytes(32).toString('base64url'),email_confirm:true});
 user=created.id||created.user?.id;assert.ok(user);
 const memberships=await request('/rest/v1/workspace_members?select=workspace_id&user_id=eq.'+user);
 assert.equal(memberships.length,1);workspace=memberships[0].workspace_id;
 for(const caseName of ['feedback','resume','screening']){
  for(const model of ['baseline','sol']){
   const check=await request('/functions/v1/sol-model-check','POST',{case:caseName,model,workspace_id:workspace}),out=check.result;
   assert.ok(out?.model?.startsWith(check.requested_model),'Provider did not return the requested model');
   assert.ok(check.duration_ms<55000,'Synthetic response exceeded the existing interactive request budget');
   if(caseName==='feedback'){
    assert.ok(out.summary&&Object.hasOwn(out,'clarification_question'));
    assert.ok(!Object.hasOwn(out,'manager_score'),'Feedback produced an unreviewed score');
    assert.match(out.summary,/manual/i);assert.match(out.summary,/never|not |no |lack|without/i,'The explicit automation limitation was lost');
   }else if(caseName==='resume'){
    assert.ok(out.resume_evidence?.length,'Resume evidence missing');
    assert.match(out.resume_evidence.map(e=>e.claim+' '+e.quote).join(' '),/manual/i);
    assert.match(out.concerns.join(' ')+' '+out.primary_signal+' '+out.jd_reason,/not |never|lack|no |without/i,'Resume limitation was lost');
   }else{
    for(const key of ['jd_score','manager_score'])assert.ok(Number.isFinite(out[key])&&out[key]>=0&&out[key]<=10);
    assert.ok(out.summary&&out.jd_reason&&out.manager_reason);
   }
   // All output below is from the fixed synthetic fixtures, never real resumes.
   console.log('SOL_PREFLIGHT '+JSON.stringify(check));
  }
 }
 console.log('PASS: Sol API access, existing output contracts, evidence validation, limitation preservation, and bounded response time. Synthetic smoke comparison is not a broad quality benchmark.');
}finally{
 if(user)await request('/auth/v1/admin/users/'+user,'DELETE');
 await query('delete from public.beta_access where email=$1 and user_id is null',[email]);
 if(workspace)await query('delete from public.ai_budget_counters where scope=$1 or scope=$2',['workspace:'+workspace,'user:'+user]);
}

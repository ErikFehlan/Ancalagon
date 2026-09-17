// Only disposable, randomly named test users and their synthetic data are touched.
// Credentials remain in this process; no request bodies, tokens or traces are logged.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
const token=process.env.SUPABASE_ACCESS_TOKEN?.trim(),ref=process.env.SUPABASE_PROJECT_REF?.trim();
if(!token||!/^[a-z0-9]{20}$/.test(ref||''))throw Error('Live checks require the existing deployment environment.');
const base=`https://${ref}.supabase.co`,users=[];
const keysResponse=await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
if(!keysResponse.ok)throw Error(`Live check credential access failed (${keysResponse.status}); checks have not passed.`);
const keys=await keysResponse.json(),service=keys.find(k=>k.name==='service_role')?.api_key,anon=keys.find(k=>k.name==='anon')?.api_key;
if(!service||!anon)throw Error('Live check requires the existing service and public API keys.');
async function req(path,access,method='GET',body,expected=true){
 const r=await fetch(base+path,{method,headers:{apikey:access===service?service:anon,Authorization:`Bearer ${access||anon}`,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
 if(expected&&!r.ok)throw Error(`Live check request failed (${r.status}) for ${path.split('?')[0]}.`);
 return {ok:r.ok,status:r.status,data:await r.json().catch(()=>null)};
}
let cleanupFailed=false;
try{
 for(let i=0;i<2;i++){
  const email=`ancalagon-core-test-${randomUUID()}@example.invalid`,password=randomBytes(32).toString('base64url');
  const created=await req('/auth/v1/admin/users',service,'POST',{email,password,email_confirm:true,user_metadata:{display_name:'Disposable core test'}});
  const id=created.data.id||created.data.user?.id;assert.ok(id,'Disposable user was not created');
  const user={id,paths:[]};users.push(user);
  const login=await req('/auth/v1/token?grant_type=password',null,'POST',{email,password});user.access=login.data.access_token;assert.ok(user.access,'Password login failed');
  const memberships=await req('/rest/v1/workspace_members?select=workspace_id&user_id=eq.'+id,user.access);
  assert.equal(memberships.data.length,1,'New account did not receive one private workspace');user.workspace=memberships.data[0].workspace_id;
 }
 assert.notEqual(users[0].workspace,users[1].workspace,'Workspaces must be isolated');
 const owner=users[0],other=users[1],job=randomUUID(),candidate=randomUUID(),note=randomUUID();
 await req('/rest/v1/jobs',owner.access,'POST',{id:job,workspace_id:owner.workspace,title:'Synthetic core QA',description:'Manual regression testing and documented defect remediation.',criteria:['Must Have | manual regression testing'],created_by:owner.id});
 await req('/rest/v1/candidates',owner.access,'POST',{id:candidate,workspace_id:owner.workspace,job_id:job,name:'Synthetic Candidate',role:'Resume awaiting analysis',created_by:owner.id});
 await req('/rest/v1/candidate_assessments',owner.access,'POST',{workspace_id:owner.workspace,job_id:job,candidate_id:candidate,assessment_type:'manual_correction',evidence:{resume_intake:{phase:'uploading',backend:'durable-v1'},submission_draft:{text:'Synthetic draft retained'}},created_by:owner.id});
 const text='Synthetic Candidate\nQA Analyst\nOwned manual regression testing for billing systems and documented defects through remediation.';
 const path=`${owner.workspace}/${job}/${candidate}/synthetic.txt`;owner.paths.push(path);
 const uploaded=await fetch(base+'/storage/v1/object/resumes/'+path,{method:'POST',headers:{apikey:anon,Authorization:`Bearer ${owner.access}`,'Content-Type':'text/plain'},body:text,signal:AbortSignal.timeout(20000)});
 assert.ok(uploaded.ok,'Owner document upload failed');
 await req('/rest/v1/manager_feedback',owner.access,'POST',{id:note,workspace_id:owner.workspace,job_id:job,candidate_id:candidate,feedback_type:'General note',feedback_text:'Synthetic note: verify personal ownership.',created_by:owner.id});

 // Verify learning on disposable evidence, without training or provider upload.
 const interpretation={text:'Synthetic ownership needs clarification.',source:'ai',reviewStatus:'pending',model:'synthetic',learning:{
  version:'feedback-v1',input:{candidate_ref:candidate,job:{title:'Synthetic core QA'},feedback:{text:'Synthetic note: verify personal ownership.',type:'General note',outcome:'Neutral / no signal'}},
  output:{summary:'Synthetic ownership needs clarification.',clarification_question:null}}};
 const evidence={feedback_id:note,interpretation};
 const assessment=await req('/rest/v1/candidate_assessments',owner.access,'POST',{workspace_id:owner.workspace,job_id:job,candidate_id:candidate,assessment_type:'manager_feedback',evidence,created_by:owner.id});
 const assessmentPath='/rest/v1/candidate_assessments?id=eq.'+assessment.data[0].id;
 const examplePath='/rest/v1/learning_examples?feedback_id=eq.'+note;
 assert.equal((await req(examplePath,owner.access)).data.length,0,'Unreviewed output became a learning example');
 interpretation.reviewStatus='accepted';
 await req(assessmentPath,owner.access,'PATCH',{evidence});
 const captured=(await req(examplePath,owner.access)).data;
 assert.equal(captured.length,1,'Accepted feedback was not captured');
 assert.equal(captured[0].review_kind,'accepted');assert.equal(captured[0].workspace_id,owner.workspace);
 await req(assessmentPath,owner.access,'PATCH',{evidence});
 assert.equal((await req(examplePath,owner.access)).data[0].id,captured[0].id,'Repeated save duplicated the example');
 interpretation.reviewStatus='corrected';interpretation.source='recruiter';interpretation.text='Synthetic correction: personal ownership is still unverified.';
 await req(assessmentPath,owner.access,'PATCH',{evidence});
 const corrected=(await req(examplePath,owner.access)).data;
 assert.equal(corrected.length,1);assert.equal(corrected[0].review_kind,'corrected');assert.equal(corrected[0].reviewed_text,interpretation.text);
 assert.equal((await req(examplePath,other.access)).data.length,0,'Learning example crossed workspaces');
 assert.equal((await req('/rest/v1/learning_permissions?workspace_id=eq.'+owner.workspace,owner.access)).data.length,0,'Review enabled training permission');
 assert.equal((await req('/rest/v1/rpc/get_feedback_learning_model',owner.access,'POST',{p_workspace:owner.workspace})).data,null,'Capture activated a model');
 assert.equal((await req('/rest/v1/rpc/get_feedback_learning_model',other.access,'POST',{p_workspace:owner.workspace},false)).status,403,'Foreign model lookup allowed');
 console.log('PASS: live feedback capture, corrections, deduplication, workspace isolation and inactive training/model defaults.');
 const intakeStarted=performance.now();
 await req('/rest/v1/candidate_documents',owner.access,'POST',{workspace_id:owner.workspace,job_id:job,candidate_id:candidate,storage_path:path,file_name:'Synthetic.txt',mime_type:'text/plain',file_size:text.length,extracted_text:text,created_by:owner.id});
 for(const table of ['jobs','candidates','candidate_documents','candidate_assessments','manager_feedback','screening_insights','interview_outcomes','candidate_benchmarks','resume_intake_tasks','job_reassessment_tasks']){
  const filter=table==='jobs'?'id':'job_id';const rows=await req(`/rest/v1/${table}?${filter}=eq.${job}&select=*`,other.access);
  assert.equal(rows.data.length,0,`Cross-account ${table} read leaked rows`);
 }
 assert.equal((await req('/rest/v1/jobs?id=eq.'+job,other.access,'PATCH',{title:'Forbidden edit'})).data.length,0);
 assert.equal((await req('/rest/v1/candidates?id=eq.'+candidate,other.access,'DELETE')).data.length,0);
 const forbidden=await req('/rest/v1/rpc/request_resume_intake',other.access,'POST',{p_candidate:candidate},false);assert.ok(!forbidden.ok,'Foreign intake request accepted');
 const documentRead=await fetch(base+'/storage/v1/object/authenticated/resumes/'+path,{headers:{apikey:anon,Authorization:`Bearer ${other.access}`},signal:AbortSignal.timeout(20000)});assert.ok(!documentRead.ok,'Foreign resume download allowed');
 const ownerRead=await fetch(base+'/storage/v1/object/authenticated/resumes/'+path,{headers:{apikey:anon,Authorization:`Bearer ${owner.access}`},signal:AbortSignal.timeout(20000)});assert.equal(await ownerRead.text(),text,'Saved document differs');
 for(const route of ['analyze-patterns-v2','analyze-patterns-beta']){
  const blocked=await req('/functions/v1/'+route,anon,'POST',{workspace_id:owner.workspace,analysis_type:'feedback',job:{title:'Synthetic'},feedback:{text:'Should never reach AI'}},false);
  assert.ok([401,403].includes(blocked.status),'Anonymous AI route accepted a request');
 }
 // No browser is open. The database dispatch and scheduler must produce output.
 let task;
 for(let i=0;i<480;i++){
  const rows=await req('/rest/v1/resume_intake_tasks?candidate_id=eq.'+candidate,owner.access);task=rows.data[0];
  if(task?.status==='ready')break;
  if(task?.status==='failed')throw Error('Live intake exhausted its automatic retries ('+task.error_code+').');
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 assert.equal(task?.status,'ready','Intake did not finish without a browser');
 console.log('SYNTHETIC_INTAKE_METRIC '+JSON.stringify({document_to_ready_ms:Math.round(performance.now()-intakeStarted),attempts:task.attempts}));
 assert.ok(task.result.resume_evidence?.length,'Live AI did not return resume evidence');
 for(const evidence of task.result.resume_evidence)assert.ok(text.includes(evidence.quote),'Live quote not grounded');
 const before=await req('/rest/v1/candidates?id=eq.'+candidate,owner.access);assert.equal(before.data[0].manager_score,null,'Unreviewed AI changed scores');
 const approved=await req('/rest/v1/rpc/review_resume_intake',owner.access,'POST',{p_candidate:candidate,p_revision:task.revision,p_decision:'approve'});
 assert.equal(approved.data.status,'approved');assert.equal(approved.data.assessment.evidence.submission_draft.text,'Synthetic draft retained');
 const restored=await req('/rest/v1/candidates?id=eq.'+candidate,owner.access);assert.equal(restored.data[0].manager_score,task.result.manager_score,'Approved score did not persist');
 console.log('PASS: real password accounts, separate workspaces, record/document isolation, protected AI routes, background intake, grounded quotes, atomic approval and persistence.');
}finally{
 for(const user of users){
  try{if(user.paths.length)await req('/storage/v1/object/resumes',service,'DELETE',{prefixes:user.paths});await req('/auth/v1/admin/users/'+user.id,service,'DELETE');}
  catch{cleanupFailed=true;console.error('Disposable test cleanup failed for user ID '+user.id+'.');}
 }
 if(cleanupFailed)throw Error('Disposable test cleanup needs attention; no production accounts were modified.');
}

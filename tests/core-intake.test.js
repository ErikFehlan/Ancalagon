const test=require('node:test'),assert=require('node:assert/strict');
const intake=require('../assets/resume-intake.js');require('../assets/context.js');
const remote=require('../assets/resume-remote.js');
const text='Alex Carter\nQA Analyst\nOwned manual regression testing for billing systems and documented defects.';
const brief={name:'Alex Carter',role:'QA Analyst',score:8,manager_score:8.5,primary_signal:'Manual testing',jd_reason:'Manual testing evidence',manager_reason:'Ownership evidence',concerns:[],tags:['QA'],screening_questions:['Which test cases did you own?'],resume_evidence:[{claim:'Manual testing',quote:'Owned manual regression testing for billing systems'}]};
const input=()=>({job:{id:'j',title:'QA',description:'Manual regression testing',criteria:[],weights:[],knockouts:[]},candidate:{id:'c',jobId:'j',resumeJDScore:0},feedback:[],outcomes:[],resume_text:text,file_name:'Example.txt'});
test('durable intake uses the same neutral context and excludes other candidate notes',async()=>{
 const {prepareIntake}=await import('../supabase/functions/reassess-job/intake.mjs');
 const data=input();data.feedback=[{id:'private',jobId:'j',candidateId:'other',text:'PRIVATE'},{id:'own',jobId:'j',candidateId:'c',text:'Clarify ownership'}];
 const a=prepareIntake(data);assert.doesNotMatch(JSON.stringify(a.payload),/PRIVATE/);assert.match(JSON.stringify(a.payload),/Clarify ownership/);
 data.candidate={...data.candidate,signal:'Generated claim',strengths:['Generated'],resumeIntake:{brief}};
 assert.equal(a.signature,prepareIntake(data).signature,'generated outputs must not invalidate themselves');
 assert.throws(()=>prepareIntake({...data,candidate:{id:'c',jobId:'foreign'}}),/invalid_scope/);
});
test('worker preserves leases, reports stale completion, and keeps error details private',async()=>{
 const {processIntakes}=await import('../supabase/functions/reassess-job/intake.mjs'),calls=[];
 const task={candidate_id:'c',revision:'r1',lease_id:'l1',input:input()};
 const results=await processIntakes([task],{analyze:async()=>new Response(JSON.stringify(brief)),rpc:async(name,args)=>{calls.push({name,args});return false;}});
 assert.deepEqual(results,['superseded']);assert.equal(calls[0].args.p_lease,'l1');assert.equal(calls[0].args.p_revision,'r1');
 calls.length=0;
 await processIntakes([task],{analyze:async()=>{throw Error('PRIVATE RESUME AND TOKEN');},rpc:async(name,args)=>calls.push(args)});
 assert.equal(calls[0].p_error,'processing_failed');assert.doesNotMatch(JSON.stringify(calls),/PRIVATE/);
});
test('remote completion waits for persistence, leaves scores provisional, and does not restart model work',async()=>{
 const c={id:'c',jobId:'j',name:'Example',short:'Example',managerScore:0,resumeIntake:{phase:'queued'}},calls=[];let valid=true;
 const task={candidate_id:'c',job_id:'j',revision:'r1',status:'ready',result:{...brief,context_signature:'s1'}};
 const api={valid:()=>valid,candidates:()=>[c],persist:async()=>calls.push('save'),requestRemote:async()=>calls.push('request'),loadRemote:async()=>task,text:async()=>text,signature:()=> 's1',context:()=>({}),changed:()=>calls.push('render'),toast:()=>{}};
 const r=remote.create(api);
 try{
  await r.request(c);assert.deepEqual(calls,['save','request']);await r.poll();assert.equal(c.resumeIntake.phase,'ready');assert.equal(c.managerScore,0);
  const saved=calls.filter(x=>x==='save').length;await r.poll();assert.equal(calls.filter(x=>x==='save').length,saved,'unchanged polling must not rewrite the workspace');
  assert.equal(calls.filter(x=>x==='request').length,1);
  valid=false;task.result.name='Wrong';await r.poll();assert.equal(c.name,'Alex Carter');
 }finally{r.dispose();}
});
test('remote stale or foreign proposals never overwrite a candidate; another tab approval is preserved',async()=>{
 const c={id:'c',jobId:'j',name:'Example',short:'Example',managerScore:0,resumeIntake:{phase:'queued'}};let task={candidate_id:'c',job_id:'other',revision:'r',status:'ready',result:{...brief,context_signature:'old'}};let saves=0;
 const r=remote.create({valid:()=>true,candidates:()=>[c],persist:async()=>saves++,requestRemote:async()=>{},loadRemote:async()=>task,text:async()=>text,signature:()=> 'new',context:()=>({}),changed:()=>{},toast:()=>{}});
 try{await r.poll();assert.equal(saves,0);task.job_id='j';await r.poll();assert.equal(saves,0);task.status='approved';await r.poll();assert.equal(saves,0);assert.equal(c.managerScore,0);}finally{r.dispose();}
});
test('scores without supporting resume evidence are rejected',()=>{
 assert.throws(()=>intake.validate({...brief,resume_evidence:[]},text),e=>e.code==='unsupported_score');
 assert.equal(intake.validate({...brief,score:0,manager_score:0,resume_evidence:[]},text).score,0);
});
test('AI resume reviews remain estimates and do not masquerade as recruiter corrections',()=>{
 const data=input();data.candidate.aiReview={source:'resume_intake',notes:'AI GENERATED CLAIM'};data.candidate.resumeIntake={brief};
 const context=globalThis.AncalagonContext.build(data.job,data.candidate,[],[]);
 assert.doesNotMatch(JSON.stringify(context),/AI GENERATED CLAIM/);assert.ok(context.sources.some(s=>s.id==='resume-quote-1'&&s.text===brief.resume_evidence[0].quote));
});
test('reassessment quote verification preserves negation and rejects invented support',async()=>{
 const {prepare,validate}=await import('../supabase/functions/reassess-job/logic.mjs');const x=input();x.candidate.strengths=['Owned manual regression testing for billing systems'];
 const p=prepare(x),result={jd_score:8,manager_score:8,confidence:'medium',summary:'Manual testing supported',jd_reason:'Source supports testing',manager_reason:'Ownership supports priority',evidence_ids:['profile-strength-1'],evidence_support:[{source_id:'profile-strength-1',claim:'Manual testing',quote:'Owned manual regression testing for billing systems'}],questions:[]};
 assert.equal(validate(result,p).evidence_support.length,1);
 assert.throws(()=>validate({...result,evidence_support:[{...result.evidence_support[0],quote:'Owned automated regression testing for billing systems'}]},p),/invalid_result/);
});
test('durable retry saves a retained file before requesting processing',async()=>{
 const candidates=[],jobs=[{id:'j',status:'active'}],docs=new Map(),calls=[];let failUpload=true;
 const api={job:id=>jobs.find(j=>j.id===(id||'j')),workspace:()=> 'w',candidates:()=>candidates,
  extract:async()=>text,add:c=>{c.short=c.name;candidates.push(c);return c;},persist:async()=>{},
  upload:async(c,f,t)=>{calls.push('upload');if(failUpload){failUpload=false;throw Error('Interrupted upload');}docs.set(c.id,t);},text:async c=>docs.get(c.id)||'',
  requestRemote:async()=>calls.push('request'),loadRemote:async()=>null,changed:()=>{},context:()=>({}),signature:()=>'',toast:()=>{},open:()=>{}};
 const flow=intake.create(api);await flow.upload({name:'Synthetic.txt',size:text.length});
 assert.deepEqual(calls,['upload']);assert.equal(flow.hasUnsavedFile(),true);
 await flow.retry(candidates[0]);assert.deepEqual(calls,['upload','upload','request']);assert.equal(flow.hasUnsavedFile(),false);
 jobs.length=0;await flow.retry(candidates[0]);assert.equal(calls.length,3,'removed job cannot request processing');
});
test('an account change during a source read discards the outstanding result',async()=>{
 const c={id:'c',jobId:'j',name:'Example',short:'Example',managerScore:0,resumeIntake:{phase:'queued'}};let valid=true,saves=0;
 const r=remote.create({valid:()=>valid,candidates:()=>[c],persist:async()=>saves++,
  loadRemote:async()=>({candidate_id:'c',job_id:'j',revision:'r',status:'ready',result:{...brief,context_signature:'s'}}),
  text:async()=>{valid=false;return text;},context:()=>({}),signature:()=> 's',changed:()=>{},toast:()=>{}});
 try{await r.poll();assert.equal(saves,0);assert.equal(c.name,'Example');}finally{r.dispose();}
});

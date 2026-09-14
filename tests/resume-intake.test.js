const {test}=require('node:test'),assert=require('node:assert/strict');
const intake=require('../assets/resume-intake.js');
const text='Alex Carter\nQA Analyst\nOwned manual regression testing for billing systems and documented defects.';
const result={name:'Alex Carter',role:'QA Analyst',score:8,manager_score:8.7,primary_signal:'Manual regression ownership supports this QA search.',jd_reason:'Resume supports manual testing.',manager_reason:'Hands-on ownership matches the approved preference.',resume_evidence:[{claim:'Manual regression ownership',quote:'Owned manual regression testing for billing systems'}],concerns:['Confirm scope of automation work.'],tags:['QA'],screening_questions:['What testing did you personally own?']};
const clone=x=>JSON.parse(JSON.stringify(x));
const until=async fn=>{for(let i=0;i<300;i++){if(fn())return;await new Promise(r=>setTimeout(r,2));}throw Error('Timed out');};
function fixture(){
 const candidates=[],jobs=[{id:'a',title:'QA',status:'active'},{id:'b',title:'Other',status:'active'}],docs=new Map(),calls=[],saved=[];let current='a',failSave=false,failUpload=false,analyze=async()=>clone(result);
 const api={job:id=>jobs.find(j=>j.id===(id||current)),workspace:()=> 'workspace',candidates:()=>candidates,extract:async()=>text,
  add:c=>{c.short=c.name;candidates.push(c);return c;},persist:async()=>{if(failSave){failSave=false;throw Error('save failed');}saved.push(clone(candidates));},
  upload:async(c,f,t)=>{if(failUpload){failUpload=false;throw Error('upload failed');}docs.set(c.id,t);},text:async c=>docs.get(c.id)||'',
  context:c=>({jobId:c.jobId,title:jobs.find(j=>j.id===c.jobId)?.title}),fullContext:c=>({jobId:c.jobId}),signature:x=>JSON.stringify(x),
  analyze:async(...a)=>{calls.push(a);return analyze(...a);},changed:()=>{},toast:()=>{},track:()=>{},open:()=>{},recommendation:()=> 'Strong Consideration'};
 return {api,candidates,jobs,docs,calls,saved,flow:intake.create(api),file:{name:'Alex.txt',size:200},setCurrent:id=>{current=id;},setAnalysis:f=>{analyze=f;},failSave:()=>{failSave=true;},failUpload:()=>{failUpload=true;}};
}
test('one upload saves a candidate and source, then proposes scores without applying them',async()=>{
 const f=fixture();const c=await f.flow.upload(f.file);await until(()=>c.resumeIntake.phase==='ready');
 assert.equal(f.candidates.length,1);assert.equal(f.docs.get(c.id),text);assert.equal(c.short,'Alex Carter');assert.equal(c.managerScore,0);assert.equal(intake.pending(c),true);
 assert.equal(c.resumeIntake.brief.manager_score,8.7);assert.equal(f.calls.length,1);assert.equal(f.flow.hasUnsavedFile(),false);
 await f.flow.approve(c);assert.equal(c.jdScore,8);assert.equal(c.managerScore,8.7);assert.equal(intake.pending(c),false);
 const count=f.calls.length;await f.flow.upload(f.file);assert.equal(f.candidates.length,1);assert.equal(f.calls.length,count);
});
test('content identity prevents duplicate resumes in a job and permits the same person on another job',async()=>{
 const a=await intake.identity('w','a',text),same=await intake.identity('w','a',text.replaceAll('\n',' ')),b=await intake.identity('w','b',text);
 assert.equal(a.id,same.id);assert.notEqual(a.id,b.id);
 const f=fixture();const c=await f.flow.upload(f.file);await until(()=>c.resumeIntake.phase==='ready');f.setCurrent('b');
 const other=await f.flow.upload(f.file);await until(()=>other.resumeIntake.phase==='ready');assert.equal(f.candidates.length,2);assert.equal(other.jobId,'b');
});
test('switching jobs while AI runs preserves the captured job and saves only its candidate',async()=>{
 const f=fixture();let release;f.setAnalysis(()=>new Promise(r=>release=r));const c=await f.flow.upload(f.file);await until(()=>release);
 f.setCurrent('b');release(result);await until(()=>c.resumeIntake.phase==='ready');assert.equal(c.jobId,'a');assert.equal(f.calls[0][2].id,'a');
});
test('failed source upload remains recoverable and never starts AI until storage succeeds',async()=>{
 const f=fixture();f.failUpload();await f.flow.upload(f.file);const c=f.candidates[0];assert.equal(c.resumeIntake.phase,'error');assert.equal(f.calls.length,0);
 await f.flow.upload(f.file);await until(()=>c.resumeIntake.phase==='ready');assert.equal(f.candidates.length,1);assert.equal(f.calls.length,1);
});
test('interrupted intake resumes from the saved document; a completed brief is not rerun',async()=>{
 const f=fixture(),id=await intake.identity('workspace','a',text);const c={id:id.id,jobId:'a',name:'Alex.txt',short:'Alex.txt',resumeIntake:{phase:'processing',hash:id.hash,fileName:'Alex.txt',stored:true}};f.candidates.push(c);f.docs.set(c.id,text);
 f.flow.resume();await until(()=>c.resumeIntake.phase==='ready');assert.equal(f.calls.length,1);f.flow.resume();assert.equal(f.calls.length,1);
});
test('changed evidence discards the old response, failed approval leaves scores unapproved, deletion discards late output',async()=>{
 const f=fixture();let release;f.setAnalysis(()=>new Promise(r=>release=r));const c=await f.flow.upload(f.file);await until(()=>release);
 f.jobs[0].title='Updated QA';f.setAnalysis(async()=>result);release(result);await until(()=>c.resumeIntake.phase==='ready');
 assert.equal(f.calls.length,2);assert.match(c.resumeIntake.signature,/Updated QA/);
 f.failSave();await f.flow.approve(c);assert.equal(intake.pending(c),true);assert.equal(c.managerScore,0);
 f.setAnalysis(()=>new Promise(r=>release=r));release=null;await f.flow.retry(c);await until(()=>release);f.candidates.splice(0);release(result);await new Promise(r=>setTimeout(r,5));assert.equal(f.candidates.length,0);
});
test('resume quotes and scores are validated, missing identity stays explicit',()=>{
 assert.throws(()=>intake.validate({...result,resume_evidence:[{claim:'Senior manager',quote:'Managed a large engineering team'}]},text));
 assert.throws(()=>intake.validate({...result,score:NaN},text));
 assert.equal(intake.validate({...result,name:'Invented Person',role:'Director'},text).name,'Candidate');
 assert.throws(()=>intake.validate({...result,screening_questions:['a','b','c','d']},text));
});


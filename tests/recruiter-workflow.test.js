const {test}=require('node:test'),assert=require('node:assert/strict');
const recruiter=require('../assets/recruiter-workflow.js'),intake=require('../assets/resume-intake.js'),remote=require('../assets/resume-remote.js'),home=require('../assets/home.js');
const tick=()=>new Promise(r=>setImmediate(r));
async function settled(batch){for(let n=0;n<100;n++){if(!batch.view().some(i=>['waiting','reading','saving'].includes(i.state)))return;await tick();}throw Error('Batch did not settle');}
const file=name=>({name,size:100});
test('a failed file does not block later files; retry retains original job and frees saved files',async()=>{
 let job={id:'a',title:'QA'},fail=true;const calls=[],batch=recruiter.createBatch({job:()=>job,workspace:()=> 'w',toast:()=>{},upload:async(f,o)=>{calls.push([f.name,o.jobId,o.open]);if(f.name==='bad.txt'&&fail)throw Error('Upload interrupted');return {id:f.name};}});
 batch.add([file('bad.txt'),file('good.txt')]);job={id:'b',title:'Security'};await settled(batch);
 assert.deepEqual(batch.view().map(i=>i.state),['error','saved']);assert.equal(batch.hasUnsaved(),true);
 fail=false;batch.retry(batch.view()[0].id);await settled(batch);assert.equal(batch.hasUnsaved(),false);
 assert.deepEqual(calls,[['bad.txt','a',false],['good.txt','a',false],['bad.txt','a',false]]);
});
test('batch bounds reject excess files before reading, and account changes stop waiting files',async()=>{
 let release,workspace='one';const calls=[],messages=[];
 const batch=recruiter.createBatch({job:()=>({id:'a'}),workspace:()=>workspace,toast:m=>messages.push(m),upload:async f=>{calls.push(f.name);await new Promise(r=>release=r);return {id:'c'};}});
 assert.equal(batch.add(Array.from({length:21},()=>file('x.txt'))),false);assert.equal(calls.length,0);
 assert.equal(batch.add([{name:'large.txt',size:101*1024*1024}]),false);
 batch.add([file('first.txt'),file('second.txt')]);workspace='two';release();await settled(batch);
 assert.deepEqual(calls,['first.txt']);assert.match(batch.view()[1].error,/account changed/);batch.dismiss(batch.view()[1].id);assert.equal(batch.hasUnsaved(),false);
});
test('an account change during extraction creates no candidate in the next account',async()=>{
 let workspace='one',release;const candidates=[];
 const flow=intake.create({job:()=>({id:'j'}),workspace:()=>workspace,candidates:()=>candidates,extract:()=>new Promise(r=>release=r),add:c=>{candidates.push(c);return c},changed:()=>{},toast:()=>{}});
 const result=flow.upload(file('resume.txt'),{silent:true,open:false});workspace='two';release('Alex Example owned manual testing for enterprise billing systems.');
 await assert.rejects(result,/closed or removed/);assert.equal(candidates.length,0);assert.equal(flow.hasUnsavedFile(),false);
});
test('duplicate resumes reuse a candidate after an interrupted save and do not block the next file',async()=>{
 const candidates=[],jobs=[{id:'a'}],docs=new Map();let fail=true;
 const text='Alex Example owned manual testing for enterprise billing systems.';
 const flow=intake.create({job:id=>jobs.find(j=>j.id===(id||'a')),workspace:()=> 'w',candidates:()=>candidates,
  extract:async f=>text+(f.name==='other.txt'?' Also designed regression tests.':''),add:c=>{c.short=c.name;candidates.push(c);return c},persist:async()=>{},
  upload:async(c,f,t)=>{if(fail){fail=false;throw Error('Interrupted')}docs.set(c.id,t)},text:async c=>docs.get(c.id),
  requestRemote:async()=>{},loadRemote:async()=>null,context:()=>({}),signature:()=>'',changed:()=>{},toast:()=>{},open:()=>{}});
 const batch=recruiter.createBatch({job:()=>jobs[0],workspace:()=> 'w',toast:()=>{},upload:(f,o)=>flow.upload(f,o),release:id=>flow.releaseFile(id)});
 batch.add([file('first.txt'),file('duplicate.txt'),file('other.txt')]);await settled(batch);
 assert.equal(candidates.length,2);assert.equal(docs.size,2);assert.deepEqual(batch.view().map(i=>i.state),['error','saved','saved']);
 batch.retry(batch.view()[0].id);await settled(batch);assert.equal(candidates.length,2);assert.equal(batch.hasUnsaved(),false);assert.equal(flow.hasUnsavedFile(),false);
});
test('twenty in-flight assessments use one status read and one save per poll, with no full result reads',async()=>{
 const candidates=Array.from({length:20},(_,i)=>({id:String(i),jobId:'j',resumeIntake:{phase:'queued'}}));let batches=0,full=0,saves=0,renders=0;
 const r=remote.create({valid:()=>true,candidates:()=>candidates,loadRemoteBatch:async ids=>{batches++;return ids.map(id=>({candidate_id:id,job_id:'j',revision:'r1',status:'processing'}))},
  loadRemote:async()=>full++,persist:async()=>saves++,changedMany:()=>renders++,toast:()=>{}});
 try{await r.poll();assert.deepEqual([batches,full,saves,renders],[1,0,1,1]);await r.poll();assert.deepEqual([batches,full,saves,renders],[2,0,1,1]);}finally{r.dispose();}
});
test('batch status does not make a proposal approvable if a new revision starts before its full read',async()=>{
 const c={id:'c',jobId:'j',resumeIntake:{phase:'processing'}};let saves=0;
 const r=remote.create({valid:()=>true,candidates:()=>[c],loadRemoteBatch:async()=>[{candidate_id:'c',job_id:'j',status:'ready',revision:'r1'}],loadRemote:async()=>({candidate_id:'c',job_id:'j',status:'processing',revision:'r2'}),persist:async()=>saves++,toast:()=>{}});
 try{await r.poll();assert.equal(c.resumeIntake.phase,'processing');assert.equal(saves,0);}finally{r.dispose();}
});
test('Home keeps server intake status authoritative and clears reviewed intake without hiding reassessments',()=>{
 const state={jobs:[{id:'j'}],candidates:[{id:'a',jobId:'j',resumeIntake:{phase:'ready'}},{id:'b',jobId:'j',aiReview:{},resumeIntake:{reviewedAt:1}}],feedback:[]};
 const m=home.model(state,null,false,[{candidate_id:'a',job_id:'j',source:'intake',status:'processing'},{candidate_id:'b',job_id:'j',source:'intake',status:'ready'}]);
 assert.equal(m.ready.length,0);assert.deepEqual(m.working.map(c=>c.id),['a']);assert.deepEqual(m.steps,[true,true,true,false]);
 state.feedback.push({text:'Owned test plans'});assert.equal(home.model(state,null,false).steps[3],true);
 const updated=home.model(state,null,false,[{candidate_id:'b',job_id:'j',source:'reassessment',status:'ready'}]);assert.ok(updated.ready.some(c=>c.id==='b'));
});
test('closed searches leave the work queue and remain searchable by title or client',()=>{
 const jobs=[{id:'a',title:'QA',client:'Healthcare'},{id:'b',title:'Security Engineer',status:'closed',client:'Retail'}];
 assert.deepEqual(recruiter.jobList(jobs).map(j=>j.id),['a']);assert.deepEqual(recruiter.jobList(jobs,'closed',' RETAIL ').map(j=>j.id),['b']);assert.equal(recruiter.jobList(jobs,'all').length,2);
 assert.equal(recruiter.queue([{jobId:'b',resumeIntake:{phase:'ready'}}],jobs[1]).ready.length,0);
});
test('a failed enqueue is actionable and recovers from the saved server task',async()=>{
 const c={id:'c',jobId:'j',resumeIntake:{phase:'queued',stored:true}};let rendered=0;
 const r=remote.create({valid:()=>true,candidates:()=>[c],persist:async()=>{},requestRemote:async()=>{throw Error('Connection interrupted')},changed:()=>rendered++,toast:()=>{},loadRemoteBatch:async()=>[{candidate_id:'c',job_id:'j',revision:'r1',status:'processing'}]});
 try{await r.request(c);assert.equal(c.resumeIntake.phase,'error');assert.equal(c.resumeIntake.stored,true);assert.match(c.resumeIntake.error,/Connection interrupted/);await r.poll();assert.equal(c.resumeIntake.phase,'processing');assert.equal(c.resumeIntake.error,'');assert.equal(rendered,2);}finally{r.dispose();}
});
test('batched data reads stay workspace scoped, deduplicate IDs, and chunk requests',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),calls=[];
 const client={from(table){const entry={table};calls.push(entry);const q={select(columns){entry.columns=columns;return q},eq(k,v){entry.scope=[k,v];return q},in(k,v){entry.ids=Array.from(v);return q},then(resolve){return Promise.resolve({data:entry.ids.map(candidate_id=>({candidate_id})),error:null}).then(resolve)}};return q;}};
 const context={window:{},console,setTimeout,clearTimeout};vm.runInNewContext(fs.readFileSync('assets/data.js','utf8'),context);
 const service=context.window.AncalagonData.create({client,session:{user:{id:'me'}},workspace:{id:'workspace'}});
 const ids=Array.from({length:205},(_,i)=>String(i));const rows=await service.loadResumeIntakes([...ids,ids[0]]);
 assert.equal(rows.length,205);assert.deepEqual(calls.map(c=>c.ids.length),[100,100,5]);
 for(const call of calls){assert.equal(call.table,'resume_intake_tasks');assert.deepEqual(call.scope,['workspace_id','workspace']);assert.doesNotMatch(call.columns,/result/);}
 await service.loadResumeIntakes([]);assert.equal(calls.length,3);
});

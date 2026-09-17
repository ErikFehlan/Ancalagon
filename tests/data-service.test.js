const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const clone = x => JSON.parse(JSON.stringify(x));
function fixture() {
  const rows = {jobs:[{id:'job',workspace_id:'workspace',title:'QA Analyst',criteria:[],created_at:'2026-01-01',updated_at:'2026-01-01'}]};
  const calls=[]; let fail=false,lose=false,rpcHandler;
  const client={rpc:(name,args)=>rpcHandler(name,args),from(table){let operation='select',payload,filters=[];const q={
    select(){return q},eq(k,v){filters.push([k,v]);return q},is(k,v){return q.eq(k,v)},
    insert(v){operation='insert';payload=v;return q},update(v){operation='update';payload=v;return q},delete(){operation='delete';return q},
    then(resolve,reject){return Promise.resolve().then(()=>{
      rows[table] ||= [];
      const matching=rows[table].filter(row=>filters.every(([k,v])=>typeof row[k]==='object'&&row[k]!==null?JSON.stringify(row[k])===v:row[k]===v));
      if(operation==='select')return {data:clone(matching),error:null};
      calls.push({table,operation,payload,filters});
      if(fail){fail=false;return {data:null,error:new Error('network unavailable')}}
      if(operation==='insert'){if(rows[table].some(r=>(r.id&&r.id===payload.id)||(r.event_id&&r.event_id===payload.event_id)))return {data:null,error:{code:'23505'}};const row=clone(payload);rows[table].push(row);if(lose){lose=false;return {data:null,error:new Error('Response lost after commit')}}return {data:[row],error:null}}
      if(operation==='update')matching.forEach(row=>Object.assign(row,clone(payload)));
      if(operation==='delete')rows[table]=rows[table].filter(row=>!matching.includes(row));
      return {data:clone(matching),error:null};
    }).then(resolve,reject)}
  };return q}};
  const context={window:{location:{pathname:'/'}},console,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto};
  vm.runInNewContext(fs.readFileSync('assets/data.js','utf8'),context);
  const service=context.window.AncalagonData.create({client,workspace:{id:'workspace'},session:{user:{id:'user'}}});
  return {service,rows,calls,setRpc(handler){rpcHandler=handler},failNext(){fail=true},loseNextInsert(){lose=true}};
}
test('navigation telemetry recovers a lost response without double counting; save clicks are excluded',async()=>{
 const f=fixture();f.loseNextInsert();
 await f.service.trackEvent('signed_in',{sessionId:'session'});
 assert.equal(f.rows.app_events.length,1);assert.equal(f.calls.length,2);
 assert.equal(f.calls[0].payload.event_id,f.calls[1].payload.event_id);
 await f.service.trackEvent('candidate_added',{sessionId:'session'});
 await f.service.trackEvent('resume_analyzed',{sessionId:'session'});
 assert.equal(f.calls.length,2);
});
test('load and unchanged save perform no writes; one job edit updates only that job',async()=>{
 const f=fixture(),state=await f.service.load();await f.service.flush(state);assert.equal(f.calls.length,0);
 state.jobs[0].title='Updated';await f.service.flush(state);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].operation,'update');assert.equal(f.rows.jobs[0].title,'Updated');
 await f.service.flush(state);assert.equal(f.calls.length,1);
});
test('stale tab cannot overwrite another tab and unrelated new records survive',async()=>{
 const f=fixture(),state=await f.service.load();f.rows.jobs[0].updated_at='new-version';f.rows.jobs[0].title='Other tab';
 f.rows.jobs.push({id:'other',workspace_id:'workspace',title:'Other job'});state.jobs[0].title='Stale edit';
 await assert.rejects(f.service.flush(state),e=>e.code==='SAVE_CONFLICT');assert.equal(f.rows.jobs[0].title,'Other tab');assert.equal(f.rows.jobs.length,2);
});
test('failed update retains existing data and can be retried',async()=>{
 const f=fixture(),state=await f.service.load();state.jobs[0].title='Retry';f.failNext();
 await assert.rejects(f.service.flush(state));assert.equal(f.rows.jobs[0].title,'QA Analyst');
 await f.service.flush(state);assert.equal(f.rows.jobs[0].title,'Retry');
});
test('removal deletes only the job loaded and removed in this tab',async()=>{
 const f=fixture(),state=await f.service.load();f.rows.jobs.push({id:'new',workspace_id:'workspace',title:'New elsewhere'});
 state.jobs=[];await f.service.flush(state);assert.deepEqual(f.rows.jobs.map(x=>x.id),['new']);
});
test('candidate-only interpretation survives reload without promoting a shared preference',async()=>{
 const f=fixture(),state=await f.service.load();
 state.candidates.push({id:'c',jobId:'job',name:'Test',short:'Test',strengths:[],concerns:[],tags:[],jdScore:7,managerScore:7});
 state.feedback.push({id:'f',jobId:'job',candidateId:'c',candidate:'Test',type:'General note',outcome:'Neutral / no signal',text:'ownership unclear',learningScope:'candidate',signalStatus:'candidate_only',interpretation:{text:'Clarify personal ownership.',source:'ai'},createdAt:1,updatedAt:1});
 await f.service.flush(state);const restored=await f.service.load();
 assert.equal(restored.feedback[0].text,'ownership unclear');assert.equal(restored.feedback[0].interpretation.text,'Clarify personal ownership.');assert.equal(restored.feedback[0].signalStatus,'candidate_only');
});
test('unchanged scheduling stays saved and direct flush clears scheduled saving status',async()=>{
 const f=fixture(),state=await f.service.load(),statuses=[];
 f.service.schedule(state,()=>{},s=>statuses.push(s));
 assert.deepEqual(statuses,['saved']);assert.equal(f.calls.length,0);
 state.jobs[0].title='Direct flush';f.service.schedule(state,()=>{},s=>statuses.push(s));
 assert.equal(statuses.at(-1),'saving');await f.service.flush(state);assert.equal(statuses.at(-1),'saved');
 f.service.schedule(state,()=>{},s=>statuses.push(s));assert.equal(statuses.at(-1),'saved');
 state.jobs[0].title='Fail';f.failNext();await assert.rejects(f.service.flush(state));assert.equal(statuses.at(-1),'error');
 await f.service.flush(state);assert.equal(statuses.at(-1),'saved');
});
test('reload protection tracks pending writes, not connection labels, and summaries round-trip',async()=>{
 const f=fixture();assert.equal(f.service.hasPendingChanges(),false);const state=await f.service.load();assert.equal(f.service.hasPendingChanges(),false);
 state.jobs[0].title='Offline edit';f.service.markPending(state);assert.equal(f.service.hasPendingChanges(),true);
 await f.service.flush(state);assert.equal(f.service.hasPendingChanges(),false);
 state.candidates.push({id:'c',jobId:'job',name:'Test',short:'Test',strengths:[],concerns:[],tags:[],jdScore:7,managerScore:7,submissionDraft:{text:'An editable, evidence-based summary.',updatedAt:1}});
 await f.service.flush(state);const restored=await f.service.load();assert.equal(restored.candidates[0].submissionDraft.text,'An editable, evidence-based summary.');assert.equal(restored.candidates[0].aiReview,null);
 assert.equal(f.service.hasPendingChanges(),false);
});

test('automatic evaluation queue and proposal persist without a manual correction or submission draft',async()=>{
 const f=fixture(),state=await f.service.load();
 state.candidates.push({id:'c',jobId:'job',name:'Test',short:'Test',strengths:[],concerns:[],tags:[],jdScore:7,managerScore:7,feedbackEvaluation:{status:'queued',updatedAt:1}});
 await f.service.flush(state);let restored=await f.service.load();
 assert.equal(restored.candidates[0].feedbackEvaluation.status,'queued');assert.equal(restored.candidates[0].aiReview,null);
 const proposal={status:'pending',currentScore:7,proposedScore:8,contextSignature:'latest',reasons:['Recorded ownership evidence.']};
 restored.candidates[0].feedbackEvaluation={status:'pending',proposal,updatedAt:2};
 await f.service.flush(restored);restored=await f.service.load();
 assert.deepEqual(clone(restored.candidates[0].feedbackEvaluation.proposal),proposal);
 assert.equal(restored.candidates[0].managerScore,7);assert.equal(restored.candidates[0].aiReview,null);
});

test('server approval adopts authoritative versions and preserves drafts and queued local edits',async()=>{
 const f=fixture(),state=await f.service.load();
 const c={id:'c',jobId:'job',name:'Test',short:'Test',role:'QA',stage:'Sourced',resumeJDScore:7,jdScore:7,originalManagerScore:7,managerScore:7,rec:'Consider',confidence:'Low',signal:'Testing',strengths:['Manual QA'],concerns:[],tags:[],screeningQuestions:[],createdAt:1,updatedAt:1,aiReview:null,feedbackEvaluation:null,submissionDraft:{text:'Keep draft',updatedAt:1}};
 state.candidates.push(c);await f.service.flush(state);
 let release,started=false;
 f.setRpc(async(name,args)=>{
  assert.equal(name,'review_job_reassessment');assert.equal(args.p_candidate,'c');assert.equal(args.p_revision,'revision');
  started=true;await new Promise(r=>release=r);
  const row=f.rows.candidates[0];row.jd_score=8;row.manager_score=9;row.recommendation='Strong Consideration';row.updated_at='2026-09-14T15:00:00.000Z';
  const assessment=f.rows.candidate_assessments.find(a=>a.assessment_type==='manual_correction');
  assessment.evidence.review={source:'hybrid_reevaluation',verdict:'Needs Adjustment',correctedScore:9,correctedJDScore:8,notes:'Ownership evidence',createdAt:100,history:[{previousScore:7,newScore:9}]};
  return {data:{status:'approved',candidate:clone(row),assessment:clone(assessment)},error:null};
 });
 const approval=f.service.reviewJobReassessment('c','revision','approve',state);
 while(!started)await new Promise(r=>setTimeout(r,1));
 c.role='Updated role while approval runs';
 const queued=f.service.flush(state);
 release();await approval;await queued;
 assert.equal(c.managerScore,9);assert.equal(c.aiReview.correctedScore,9);assert.equal(c.submissionDraft.text,'Keep draft');
 assert.equal(f.rows.candidates[0].manager_score,9);assert.equal(f.rows.candidates[0].jd_score,8);assert.equal(f.rows.candidates[0].role,'Updated role while approval runs');
 await f.service.flush(state);assert.equal(f.service.hasPendingChanges(),false);
 const restored=await f.service.load();assert.equal(restored.candidates[0].managerScore,9);assert.equal(restored.candidates[0].submissionDraft.text,'Keep draft');
});
test('stale backend approval returns PT409 once without changing the score or blocking later saves',async()=>{
 const f=fixture(),state=await f.service.load();state.candidates.push({id:'c',jobId:'job',name:'Test',short:'Test',strengths:[],concerns:[],tags:[],jdScore:7,managerScore:7});
 await f.service.flush(state);let calls=0;f.setRpc(async()=>{calls++;return {data:null,error:Object.assign(Error('Evidence changed'),{code:'PT409'})}});
 await assert.rejects(f.service.reviewJobReassessment('c','old','approve',state),e=>e.code==='PT409');
 assert.equal(state.candidates[0].managerScore,7);assert.equal(calls,1);
 state.candidates[0].submissionDraft={text:'Still editable after conflict',updatedAt:1};
 await f.service.flush(state);assert.equal(f.service.hasPendingChanges(),false);assert.equal(calls,1);
 const restored=await f.service.load();assert.equal(restored.candidates[0].managerScore,7);assert.equal(restored.candidates[0].submissionDraft.text,'Still editable after conflict');
});

test('source timestamps stay consistent with worker context after database update timestamps change',async()=>{
 const f=fixture(),state=await f.service.load();
 state.candidates.push({id:'c',jobId:'job',name:'Test',short:'Test',strengths:[],concerns:[],tags:[],jdScore:7,managerScore:7,screeningInsight:{canDoJob:'Yes',cultureFit:'Strong',notes:'Manual testing evidence',createdAt:123,previousJDScore:7,previousManagerScore:7,assessment:{jd_score:7,manager_score:7}}});
 state.feedback.push({id:'f',jobId:'job',candidateId:'c',type:'General note',text:'Testing ownership',learningScope:'candidate',createdAt:10,updatedAt:123});
 state.interviewOutcomes.push({id:'o',jobId:'job',candidateId:'c',stage:'Technical',decision:'Move Forward',createdAt:10,updatedAt:456});
 await f.service.flush(state);
 f.rows.manager_feedback[0].updated_at='2026-09-14T15:00:00Z';f.rows.interview_outcomes[0].updated_at='2026-09-14T15:00:00Z';f.rows.screening_insights[0].created_at='2026-09-14T15:00:00Z';
 const restored=await f.service.load();
 assert.equal(restored.feedback[0].updatedAt,123);assert.equal(restored.interviewOutcomes[0].updatedAt,456);assert.equal(restored.candidates[0].screeningInsight.createdAt,123);
});

test('intake metadata and pending status round-trip without redundant writes; source reads stay scoped',async()=>{
 const f=fixture(),state=await f.service.load();
 state.candidates.push({id:'intake',jobId:'job',name:'Resume',short:'Resume',strengths:[],concerns:[],tags:[],jdScore:0,managerScore:0,resumeIntake:{hash:'abc',fileName:'Resume.txt',phase:'processing',stored:true,updatedAt:123}});
 await f.service.flush(state);const restored=await f.service.load();
 assert.equal(restored.candidates[0].resumeIntake.phase,'processing');assert.equal(restored.candidates[0].resumeIntake.hash,'abc');
 const count=f.calls.length;await f.service.flush(restored);assert.equal(f.calls.length,count);
 f.rows.candidate_documents=[{workspace_id:'workspace',job_id:'job',candidate_id:'intake',extracted_text:'Correct resume',created_at:'2026-01-01'},{workspace_id:'other',job_id:'job',candidate_id:'intake',extracted_text:'PRIVATE',created_at:'2026-02-01'}];
 assert.equal(await f.service.loadResumeText(restored.candidates[0]),'Correct resume');
});

test('retry after a lost insert response recovers the same record without a duplicate',async()=>{
 const f=fixture(),state=await f.service.load();state.candidates.push({id:'stable-candidate',jobId:'job',name:'Synthetic',short:'Synthetic',strengths:[],concerns:[],tags:[],jdScore:7,managerScore:7,createdAt:1,updatedAt:1});
 f.loseNextInsert();await assert.rejects(f.service.flush(state),/Response lost/);assert.equal(f.rows.candidates.length,1);assert.equal(f.service.hasPendingChanges(),true);
 await f.service.flush(state);assert.equal(f.rows.candidates.length,1);assert.equal(f.service.hasPendingChanges(),false);
});
test('a colliding insert with different evidence is never adopted as the local save',async()=>{
 const f=fixture(),state=await f.service.load();state.candidates.push({id:'collision',jobId:'job',name:'Local',short:'Local',strengths:[],concerns:[],tags:[],jdScore:7,managerScore:7,createdAt:1,updatedAt:1});
 f.rows.candidates=[{id:'collision',workspace_id:'workspace',job_id:'job',name:'Another tab'}];
 await assert.rejects(f.service.flush(state),e=>e.code==='23505');assert.equal(f.rows.candidates[0].name,'Another tab');
});

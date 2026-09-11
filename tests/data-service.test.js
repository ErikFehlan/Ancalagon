const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const clone = x => JSON.parse(JSON.stringify(x));
function fixture() {
  const rows = {jobs:[{id:'job',workspace_id:'workspace',title:'QA Analyst',criteria:[],created_at:'2026-01-01',updated_at:'2026-01-01'}]};
  const calls=[]; let fail=false;
  const client={from(table){let operation='select',payload,filters=[];const q={
    select(){return q},eq(k,v){filters.push([k,v]);return q},is(k,v){return q.eq(k,v)},
    insert(v){operation='insert';payload=v;return q},update(v){operation='update';payload=v;return q},delete(){operation='delete';return q},
    then(resolve,reject){return Promise.resolve().then(()=>{
      rows[table] ||= [];
      const matching=rows[table].filter(row=>filters.every(([k,v])=>typeof row[k]==='object'&&row[k]!==null?JSON.stringify(row[k])===v:row[k]===v));
      if(operation==='select')return {data:clone(matching),error:null};
      calls.push({table,operation,payload,filters});
      if(fail){fail=false;return {data:null,error:new Error('network unavailable')}}
      if(operation==='insert'){const row=clone(payload);rows[table].push(row);return {data:[row],error:null}}
      if(operation==='update')matching.forEach(row=>Object.assign(row,clone(payload)));
      if(operation==='delete')rows[table]=rows[table].filter(row=>!matching.includes(row));
      return {data:clone(matching),error:null};
    }).then(resolve,reject)}
  };return q}};
  const context={window:{},console,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto};
  vm.runInNewContext(fs.readFileSync('assets/data.js','utf8'),context);
  const service=context.window.AncalagonData.create({client,workspace:{id:'workspace'},session:{user:{id:'user'}}});
  return {service,rows,calls,failNext(){fail=true}};
}
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

const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../assets/candidate-automation.js');
const waitFor=async predicate=>{for(let i=0;i<300;i++){if(predicate())return;await new Promise(r=>setTimeout(r,2));}throw Error('Automation did not settle');};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function setup(overrides={}){
 const c={id:'c',jobId:'j',managerScore:7,rec:'Consider'},events=[];
 let signature='v1',busy=false,valid=true;
 const api={valid:()=>valid,busy:()=>busy,signature:()=>signature,changed:c=>events.push(c.feedbackEvaluation.status),persist:async()=>events.push('saved'),analyze:async()=>({status:'pending',currentScore:7,proposedScore:8,contextSignature:signature,reasons:['Candidate evidence supports ownership.']}),...overrides};
 const automation=create(api,{delay:1});
 return {c,events,api,automation,setSignature:v=>signature=v,setBusy:v=>busy=v,setValid:v=>valid=v};
}
test('brief feedback queues automatically, saves before AI, and requires review without changing scores',async()=>{
 const f=setup({analyze:async c=>{assert.ok(f.events.includes('saved'));return {status:'pending',currentScore:7,proposedScore:8,contextSignature:'v1',reasons:['Evidence']};}});
 try{f.automation.request(f.c);await waitFor(()=>f.automation.canReview(f.c));assert.equal(f.c.managerScore,7);assert.equal(f.c.rec,'Consider');assert.equal(f.c.feedbackEvaluation.proposal.proposedScore,8);
 f.setSignature('v2');assert.equal(f.automation.canReview(f.c),false);f.setSignature('v1');f.c.managerScore=9;assert.equal(f.automation.canReview(f.c),false);
 }finally{f.automation.dispose();}
});
test('rapid notes wait for interpretations and coalesce into one assessment',async()=>{
 let calls=0;const f=setup({analyze:async()=>{calls++;return {status:'pending',currentScore:7,proposedScore:8,contextSignature:'v1'};}});
 try{f.setBusy(true);f.automation.request(f.c);f.automation.request(f.c);await new Promise(r=>setTimeout(r,15));assert.equal(calls,0);
 f.setBusy(false);await waitFor(()=>f.automation.canReview(f.c));assert.equal(calls,1);
 }finally{f.automation.dispose();}
});
test('a late response for replaced feedback cannot overwrite the newer proposal',async()=>{
 const old=deferred();let calls=0,oldSignal;const f=setup({analyze:async(c,signal)=>{calls++;if(calls===1){oldSignal=signal;return old.promise;}return {status:'pending',currentScore:7,proposedScore:6,contextSignature:'v2'};}});
 try{f.automation.request(f.c);await waitFor(()=>calls===1);f.setSignature('v2');f.automation.request(f.c);await waitFor(()=>f.automation.canReview(f.c));assert.equal(oldSignal.aborted,true);
 old.resolve({status:'pending',currentScore:7,proposedScore:10,contextSignature:'v1'});await new Promise(r=>setTimeout(r,10));assert.equal(f.c.feedbackEvaluation.proposal.proposedScore,6);
 }finally{f.automation.dispose();}
});
test('changed context during a request is assessed again; removed candidates receive no proposal',async()=>{
 let calls=0;const pending=deferred();const f=setup({analyze:async()=>{calls++;if(calls===1)return pending.promise;return {status:'pending',currentScore:7,proposedScore:8,contextSignature:'v2'};}});
 try{f.automation.request(f.c);await waitFor(()=>calls===1);f.setSignature('v2');pending.resolve({contextSignature:'v1'});await waitFor(()=>f.automation.canReview(f.c));assert.equal(calls,2);f.setValid(false);assert.equal(f.automation.canReview(f.c),false);
 }finally{f.automation.dispose();}
 const removed=deferred();let started=false;const g=setup({analyze:async()=>{started=true;return removed.promise;}});
 try{g.automation.request(g.c);await waitFor(()=>started);g.setValid(false);removed.resolve({status:'pending',contextSignature:'v1'});await new Promise(r=>setTimeout(r,10));assert.equal(g.c.feedbackEvaluation.proposal,undefined);
 }finally{g.automation.dispose();}
});
test('failed note save prevents AI; failed proposal save prevents approval; explicit retry recovers',async()=>{
 let calls=0;const f=setup({persist:async()=>{throw Error('Save unavailable');},analyze:async()=>{calls++;}});
 try{f.automation.request(f.c);await waitFor(()=>f.c.feedbackEvaluation.status==='error');assert.equal(calls,0);assert.equal(f.automation.canReview(f.c),false);
 }finally{f.automation.dispose();}
 let saves=0;const g=setup({persist:async()=>{if(++saves===2)throw Error('Proposal save failed');}});
 try{g.automation.request(g.c);await waitFor(()=>g.c.feedbackEvaluation.status==='error');assert.equal(g.c.managerScore,7);assert.equal(g.automation.canReview(g.c),false);
 g.automation.request(g.c);await waitFor(()=>g.automation.canReview(g.c));assert.equal(g.c.managerScore,7);
 }finally{g.automation.dispose();}
});
test('reload resumes only interrupted work, while completed proposals do not call AI again',async()=>{
 let calls=0;const f=setup({analyze:async c=>{calls++;return {status:'pending',currentScore:7,proposedScore:8,contextSignature:'v1'};}});
 try{f.c.feedbackEvaluation={status:'running'};const untouched={...f.c,id:'other',feedbackEvaluation:{status:'pending',proposal:{}}};f.automation.resume([f.c,untouched]);await waitFor(()=>f.automation.canReview(f.c));assert.equal(calls,1);assert.equal(untouched.feedbackEvaluation.status,'pending');
 }finally{f.automation.dispose();}
});
test('concurrency stays bounded across candidates',async()=>{
 const waits=[],f=setup({analyze:async()=>{const d=deferred();waits.push(d);return d.promise;}});
 try{const cs=[f.c,{...f.c,id:'b'},{...f.c,id:'d'}];cs.forEach(f.automation.request);await waitFor(()=>waits.length===2);await new Promise(r=>setTimeout(r,10));assert.equal(waits.length,2);
 waits[0].resolve({status:'pending',currentScore:7,contextSignature:'v1'});await waitFor(()=>waits.length===3);waits.slice(1).forEach(d=>d.resolve({status:'pending',currentScore:7,contextSignature:'v1'}));await waitFor(()=>cs.every(c=>c.feedbackEvaluation.status==='pending'));
 }finally{f.automation.dispose();}
});

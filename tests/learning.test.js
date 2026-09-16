const test=require('node:test'),assert=require('node:assert/strict');
const lib=import('../scripts/learning-lib.mjs');
const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
function fixture(){
 const state={workspace_id:id(1),permission:{enabled:true},examples:Array.from({length:75},(_,i)=>({id:id(i+100),workspace_id:id(1),revision:'rev-'+i,task_version:'feedback-v1',review_kind:i%2?'corrected':'accepted',job_id:id(10+Math.floor(i/15)),candidate_id:id(i+200)}))};
 const curated=state.examples.map((x,i)=>({source_id:x.id,revision:x.revision,input:{job:{title:'QA'},feedback:{text:'Test planning example '+i},evaluation_context:{sources:[{text:'Documented testing responsibility '+i}]}},target:{summary:'Test planning is supported.',clarification_question:'Did they build the automation?'},reviewer:'Curator',authorized:true,deidentified:true,faithful_to_review:true}));
 return {state,curated};
}
test('learning holds out entire jobs and exports only train messages, without source identifiers',async()=>{
 const {buildDataset,trainingJSONL,currentSources}=await lib,{state,curated}=fixture(),bundle=buildDataset(state,curated);
 const train=bundle.examples.filter(x=>x.split==='train'),held=bundle.examples.filter(x=>x.split==='test');
 assert.equal(train.length,60);assert.equal(held.length,15);assert.ok(held.every(x=>!train.some(y=>y.job_id===x.job_id)));
 const jsonl=trainingJSONL(bundle),lines=jsonl.trim().split('\n').map(JSON.parse);
 assert.equal(lines.length,60);assert.ok(!jsonl.includes(state.workspace_id));assert.ok(!jsonl.includes('source_id'));
 assert.ok(lines.every(x=>x.messages.length===3));currentSources(bundle,state);
 state.examples[0].revision='changed';assert.throws(()=>currentSources(bundle,state),/changed/);
});
test('learning rejects unapproved, identifying, stale and duplicated examples',async()=>{
 const {buildDataset}=await lib;
 for(const mutate of [
  f=>f.state.permission.enabled=false,
  f=>f.curated[0].authorized=false,
  f=>f.curated[0].deidentified=false,
  f=>f.curated[0].faithful_to_review=false,
  f=>f.curated[0].reviewer='',
  f=>f.curated[0].input.feedback.text='Contact person@example.test',
  f=>f.curated[0].input.evaluation_context={url:'https://private.test'},
  f=>f.curated[0].revision='stale',
  f=>f.state.examples[0].workspace_id=id(2),
  f=>f.curated[0].target.jd_score=10,
  f=>f.curated[0].target.clarification_question=undefined,
  f=>f.curated[1].input=structuredClone(f.curated[0].input),
  f=>f.curated.push(f.curated[0]),
  f=>f.state.examples.forEach(x=>x.job_id=id(10)),
 ]){const f=fixture();mutate(f);assert.throws(()=>buildDataset(f.state,f.curated));}
});
test('model promotion requires better held-out results, human review, factuality and unchanged outputs',async()=>{
 const {buildDataset,hash,evaluationMetrics,verifyBundle}=await lib,{state,curated}=fixture(),bundle=buildDataset(state,curated);
 const evaluation={dataset_hash:bundle.dataset_hash,task_version:'feedback-v1',baseline_model:'gpt-4.1-mini-2025-04-14',candidate_model:'ft:gpt-4.1-mini-2025-04-14:test:feedback:abc',results:bundle.examples.filter(x=>x.split==='test').map(x=>({source_id:x.source_id,baseline:{summary:'Supported testing.',clarification_question:null},candidate:x.target}))};
 const ratings=evaluation.results.map(x=>({source_id:x.source_id,output_hash:hash(x),reviewer:'Reviewer',baseline_quality:3,candidate_quality:4,unsupported_claims:false,scope_safe:true}));
 assert.equal(evaluationMetrics(bundle,evaluation,ratings).candidate_mean,4);
 for(const mutate of [
  r=>r[0].scope_safe=false,r=>r[0].unsupported_claims=true,r=>r[0].reviewer='',r=>r[0].output_hash='stale',r=>r[0].candidate_quality=null,r=>r.forEach(x=>x.baseline_quality=4),r=>r.pop(),r=>r[1]=r[0],
 ]){const copy=structuredClone(ratings);mutate(copy);assert.throws(()=>evaluationMetrics(bundle,evaluation,copy));}
 const broken=structuredClone(evaluation);broken.results[0].candidate={summary:'Invented score',jd_score:10};
 const rerated=structuredClone(ratings);rerated[0].output_hash=hash(broken.results[0]);assert.throws(()=>evaluationMetrics(bundle,broken,rerated),/gates/);
 const modified=structuredClone(bundle);modified.examples[0].input.feedback.text='changed';assert.throws(()=>verifyBundle(modified),/changed/);
});

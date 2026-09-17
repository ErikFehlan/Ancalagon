const test=require('node:test'),assert=require('node:assert/strict');
const lib=import('../scripts/learning-lib.mjs');
const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
function fixture(){
 const state={workspace_id:id(1),permission:{enabled:true},examples:Array.from({length:75},(_,i)=>({id:id(i+100),workspace_id:id(1),revision:'rev-'+i,task_version:'feedback-v1',review_kind:i%2?'corrected':'accepted',job_id:id(10+Math.floor(i/15)),candidate_id:id(i+200)}))};
 const curated=state.examples.map((x,i)=>({source_id:x.id,revision:x.revision,input:{job:{title:'QA'},feedback:{text:'Test planning example '+i},evaluation_context:{sources:[{text:'Documented testing responsibility '+i}]}},target:{summary:'Test planning is supported.',clarification_question:'Did they build the automation?'},reviewer:'Curator',authorized:true,deidentified:true,faithful_to_review:true}));
 return {state,curated};
}
test('training requires recorded provider eligibility before uploading and stops at provider shutdown',async()=>{
 const {trainingEligibility}=await lib,now=Date.parse('2026-09-17T00:00:00Z');
 for(const record of [undefined,'','unchecked',42])assert.throws(()=>trainingEligibility(record,now),/eligibility/);
 assert.equal(trainingEligibility('Provider confirmed access for this test project',now).recorded_at,'2026-09-17T00:00:00.000Z');
 assert.throws(()=>trainingEligibility('Provider confirmed historical access',Date.parse('2027-01-06T00:00:00Z')),/no longer supports/);
});
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
test('operator commands complete a synthetic train, evaluate, promote, rollback and cleanup cycle without network access',async()=>{
 const {mkdtemp,writeFile,readFile,rm}=require('node:fs/promises'),{tmpdir}=require('node:os'),{join,resolve}=require('node:path'),{spawnSync}=require('node:child_process');
 const {hash}=await lib,dir=await mkdtemp(join(tmpdir(),'learning-test-')),{state,curated}=fixture();
 const write=(name,data)=>writeFile(join(dir,name),JSON.stringify(data));const read=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
 const run=(command,extra=['--eligibility-record','Synthetic provider eligibility confirmed'])=>spawnSync(process.execPath,['--import',resolve('tests/fixtures/learning-provider.mjs'),resolve('scripts/learning.mjs'),command,'--workspace',state.workspace_id,'--dir',dir,...extra],{encoding:'utf8',timeout:10000,env:{...process.env,LEARNING_TEST_DIR:dir,SUPABASE_ACCESS_TOKEN:'synthetic',SUPABASE_PROJECT_REF:'a'.repeat(20),OPENAI_API_KEY:'synthetic'}});
 const good=command=>{const result=run(command);assert.equal(result.status,0,result.stderr);return result;};
 try{
  await write('state.json',state);await write('curated.json',curated);await write('calls.json',[]);
  good('build');assert.equal((await read('calls.json')).some(x=>x.url.includes('api.openai.com')),false);
  const unverified=run('train',[]);assert.equal(unverified.status,1);assert.match(unverified.stderr,/eligibility/);
  assert.equal((await read('calls.json')).some(x=>x.url.includes('api.openai.com')),false,'unverified account uploaded training data');
  good('train');assert.equal((await read('run.json')).job_id,'ftjob-synthetic');
  const duplicate=run('train');assert.equal(duplicate.status,1);assert.match(duplicate.stderr,/already exists/);
  assert.equal((await read('calls.json')).filter(x=>x.url.endsWith('/fine_tuning/jobs')).length,1);
  good('poll');good('evaluate');const evaluation=await read('evaluation.json');assert.equal(evaluation.results.length,15);
  assert.equal(run('promote').status,1,'unreviewed output was promoted');
  await write('ratings.json',evaluation.results.map(x=>({source_id:x.source_id,output_hash:hash(x),reviewer:'Reviewer',baseline_quality:3,candidate_quality:4,unsupported_claims:false,scope_safe:true})));
  good('promote');assert.equal((await read('release.json')).metrics.test_count,15);good('rollback');good('cleanup');
  const manifest=await read('run.json');assert.equal(manifest.status,'cleaned');assert.equal(manifest.model_deleted,true);assert.equal(manifest.deleted_files.length,2);
  assert.equal(run('promote').status,1,'deleted model was promoted again');
 }finally{await rm(dir,{recursive:true,force:true});}
});

// Synthetic transport for the command-line integration test. All network calls
// are intercepted; an unexpected URL fails instead of reaching a real service.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const dir=process.env.LEARNING_TEST_DIR,model='ft:gpt-4.1-mini-2025-04-14:test:feedback:run';
const load=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const json=value=>new Response(JSON.stringify(value));
globalThis.fetch=async(url,init={})=>{
 const u=String(url),calls=await load('calls.json');calls.push({url:u,method:init.method||'GET'});await writeFile(join(dir,'calls.json'),JSON.stringify(calls));
 if(u.startsWith('https://api.supabase.com/v1/projects/')){
  const sql=JSON.parse(init.body).query;
  if(sql.includes(' as state;'))return json([{state:await load('state.json')}]);
  if(sql.includes('promote_feedback_model')){assert.ok(sql.includes('"candidate_mean":4'));return json([{release_id:'00000000-0000-0000-0000-000000009999'}]);}
  if(sql.includes('rollback_feedback_model'))return json([{}]);
  if(sql.includes('count(*)::int'))return json([{count:0}]);
  throw Error('Unexpected synthetic SQL operation');
 }
 if(u==='https://api.openai.com/v1/files'){
  assert.equal(init.body.get('purpose'),'fine-tune');
  const text=await init.body.get('file').text(),lines=text.trim().split('\n').map(JSON.parse);
  assert.equal(lines.length,60);assert.ok(!text.includes('source_id'));assert.ok(lines.every(x=>x.messages[0].role==='system'&&x.messages[2].role==='assistant'));
  return json({id:'file-synthetic-training'});
 }
 if(u==='https://api.openai.com/v1/fine_tuning/jobs'){
  const body=JSON.parse(init.body);assert.equal(body.model,'gpt-4.1-mini-2025-04-14');assert.equal(body.training_file,'file-synthetic-training');assert.equal(body.method.supervised.hyperparameters.n_epochs,3);assert.equal(body.validation_file,undefined);
  return json({id:'ftjob-synthetic',status:'queued'});
 }
 if(u==='https://api.openai.com/v1/fine_tuning/jobs/ftjob-synthetic')return json({status:'succeeded',training_file:'file-synthetic-training',model:'gpt-4.1-mini-2025-04-14',fine_tuned_model:model,result_files:['file-synthetic-results']});
 if(u==='https://api.openai.com/v1/responses'){
  const body=JSON.parse(init.body);assert.equal(body.store,false);assert.equal(body.text.format.name,'feedback_interpretation');assert.ok(body.input.startsWith('Interpret this note in context:\n'));assert.ok(body.instructions.includes('Do not calculate scores'));
  return json({output_text:JSON.stringify({summary:body.model===model?'Supported ownership with accurate scope.':'Ownership noted.',clarification_question:null})});
 }
 if(init.method==='DELETE'&&(u.includes('/v1/files/file-synthetic-')||u.includes('/v1/models/ft%3A')))return json({deleted:true});
 throw Error('Unexpected network call in synthetic learning test');
};

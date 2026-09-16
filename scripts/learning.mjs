#!/usr/bin/env node
// Operator workflow. Private files stay under an ignored directory; no raw data
// or provider errors are printed. Nothing uploads or trains without `train`.
import {readFile,writeFile,mkdir,chmod} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {trainingBase,uuid,tunedModel,hash,requireThat,buildDataset,verifyBundle,currentSources,trainingJSONL,evaluationMetrics} from './learning-lib.mjs';
import {feedbackRequest,feedbackTaskVersion} from '../supabase/functions/_shared/feedback-task.mjs';
const {positionals,values:args}=parseArgs({allowPositionals:true,options:{workspace:{type:'string'},dir:{type:'string'},record:{type:'string'},disable:{type:'boolean'}}});
const command=positionals[0]||'help',dir=resolve(args.dir||'.learning'),workspace=args.workspace;
const read=name=>readFile(resolve(dir,name),'utf8').then(JSON.parse);
async function save(name,data){await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);await writeFile(resolve(dir,name),JSON.stringify(data,null,2)+'\n',{mode:0o600});await chmod(resolve(dir,name),0o600);}
async function exists(name){try{await readFile(resolve(dir,name));return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
async function query(sql){
 const token=process.env.SUPABASE_ACCESS_TOKEN,ref=process.env.SUPABASE_PROJECT_REF;
 requireThat(token&&/^[a-z0-9]{20}$/.test(ref||''),'Set SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF.');
 const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:'set standard_conforming_strings=on; '+sql}),signal:AbortSignal.timeout(30000)});
 requireThat(response.ok,`Database operation failed (HTTP ${response.status}); no source data was logged.`);return response.json();
}
async function state(){
 requireThat(uuid.test(workspace||''),'Supply --workspace UUID.');
 const rows=await query(`select jsonb_build_object('workspace_id',${literal(workspace)},'permission',(select to_jsonb(p) from public.learning_permissions p where workspace_id=${literal(workspace)}::uuid),'active',(select to_jsonb(r) from public.learning_model_releases r where workspace_id=${literal(workspace)}::uuid and active and not invalidated),'examples',coalesce((select jsonb_agg(e order by e.id) from public.learning_examples e where workspace_id=${literal(workspace)}::uuid),'[]'::jsonb)) as state;`);
 requireThat(rows.length===1&&rows[0].state,'Could not read learning state.');return rows[0].state;
}
async function api(path,options={}){
 requireThat(process.env.OPENAI_API_KEY,'Set OPENAI_API_KEY for this explicit training/evaluation operation.');
 const response=await fetch('https://api.openai.com/v1/'+path,{...options,headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,...options.headers},signal:AbortSignal.timeout(30000)});
 requireThat(response.ok,`Model provider operation failed (HTTP ${response.status}). Inspect the run status before retrying.`);return response.json();
}
const post=(path,body)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function checkedBundle(){const bundle=verifyBundle(await read('dataset.json'));currentSources(bundle,await state());return bundle;}
async function checkedRun(bundle){
 const run=await read('run.json');requireThat(!run.model_deleted&&run.status!=='cleaned','This training run was cleaned up.');requireThat(run.dataset_hash===bundle.dataset_hash&&run.workspace_id===workspace,'Run and dataset do not match.');
 requireThat(/^ftjob-[a-zA-Z0-9_-]+$/.test(run.job_id||''),'No confirmed training job. If creation was interrupted, reconcile it using the provider dashboard.');
 const job=await api('fine_tuning/jobs/'+run.job_id);
 requireThat(job.training_file===run.training_file&&job.model===trainingBase,'Training job differs from the recorded run.');
 requireThat(job.status==='succeeded'&&tunedModel.test(job.fine_tuned_model),'Training has not succeeded.');
 requireThat(run.candidate_model===job.fine_tuned_model,'Run model differs from the completed training job.');return run;
}
async function main(){
 if(command==='help'){
  console.log(`Feedback learning: node scripts/learning.mjs COMMAND --workspace UUID [--dir .learning/WORKSPACE]
Commands:
  status       Show counts, permission and active model (no private text).
  authorize    Workspace owner records permission; --record TEXT [--disable].
  export       Export private review candidates and a curation template.
  build        Validate curated.json and hold out complete jobs in dataset.json.
  train        Explicit paid upload/training operation; creates run.json once.
  poll         Refresh the recorded training job status.
  evaluate     Explicit paid comparison on held-out jobs; writes ratings.json.
  promote      Validate human ratings and activate the evaluated workspace model.
  rollback     Return this workspace to the base model.
  cleanup      Cancel an unfinished run and delete its inactive model and files.
See docs/learning-foundation.md for review requirements and credentials.`);return;
 }
 if(command==='authorize'){
  requireThat(uuid.test(workspace||'')&&args.record?.trim().length>=10,'Supply workspace and an authorization/withdrawal record of at least 10 characters.');
  const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_USER_TOKEN,key=process.env.SUPABASE_ANON_KEY;
  requireThat(/^[a-z0-9]{20}$/.test(ref||'')&&token&&key,'Use the workspace owner session: SUPABASE_USER_TOKEN, SUPABASE_ANON_KEY and SUPABASE_PROJECT_REF.');
  const response=await fetch(`https://${ref}.supabase.co/rest/v1/rpc/set_learning_permission`,{method:'POST',headers:{Authorization:'Bearer '+token,apikey:key,'Content-Type':'application/json'},body:JSON.stringify({p_workspace:workspace,p_enabled:!args.disable,p_record:args.record}),signal:AbortSignal.timeout(15000)});
  requireThat(response.ok,`Owner authorization failed (HTTP ${response.status}).`);console.log(args.disable?'Training permission withdrawn; deployed workspace model deactivated. Run cleanup for prior training runs.':'Workspace training permission recorded.');return;
 }
 if(command==='status'||command==='export'){
  const current=await state();
  if(command==='status'){console.log(JSON.stringify({captured:current.examples.length,accepted:current.examples.filter(x=>x.review_kind==='accepted').length,corrected:current.examples.filter(x=>x.review_kind==='corrected').length,jobs:new Set(current.examples.map(x=>x.job_id)).size,training_authorized:current.permission?.enabled===true,active_model:current.active?.model||trainingBase},null,2));return;}
  requireThat(current.permission?.enabled===true,'Owner training authorization is required before export.');
  await save('export.json',current);
  if(!await exists('curated.json'))await save('curated.json',current.examples.map(x=>({source_id:x.id,revision:x.revision,input:{job:{title:''},feedback:{text:'',type:'General note',outcome:'Neutral / no signal'},evaluation_context:{}},target:{summary:'',clarification_question:null},reviewer:'',authorized:false,deidentified:false,faithful_to_review:false})));
  console.log('Private export saved. Fill curated.json using the original evidence and reviewed text; remove unready examples.');return;
 }
 if(command==='build'){
  requireThat(!await exists('run.json'),'This directory already holds a training run. Use a new directory for a new dataset.');
  const dataset=buildDataset(await state(),await read('curated.json'));await save('dataset.json',dataset);
  console.log(`Dataset ready: ${dataset.examples.filter(x=>x.split==='train').length} training, ${dataset.examples.filter(x=>x.split==='test').length} held out. No data uploaded.`);return;
 }
 if(command==='rollback'){
  requireThat(uuid.test(workspace||''),'Supply --workspace UUID.');await query(`select public.rollback_feedback_model(${literal(workspace)}::uuid);`);console.log('Workspace returned to the base model.');return;
 }
 if(command==='train'){
  requireThat(!await exists('run.json'),'A run already exists. Poll or reconcile it; never blindly retry job creation.');
  const bundle=await checkedBundle(),current=await state(),jsonl=trainingJSONL(bundle);
  requireThat(Buffer.byteLength(jsonl)<=10_000_000,'Training file exceeds the 10 MB pilot budget.');
  const run={workspace_id:workspace,dataset_hash:bundle.dataset_hash,baseline_model:current.active?.model||trainingBase,expected_release:current.active?.id||null,created_at:new Date().toISOString(),status:'upload_pending'};
  await save('run.json',run);
  const form=new FormData();form.set('purpose','fine-tune');form.set('file',new Blob([jsonl],{type:'application/jsonl'}),'feedback-training.jsonl');
  const file=await api('files',{method:'POST',body:form});requireThat(/^file-[a-zA-Z0-9_-]+$/.test(file.id||''),'Unexpected uploaded file identity.');
  run.training_file=file.id;run.status='creation_pending';await save('run.json',run);
  // Recheck authorization and source revisions immediately before starting a job.
  currentSources(bundle,await state());
  const job=await post('fine_tuning/jobs',{model:trainingBase,training_file:file.id,suffix:'feedback-'+bundle.dataset_hash.slice(0,8),seed:42,method:{type:'supervised',supervised:{hyperparameters:{n_epochs:3}}}});
  requireThat(/^ftjob-[a-zA-Z0-9_-]+$/.test(job.id||''),'Unexpected training job identity.');
  run.job_id=job.id;run.status=job.status;await save('run.json',run);console.log('Training job created. Use poll to check progress.');return;
 }
 if(command==='poll'){
  const run=await read('run.json');requireThat(run.workspace_id===workspace&&/^ftjob-[a-zA-Z0-9_-]+$/.test(run.job_id||''),'Supply the correct workspace and a confirmed run.');
  const job=await api('fine_tuning/jobs/'+run.job_id);requireThat(job.training_file===run.training_file&&job.model===trainingBase,'Training job identity mismatch.');
  run.status=job.status;run.candidate_model=job.fine_tuned_model||null;run.result_files=job.result_files||[];await save('run.json',run);console.log('Training status: '+run.status);return;
 }
 if(command==='evaluate'){
  const bundle=await checkedBundle(),run=await checkedRun(bundle),current=await state();
  requireThat((current.active?.id||null)===run.expected_release,'Active model changed; start a comparison against the current baseline.');
  const evaluation=await exists('evaluation.json')?await read('evaluation.json'):{dataset_hash:bundle.dataset_hash,task_version:feedbackTaskVersion,baseline_model:run.baseline_model,candidate_model:run.candidate_model,results:[]};
  requireThat(evaluation.dataset_hash===bundle.dataset_hash&&evaluation.candidate_model===run.candidate_model&&evaluation.baseline_model===run.baseline_model,'Existing evaluation belongs to another run.');
  for(const item of bundle.examples.filter(x=>x.split==='test')){
   if(evaluation.results.some(x=>x.source_id===item.source_id))continue;
   const result={source_id:item.source_id};
   for(const [key,model] of [['baseline',run.baseline_model],['candidate',run.candidate_model]]){
    const response=await post('responses',feedbackRequest(model,item.input));
    const text=response.output_text||response.output?.flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
    try{result[key]=JSON.parse(text);}catch{result[key]=null;}
   }
   evaluation.results.push(result);await save('evaluation.json',evaluation);
  }
  if(!await exists('ratings.json'))await save('ratings.json',evaluation.results.map(x=>({source_id:x.source_id,output_hash:hash(x),reviewer:'',baseline_quality:null,candidate_quality:null,unsupported_claims:null,scope_safe:null})));
  console.log('Held-out comparison saved. Review inputs, curated targets and both outputs; complete ratings.json.');return;
 }
 if(command==='promote'){
  const bundle=await checkedBundle(),run=await checkedRun(bundle),evaluation=await read('evaluation.json'),ratings=await read('ratings.json');
  requireThat(evaluation.baseline_model===run.baseline_model&&evaluation.candidate_model===run.candidate_model,'Evaluation models do not match the completed run.');
  const metrics=evaluationMetrics(bundle,evaluation,ratings),releaseHash=hash({dataset:bundle.dataset_hash,run,evaluation,ratings});
  const ids=bundle.examples.map(x=>x.source_id);requireThat(ids.every(x=>uuid.test(x)),'Invalid source identity.');
  requireThat(run.expected_release===null||uuid.test(run.expected_release),'Invalid expected release identity.');
  const rows=await query(`select public.promote_feedback_model(${literal(workspace)}::uuid,${literal(run.candidate_model)},${literal(run.baseline_model)},array[${ids.map(literal).join(',')}]::uuid[],${literal(JSON.stringify(metrics))}::jsonb,${literal(releaseHash)},${run.expected_release?literal(run.expected_release)+'::uuid':'null'}) as release_id;`);
  await save('release.json',{release_id:rows[0].release_id,run_hash:releaseHash,metrics,model:run.candidate_model});console.log('Evaluated feedback model activated for this workspace.');return;
 }
 if(command==='cleanup'){
  const run=await read('run.json');requireThat(run.workspace_id===workspace&&uuid.test(workspace||''),'Wrong workspace for cleanup.');
  // Keep the manifest after cleanup as an audit trail. Never remove active models.
  if(run.job_id){
   requireThat(/^ftjob-[a-zA-Z0-9_-]+$/.test(run.job_id),'Invalid training job.');
   const job=await api('fine_tuning/jobs/'+run.job_id);
   requireThat(job.training_file===run.training_file,'Training job file mismatch.');
   run.candidate_model=job.fine_tuned_model||null;run.result_files=job.result_files||[];
   if(!['succeeded','failed','cancelled'].includes(job.status)){await post('fine_tuning/jobs/'+run.job_id+'/cancel',{});await save('run.json',run);throw Error('Cancellation requested. Run cleanup again once cancellation finishes.');}
  }else requireThat(run.status==='upload_pending'||run.status==='cleaned','Job creation may have succeeded without a response. Reconcile its ID before cleanup.');
  if(run.candidate_model&&!run.model_deleted){
   requireThat(tunedModel.test(run.candidate_model),'Invalid fine-tuned model identity.');
   const rows=await query(`select count(*)::int as count from public.learning_model_releases where active and model=${literal(run.candidate_model)};`);
   requireThat(rows[0].count===0,'Rollback the active model before cleanup.');
   await api('models/'+encodeURIComponent(run.candidate_model),{method:'DELETE'});run.model_deleted=true;await save('run.json',run);
  }
  for(const id of [run.training_file,...(run.result_files||[])].filter(Boolean)){
   requireThat(/^file-[a-zA-Z0-9_-]+$/.test(id),'Invalid training file identity.');
   if((run.deleted_files||[]).includes(id))continue;
   await api('files/'+id,{method:'DELETE'});run.deleted_files=[...(run.deleted_files||[]),id];await save('run.json',run);
  }
  run.status='cleaned';await save('run.json',run);console.log('Recorded inactive model and training files removed. Securely remove private exports according to the retention agreement.');return;
 }
 throw Error('Unknown command. Use help.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});

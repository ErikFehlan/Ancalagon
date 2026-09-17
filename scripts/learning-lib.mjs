import {createHash} from 'node:crypto';
import {feedbackInstructions,feedbackInput,feedbackTaskVersion,feedbackBaseModel,validFeedback} from '../supabase/functions/_shared/feedback-task.mjs';
export const trainingBase=feedbackBaseModel;
export const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const tunedModel=/^ft:gpt-4\.1-mini-2025-04-14:[a-zA-Z0-9:_-]+$/;
export function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
export const hash=value=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
export function requireThat(condition,message){if(!condition)throw Error(message);}
// Availability is account-specific; this is an operator record, not an API
// eligibility check. Refuse to upload until availability has been verified.
export function trainingEligibility(record,now=Date.now()){
 requireThat(now<Date.parse('2027-01-06T00:00:00Z'),'OpenAI self-serve fine-tuning no longer supports new jobs. Choose a supported training provider before uploading.');
 requireThat(typeof record==='string'&&record.trim().length>=10&&record.trim().length<=2000,'Verify OpenAI fine-tuning eligibility for this organization/project and supply --eligibility-record before any upload. See docs/learning-foundation.md.');
 return {provider:'openai',record:record.trim(),recorded_at:new Date(now).toISOString()};
}
export function currentSources(bundle,state){
 requireThat(state.permission?.enabled===true,'Workspace training permission is not enabled.');
 requireThat(state.workspace_id===bundle.workspace_id,'Workspace mismatch.');
 const current=new Map(state.examples.map(x=>[x.id,x.revision]));
 for(const item of bundle.examples)requireThat(current.get(item.source_id)===item.revision,'A reviewed source changed or was deleted; rebuild the dataset.');
}
export function buildDataset(state,curated){
 requireThat(uuid.test(state.workspace_id),'Invalid workspace.');
 requireThat(state.permission?.enabled===true,'Workspace training permission is not enabled.');
 requireThat(Array.isArray(curated)&&curated.length>=60&&curated.length<=1000,'Provide 60–1,000 curated examples (at least 50 training and 10 held out).');
 const sources=new Map(state.examples.map(x=>[x.id,x])),ids=new Set(),inputs=new Set();
 const examples=curated.map(row=>{
  const source=sources.get(row.source_id);
  requireThat(source&&source.workspace_id===state.workspace_id&&source.revision===row.revision,'Missing, stale or cross-workspace source.');
  requireThat(source.task_version===feedbackTaskVersion&&['accepted','corrected'].includes(source.review_kind),'Source has no supported human review.');
  requireThat(!ids.has(source.id),'Duplicate source.');ids.add(source.id);
  requireThat(row.authorized===true&&row.deidentified===true&&row.faithful_to_review===true&&typeof row.reviewer==='string'&&row.reviewer.trim().length>=3,'Each example needs an identified curator and explicit authorization, de-identification and fidelity attestations.');
  requireThat(row.input?.job?.title?.trim()&&row.input?.feedback?.text?.trim(),'A cleaned job title and note are required.');
  const input=feedbackInput(row.input),target=row.target;
  requireThat(validFeedback(target),'Target must be a strict summary and optional clarification question.');
  const text=canonical({input,target});
  requireThat(text.length<=24000,'Reduce each example to the necessary context (24,000 characters maximum).');
  // A backstop, not an anonymizer. Human review must remove names, organizations,
  // contact details, protected traits and identifying combinations from context.
  requireThat(!/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|https?:\/\/|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|(?:\+?\d[\s().-]*){10,}/i.test(text),'Possible identifiers remain in a training example.');
  const key=hash(input);requireThat(!inputs.has(key),'Duplicate input could leak between training and evaluation.');inputs.add(key);
  return {source_id:source.id,revision:source.revision,job_id:source.job_id,candidate_id:source.candidate_id,input,target,reviewer:row.reviewer.trim()};
 });
 const jobs=[...new Set(examples.map(x=>x.job_id))].sort((a,b)=>hash(a).localeCompare(hash(b)));
 requireThat(jobs.length>=3,'Use at least three distinct jobs; evaluation holds out complete jobs.');
 const testJobs=new Set(jobs.slice(0,Math.max(1,Math.ceil(jobs.length*.2))));
 examples.forEach(x=>{x.split=testJobs.has(x.job_id)?'test':'train';});
 const train=examples.filter(x=>x.split==='train'),test=examples.filter(x=>x.split==='test');
 requireThat(train.length>=50&&test.length>=10,'The job-level split needs at least 50 training and 10 held-out examples. Collect more reviewed jobs.');
 const bundle={version:feedbackTaskVersion,workspace_id:state.workspace_id,examples};
 return {...bundle,dataset_hash:hash(bundle)};
}
export function verifyBundle(bundle){
 const {dataset_hash,...data}=bundle;
 requireThat(data.version===feedbackTaskVersion&&hash(data)===dataset_hash,'Dataset changed; rebuild before continuing.');
 requireThat(data.examples.filter(x=>x.split==='train').length>=50&&data.examples.filter(x=>x.split==='test').length>=10,'Insufficient dataset.');
 const trainJobs=new Set(data.examples.filter(x=>x.split==='train').map(x=>x.job_id));
 requireThat(!data.examples.some(x=>x.split==='test'&&trainJobs.has(x.job_id)),'A held-out job leaked into training.');
 return bundle;
}
export function trainingJSONL(bundle){
 verifyBundle(bundle);
 return bundle.examples.filter(x=>x.split==='train').map(x=>JSON.stringify({messages:[
  {role:'system',content:feedbackInstructions},{role:'user',content:'Interpret this note in context:\n'+JSON.stringify(feedbackInput(x.input))},
  {role:'assistant',content:JSON.stringify(x.target)},
 ]})).join('\n')+'\n';
}
export function evaluationMetrics(bundle,evaluation,ratings){
 verifyBundle(bundle);
 requireThat(evaluation.dataset_hash===bundle.dataset_hash&&evaluation.task_version===feedbackTaskVersion,'Evaluation belongs to a different dataset or task.');
 requireThat(tunedModel.test(evaluation.candidate_model)&&evaluation.candidate_model!==evaluation.baseline_model,'Evaluate a distinct fine-tuned candidate.');
 const cases=bundle.examples.filter(x=>x.split==='test');
 requireThat(evaluation.results.length===cases.length&&ratings.length===cases.length,'Rate every held-out case.');
 requireThat(new Set(evaluation.results.map(x=>x.source_id)).size===cases.length&&new Set(ratings.map(x=>x.source_id)).size===cases.length,'Duplicate evaluation or rating.');
 let baseline=0,candidate=0,claims=0,scope=true,schema=true;
 for(const item of cases){
  const result=evaluation.results.find(x=>x.source_id===item.source_id),rating=ratings.find(x=>x.source_id===item.source_id);
  requireThat(result&&rating&&rating.output_hash===hash(result)&&typeof rating.reviewer==='string'&&rating.reviewer.trim().length>=3,'Ratings must identify the reviewer and bind to the exact evaluated outputs.');
  for(const key of ['baseline_quality','candidate_quality'])requireThat(Number.isInteger(rating[key])&&rating[key]>=1&&rating[key]<=5,'Quality ratings must be integers from 1 to 5.');
  requireThat(typeof rating.unsupported_claims==='boolean'&&typeof rating.scope_safe==='boolean','Explicit factuality and scope review is required.');
  baseline+=rating.baseline_quality;candidate+=rating.candidate_quality;claims+=Number(rating.unsupported_claims);scope&&=rating.scope_safe;
  schema&&=!!validFeedback(result.candidate)&&!!validFeedback(result.baseline);
 }
 const metrics={human_reviewed:true,train_count:bundle.examples.length-cases.length,test_count:cases.length,baseline_mean:baseline/cases.length,candidate_mean:candidate/cases.length,unsupported_claims:claims,all_schema_valid:schema,all_scope_safe:scope};
 requireThat(schema&&scope&&claims===0&&metrics.candidate_mean>=4&&candidate-baseline>=cases.length*.1-1e-9,'Candidate did not pass the quality, improvement, factuality and scope gates.');
 return metrics;
}

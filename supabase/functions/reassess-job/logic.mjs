import '../../../assets/context.js';
const contextAPI=globalThis.AncalagonContext;
export function prepare(input){
  if(!input?.job?.id||!input?.candidate?.id||input.candidate.jobId!==input.job.id)throw Error('invalid_scope');
  const {job,candidate}=input;
  const feedback=(input.feedback||[]).filter(f=>f.jobId===job.id&&(f.candidateId===candidate.id||(f.learningScope==='job'&&f.signalStatus==='approved')));
  const outcomes=(input.outcomes||[]).filter(o=>o.jobId===job.id&&o.candidateId===candidate.id);
  const context=contextAPI.build(job,candidate,feedback,outcomes);
  const payload={job:{title:job.title},candidate:{current_manager_score:Number(candidate.managerScore),current_jd_score:Number(candidate.jdScore)},evaluation_context:context};
  if(JSON.stringify(payload).length>180000)throw Error('input_too_large');
  return {payload,contextSignature:contextAPI.signature(context),sourceIds:new Set(context.sources.map(s=>s.id))};
}
export function validate(result,prepared){
  if(!result||!['jd_score','manager_score'].every(k=>typeof result[k]==='number'&&Number.isFinite(result[k])&&result[k]>=0&&result[k]<=10)
    ||!['low','medium','high'].includes(result.confidence)
    ||!['summary','manager_reason','jd_reason'].every(k=>typeof result[k]==='string'&&result[k].trim()&&result[k].length<=4000)
    ||!Array.isArray(result.evidence_ids)||!result.evidence_ids.length||result.evidence_ids.some(id=>typeof id!=='string'||!prepared.sourceIds.has(id))
    ||!Array.isArray(result.questions)||result.questions.length>3||result.questions.some(q=>typeof q!=='string'||q.length>600))throw Error('invalid_result');
  return {...result,manager_score:Math.round(result.manager_score*10)/10,jd_score:Math.round(result.jd_score*10)/10,context_signature:prepared.contextSignature};
}
export const schema={type:'object',additionalProperties:false,required:['jd_score','manager_score','confidence','summary','manager_reason','jd_reason','evidence_ids','questions'],properties:{
  jd_score:{type:'number',minimum:0,maximum:10},manager_score:{type:'number',minimum:0,maximum:10},confidence:{type:'string',enum:['low','medium','high']},
  summary:{type:'string'},manager_reason:{type:'string'},jd_reason:{type:'string'},evidence_ids:{type:'array',items:{type:'string'}},questions:{type:'array',items:{type:'string'},maxItems:3}
}};

import '../../../assets/context.js';
export function prepareIntake(input){
  if(!input?.job?.id||!input?.candidate?.id||input.candidate.jobId!==input.job.id)throw Error('invalid_scope');
  if(typeof input.resume_text!=='string'||input.resume_text.trim().length<40||input.resume_text.length>120000)throw Error('invalid_resume');
  const c={...input.candidate,role:'',signal:'',tags:[],strengths:[],concerns:[],resumeJDScore:0,resumeIntake:null,aiReview:null};
  const context=globalThis.AncalagonContext.build(input.job,c,input.feedback||[],input.outcomes||[]);
  const payload={analysis_type:'resume',auto_intake:true,file_name:input.file_name,resume_text:input.resume_text,
    job:{title:input.job.title,description:input.job.description,criteria:input.job.criteria,manager_calibration:input.job.managerFeedback,knockout_rules:input.job.knockouts},evaluation_context:context};
  if(JSON.stringify(payload).length>180000)throw Error('input_too_large');
  return {payload,signature:globalThis.AncalagonContext.signature(context)};
}

export async function processIntakes(tasks,{rpc,analyze}){
  return Promise.all(tasks.map(async task=>{
    try{
      const prepared=prepareIntake(task.input);
      const response=await analyze(new Request('https://internal.invalid/resume-intake',{method:'POST',body:JSON.stringify(prepared.payload)}));
      if(!response.ok){
        const failure=await response.json().catch(()=>({}));
        const issue=['invalid_score','invalid_profile','invalid_concerns','invalid_questions','invalid_tags','invalid_evidence','unmatched_quote','unsupported_score','incomplete_output','invalid_json'].includes(failure?.validation_issue)?failure.validation_issue:null;
        throw Error(response.status===429?'ai_rate_limit':response.status===502?(issue?'verification_'+issue:'verification_failed'):'ai_unavailable');
      }
      const result=await response.json();
      const accepted=await rpc('finish_resume_intake',{p_candidate:task.candidate_id,p_revision:task.revision,p_lease:task.lease_id,
        p_result:{...result,context_signature:prepared.signature},p_error:null});
      return accepted?'ready':'superseded';
    }catch(error){
      const message=error instanceof Error?error.message:'';
      const code=['invalid_scope','invalid_resume','input_too_large','ai_rate_limit','verification_failed','ai_unavailable'].includes(message)||/^verification_(invalid_score|invalid_profile|invalid_concerns|invalid_questions|invalid_tags|invalid_evidence|unmatched_quote|unsupported_score|incomplete_output|invalid_json)$/.test(message)?message:'processing_failed';
      try{await rpc('finish_resume_intake',{p_candidate:task.candidate_id,p_revision:task.revision,p_lease:task.lease_id,p_result:null,p_error:code});}catch{/* The lease expires and the scheduler retries. */}
      return 'retry_or_attention';
    }
  }));
}

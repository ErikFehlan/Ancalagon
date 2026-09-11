(function(global){
  'use strict';
  function buildPayload(note,job,candidate,context){
    if(note.jobId!==job.id||candidate.jobId!==job.id||note.candidateId!==candidate.id)throw Error('Feedback must belong to this candidate and job');
    return JSON.parse(JSON.stringify({analysis_type:'screening',candidate_ref:candidate.id,
      evaluation_context:{...context,feedback_interpretation_task:'Expand the recruiter note into a concise, useful interpretation in summary (at most 3 sentences). Preserve its meaning. Use job context to explain relevance; distinguish observed facts from tentative interpretations. Do not invent candidate experience or examples, infer protected traits, or turn one observation into a hiring rule. If ambiguity materially changes the meaning, ask one focused question. Do not prescribe score changes.',original_note:note.text},
      job:{title:job.title,description:job.description||'',criteria:job.criteria||[],manager_calibration:job.managerFeedback||'',knockout_rules:job.knockouts||[]},
      candidate:{role:candidate.role,resume_jd_score:candidate.resumeJDScore,current_jd_score:candidate.jdScore,current_manager_score:candidate.managerScore,primary_signal:candidate.signal,strengths:candidate.strengths||[],concerns:candidate.concerns||[],tags:candidate.tags||[]},
      screening:{can_do_job:'Unknown',culture_working_style_fit:'Unknown',notes:note.text}}));
  }
  function fromResult(result){
    if(typeof result?.summary!=='string'||!result.summary.trim())throw Error('No interpretation returned');
    return {text:result.summary.trim().slice(0,2000),source:'ai',model:result.model||null,updatedAt:Date.now()};
  }
  const api={buildPayload,fromResult};if(typeof module!=='undefined')module.exports=api;global.AncalagonFeedback=api;
})(typeof window!=='undefined'?window:globalThis);

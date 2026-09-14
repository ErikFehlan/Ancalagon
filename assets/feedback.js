(function(global){
  'use strict';
  function buildPayload(note,job,candidate,context){
    if(note.jobId!==job.id||candidate.jobId!==job.id||note.candidateId!==candidate.id)throw Error('Feedback must belong to this candidate and job');
    return JSON.parse(JSON.stringify({analysis_type:'feedback',candidate_ref:candidate.id,
      job:{title:job.title},evaluation_context:context,
      feedback:{text:note.text,type:note.type||'General note',outcome:note.outcome||'Neutral / no signal'}
    }));
  }
  function fromResult(result){
    if(typeof result?.summary!=='string'||!result.summary.trim())throw Error('No interpretation returned');
    const question=typeof result.clarification_question==='string'?result.clarification_question.trim():'';
    return {text:(result.summary.trim()+(question?'\n\n'+question:'')).slice(0,2000),source:'ai',model:result.model||null,updatedAt:Date.now()};
  }
  const api={buildPayload,fromResult};if(typeof module!=='undefined')module.exports=api;global.AncalagonFeedback=api;
})(typeof window!=='undefined'?window:globalThis);

(function(global){
  'use strict';
  function buildPayload(note,job,candidate,context){
    if(note.jobId!==job.id||candidate.jobId!==job.id||note.candidateId!==candidate.id)throw Error('Feedback must belong to this candidate and job');
    return JSON.parse(JSON.stringify({analysis_type:'feedback',candidate_ref:candidate.id,
      job:{title:job.title},evaluation_context:context,
      feedback:{text:note.text,type:note.type||'General note',outcome:note.outcome||'Neutral / no signal'}
    }));
  }
  function fromResult(result,request=null){
    if(typeof result?.summary!=='string'||!result.summary.trim())throw Error('No interpretation returned');
    const question=typeof result.clarification_question==='string'?result.clarification_question.trim():'';
    const interpretation={text:(result.summary.trim()+(question?'\n\n'+question:'')).slice(0,2000),source:'ai',model:result.model||null,updatedAt:Date.now()};
    // A future review needs the original input and output, not today's edited job.
    // These private snapshots are only training candidates; review is not consent.
    if(request?.analysis_type==='feedback'&&JSON.stringify(request).length<=160000){
      interpretation.learning={version:'feedback-v1',input:JSON.parse(JSON.stringify(request)),
        output:{summary:result.summary.trim(),clarification_question:question||null}};
    }
    return interpretation;
  }
  function review(interpretation,correction=null,now=Date.now()){
    if(!interpretation?.text)throw Error('Wait for an interpretation before reviewing it.');
    if(correction===null)return {...interpretation,reviewStatus:'accepted',reviewedAt:now};
    const text=String(correction).trim();if(!text||text.length>2000)throw Error('Enter a clarification of up to 2,000 characters.');
    return {...interpretation,text,source:'recruiter',updatedAt:now,reviewStatus:'corrected',reviewedAt:now};
  }
  const api={buildPayload,fromResult,review};if(typeof module!=='undefined')module.exports=api;global.AncalagonFeedback=api;
})(typeof window!=='undefined'?window:globalThis);

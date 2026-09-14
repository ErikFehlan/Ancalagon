(function(global){
  'use strict';
  // Candidate-scoped, replaceable work. Persist the queue before calling AI so
  // interrupted work can resume when this workspace is opened again.
  function create(api,{delay=650,concurrency=2}={}){
    const tasks=new Map();let timer=null,running=0;
    const valid=c=>api.valid(c);
    function changed(c){api.changed(c);}
    function schedule(){if(timer!==null)return;timer=setTimeout(()=>{timer=null;pump();},delay);}
    function request(candidate){
      if(!valid(candidate))return;
      if(api.delegate?.(candidate))return;
      tasks.get(candidate.id)?.controller.abort();
      candidate.feedbackEvaluation={status:'queued',updatedAt:Date.now()};
      tasks.set(candidate.id,{candidate,controller:new AbortController(),started:false,saving:false});
      changed(candidate);schedule();
    }
    function pump(){
      for(const token of tasks.values()){
        if(token.started)continue;
        if(!valid(token.candidate)){tasks.delete(token.candidate.id);continue;}
        if(running>=concurrency||api.busy(token.candidate))continue;
        token.started=true;running++;void run(token);
      }
      if([...tasks.values()].some(t=>!t.started))schedule();
    }
    async function run(token){
      const c=token.candidate,current=()=>tasks.get(c.id)===token&&valid(c);
      try{
        c.feedbackEvaluation.status='running';changed(c);
        await api.persist();
        if(!current())return;
        const signature=api.signature(c),score=Number(c.managerScore);
        const proposal=await api.analyze(c,token.controller.signal);
        if(!current())return;
        if(api.signature(c)!==signature||Number(c.managerScore)!==score){
          request(c);return;
        }
        c.feedbackEvaluation={status:'pending',proposal,updatedAt:Date.now()};
        token.saving=true;changed(c);
        await api.persist();
      }catch(error){
        if(!current())return;
        if(error.code==='EVIDENCE_CHANGED'){request(c);return;}
        c.feedbackEvaluation={status:'error',error:error.message||'Assessment unavailable.',updatedAt:Date.now()};
        changed(c);
      }finally{
        if(tasks.get(c.id)===token){tasks.delete(c.id);if(valid(c))changed(c);}
        running--;if([...tasks.values()].some(t=>!t.started))schedule();
      }
    }
    function resume(candidates){
      for(const c of candidates)if(['queued','running'].includes(c.feedbackEvaluation?.status))request(c);
    }
    function canReview(candidate){
      const state=candidate.feedbackEvaluation,p=state?.proposal;
      return !tasks.has(candidate.id)&&valid(candidate)&&state?.status==='pending'&&p?.status==='pending'
        &&p.contextSignature===api.signature(candidate)&&Number(p.currentScore)===Number(candidate.managerScore);
    }
    function phase(candidate){const t=tasks.get(candidate.id);return t?.saving?'saving':candidate.feedbackEvaluation?.status||'idle';}
    function dispose(){if(timer!==null)clearTimeout(timer);timer=null;for(const t of tasks.values())t.controller.abort();tasks.clear();}
    return {request,resume,canReview,phase,dispose};
  }
  const api={create};if(typeof module!=='undefined')module.exports=api;global.AncalagonCandidateAutomation=api;
})(typeof window==='undefined'?globalThis:window);

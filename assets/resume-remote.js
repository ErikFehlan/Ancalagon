(function(global){
  'use strict';
  function create(api){
    let timer=null,polling=false,disposed=false;
    const requests=new Map(),errors=new Set();
    const valid=c=>api.valid(c)&&global.AncalagonIntake.pending(c);
    function plan(ms=2500){if(disposed)return;clearTimeout(timer);timer=setTimeout(()=>void poll(),ms);timer?.unref?.();}
    async function request(c,retry=false){
      if(!valid(c))return;
      if(requests.has(c.id))return requests.get(c.id);
      const operation=(async()=>{
        try{c.resumeIntake.backend='durable-v1';await api.persist();if(!valid(c))return;await api.requestRemote(c.id,retry);errors.delete(c.id);}
        catch(e){if(valid(c)){
          Object.assign(c.resumeIntake,{phase:'error',error:e.message||'Assessment could not start. Your resume is saved. Try again.',updatedAt:Date.now()});
          api.changed?.(c);try{await api.persist();}catch{}api.toast(c.resumeIntake.error,'error');
        }}
        finally{requests.delete(c.id);plan(300);}
      })();requests.set(c.id,operation);return operation;
    }
    async function poll(){
      if(disposed||polling)return;
      const candidates=api.candidates().filter(valid);
      if(!candidates.length)return;
      if(global.document?.hidden){plan(8000);return;}
      polling=true;let working=false;const changed=[];
      try{
        const batched=api.loadRemoteBatch?await api.loadRemoteBatch(candidates.map(c=>c.id)):null;
        const byId=batched?new Map(batched.map(t=>[t.candidate_id,t])):null;
        for(const c of candidates){
          if(requests.has(c.id)||!valid(c))continue;
          try{
            let task=byId?byId.get(c.id):await api.loadRemote(c.id);
            if(!valid(c)||!task)continue;
            if(task.candidate_id!==c.id||task.job_id!==c.jobId)throw Error('Assessment scope did not match the candidate.');
            // Another tab may already have reviewed it. Never overwrite that
            // decision with this tab's stale, unreviewed candidate snapshot.
            if(task.status==='approved'){
              if(!errors.has(c.id)){api.toast('This assessment was reviewed in another tab. Refresh to load the saved decision.');errors.add(c.id);}
              continue;
            }
            if(task.status==='cancelled')continue;
            const phase=task.status==='failed'?'error':task.status;
            working||=['queued','processing'].includes(phase);
            if(c.resumeIntake.remoteRevision===task.revision&&c.resumeIntake.phase===phase)continue;
            if(phase==='ready'){
              if(byId){
                task=await api.loadRemote(c.id);
                if(!task||task.candidate_id!==c.id||task.job_id!==c.jobId)throw Error('Assessment scope did not match the candidate.');
                if(task.status!=='ready'||!valid(c))continue;
              }
              // Comparing before and after the source read also protects edits
              // made while this network request was outstanding.
              const signature=api.signature(api.context(c));
              if(task.result?.context_signature!==signature)throw Error('Job evidence changed in another tab. Save your notes and refresh to load the latest assessment.');
              const text=await api.text(c);
              const result=global.AncalagonIntake.validate(task.result,text);
              if(!valid(c)||signature!==api.signature(api.context(c)))continue;
              Object.assign(c,{name:result.name==='Candidate'?c.name:result.name,short:result.name==='Candidate'?c.name:result.name,role:result.role,
                signal:result.primary_signal,strengths:result.resume_evidence.map(e=>e.claim+' — Resume: “'+e.quote+'”'),concerns:result.concerns,tags:result.tags,screeningQuestions:result.screening_questions});
              Object.assign(c.resumeIntake,{brief:result,signature,remoteRevision:task.revision,stored:true,phase:'ready',error:'',updatedAt:Date.now()});
            }else Object.assign(c.resumeIntake,{phase,remoteRevision:task.revision,error:phase==='error'?'The assessment could not finish after automatic retries. Your resume is saved. Try again.':'',updatedAt:Date.now()});
            changed.push(c);errors.delete(c.id);
          }catch(e){if(!errors.has(c.id)){api.toast(e.message||'Assessment updates are temporarily unavailable. Retrying automatically.','error');errors.add(c.id);}}
        }
        if(changed.length){await api.persist();if(api.changedMany)api.changedMany(changed);else changed.forEach(c=>api.changed(c));}
        errors.delete('poll');
      }catch(e){
        if(changed.length){if(api.changedMany)api.changedMany(changed);else changed.forEach(c=>api.changed(c));}
        if(!errors.has('poll')){api.toast(e.message||'Assessment updates are temporarily unavailable. Retrying automatically.','error');errors.add('poll');}
      }finally{polling=false;plan(working?2500:8000);}
    }
    function resume(){for(const c of api.candidates().filter(valid))void request(c);plan(300);}
    function dispose(){disposed=true;clearTimeout(timer);}
    return {request,poll,resume,dispose};
  }
  const api={create};if(typeof module!=='undefined')module.exports=api;global.AncalagonRemoteIntake=api;
})(typeof window==='undefined'?globalThis:window);

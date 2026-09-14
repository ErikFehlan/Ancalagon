(function(global){
  'use strict';
  let api,timer=null,busy=false,displayedJob=null;const cache=new Map(),reads=new Map();
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function matches(task,job){const input=task?.input;return (!task?.job_id||task.job_id===job.id)&&!!input&&input.title===job.title&&(input.description||'')===(job.description||'')&&JSON.stringify(input.criteria||[])===JSON.stringify(job.criteria||[])&&(input.manager_notes||'')===(job.managerFeedback||'')&&JSON.stringify(input.knockouts||[])===JSON.stringify(job.knockouts||[]);}
  function result(job){const task=cache.get(job?.id);return task?.status==='ready'&&!task.display_original&&matches(task,job)?task.result?.criteria||[]:[];}
  function label(raw,job){const item=result(job).find(x=>x.original.trim()===String(raw).trim());return item?.label||String(raw).replace(/^\s*[-•]+\s*/,'').trim();}
  function questions(job){return result(job).map(x=>x.question);}
  function render(job,problem){const wrap=api.root.querySelector('#criteriaAutomation');if(!wrap)return;displayedJob=job.id;const task=cache.get(job.id),current=matches(task,job),ready=current&&task.status==='ready';
    const status=problem||(!current?'Waiting for the saved job':task.status==='ready'?'Up to date':task.status==='failed'?'Needs attention':'Updating this job…');
    wrap.innerHTML=`<h3>Criteria and screening questions</h3><p role="status">${escape(status)}</p>${current&&task.status==='failed'?'<p>Your original criteria remain available. Processing stopped after retries; check Settings or contact your beta coordinator.</p>':''}${ready?`<p class="rf-sub">${task.display_original?'Showing original wording.':'Wording polished automatically. Original requirements and scoring rules are preserved.'}</p><ol>${(task.result?.criteria||[]).map(x=>`<li><strong>${escape(task.display_original?x.original:x.label)}</strong> <span class="rf-pill rf-gray">${escape(x.priority)}</span><p>${escape(x.question)}</p></li>`).join('')}</ol><button class="rf-btn" type="button" id="toggleCriteriaOriginal">${task.display_original?'Show polished wording':'Use original wording'}</button>`:''}<p class="rf-sub">Edit the original criteria in Jobs. Saving changed criteria automatically queues a fresh result.</p>`;
    wrap.querySelector('#toggleCriteriaOriginal')?.addEventListener('click',async()=>{const b=wrap.querySelector('button');b.disabled=true;try{const ok=await api.toggle(job.id,task.revision,!task.display_original);if(!ok)throw Error('Changed');task.display_original=!task.display_original;render(job);api.updated();}catch{b.disabled=false;api.toast('Could not change the wording view. Try again.','error');}});
  }
  function inputKey(job){return JSON.stringify([job.title,job.description||'',job.criteria||[],job.managerFeedback||'',job.knockouts||[]]);}
  async function refresh(job,force=false){
    if(!api||!job?.id||!api.ready())return;
    const now=Date.now(),key=inputKey(job),last=reads.get(job.id),task=cache.get(job.id);
    const complete=matches(task,job)&&['ready','failed'].includes(task.status);
    const delay=complete?30000:2000;
    if(!force&&last?.key===key&&now-last.time<delay){if(displayedJob!==job.id)render(job);return;}
    if(busy)return;busy=true;reads.set(job.id,{key,time:now});
    try{
      const next=await api.fetch(job.id),previous=JSON.stringify(cache.get(job.id)||null);
      if(next)cache.set(job.id,next);else cache.delete(job.id);
      if(api.job()?.id===job.id){const changed=previous!==JSON.stringify(next);if(changed||displayedJob!==job.id||last?.key!==key||force)render(api.job());if(changed)api.updated();}
    }catch{if(api.job()?.id===job.id)render(job,'Automatic criteria processing is not available yet');}
    finally{busy=false;}
  }
  function init(options){api=options;timer=setInterval(()=>{if(document.visibilityState==='visible')refresh(api.job());},2000);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh(api.job(),true)});}
  const methods={init,refresh,label,questions,matches};if(typeof module!=='undefined')module.exports=methods;global.AncalagonCriteria=methods;
})(typeof window!=='undefined'?window:globalThis);

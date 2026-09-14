(function(global){
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function create(api){
    const jobs=new Map(),requests=new Map(),busy=new Set(),errors=new Map(),markup=new WeakMap();let timer=null,loading=false,disposed=false;
    const rows=()=>(jobs.get(api.job()?.id)||[]).filter(t=>!global.AncalagonIntake?.pending(api.candidates().find(c=>c.id===t.candidate_id))&&t.job_id===api.job()?.id&&api.candidates().some(c=>c.id===t.candidate_id&&c.jobId===t.job_id)).concat(api.candidates().filter(c=>c.jobId===api.job()?.id&&global.AncalagonIntake?.pending(c)).map(c=>({candidate_id:c.id,job_id:c.jobId,intake:true,status:c.resumeIntake.phase==='ready'?'ready':c.resumeIntake.phase==='error'?'failed':'processing'})));
    function plan(ms=4000){if(disposed)return;clearTimeout(timer);timer=setTimeout(refresh,ms);}
    async function refresh(){
      if(disposed)return;render();if(!api.ready()){plan(500);return;}
      if(global.document?.hidden){plan(10000);return;}
      if(loading){plan(1500);return;}
      const job=api.job();if(!job){plan();return;}
      loading=true;
      try{const result=await api.load(job.id);jobs.set(job.id,result);errors.delete(job.id);}
      catch(e){errors.set(job.id,e.message||'Unable to load assessment updates.');}
      finally{loading=false;render();api.candidateChanged();plan(rows().some(t=>['queued','processing'].includes(t.status))?2500:8000);}
    }
    async function request(candidate){
      if(!candidate)return;
      // Saving is still durable if this browser closes before the follow-up RPC:
      // database source triggers also enqueue work.
      const token={};requests.set(candidate.id,token);api.candidateChanged();
      try{await api.persist();if(requests.get(candidate.id)!==token)return;await api.request(candidate.id);}
      catch(e){api.toast('Feedback is retained. '+(e.message||'Check the save status.'),'error');}
      finally{if(requests.get(candidate.id)===token)requests.delete(candidate.id);plan(800);}
    }
    const taskFor=c=>(jobs.get(c.jobId)||[]).find(t=>t.candidate_id===c.id);
    function body(task,c){
      const result=task.result||{},working=['queued','processing'].includes(task.status),disabled=busy.has(c.id)||api.job()?.status==='closed';
      if(working)return '<p class="rf-sub">Updating assessment in the background. You can close Ancalagon and return later.</p>';
      if(task.status==='failed')return `<p class="rf-sub">Assessment could not finish (${escape(task.error_code||'processing_failed')}). Your current score is unchanged.</p><button type="button" class="rf-btn" data-job-review="retry" data-review-candidate="${escape(c.id)}" ${disabled?'disabled':''}>Try again</button>`;
      if(task.status!=='ready')return `<p class="rf-sub">${task.status==='approved'?'Assessment approved and saved.':task.status==='ignored'?'Current assessment kept.':'Assessment paused because this job is closed.'}</p>`;
      const recommendation=global.AncalagonScoring.recommendation(Number(result.manager_score));
      return `<p class="rf-reevaluation-score"><span>${Number(c.managerScore).toFixed(1)}</span><span>→</span><strong>${Number(result.manager_score).toFixed(1)} / 10</strong></p>
        <p><strong>JD Fit: ${Number(c.jdScore).toFixed(1)} → ${Number(result.jd_score).toFixed(1)} / 10</strong></p><p class="rf-sub">Manager Fit · ${escape(c.rec)} → ${escape(recommendation)} · ${escape(result.confidence||'unknown')} evidence confidence</p>
        <p>${escape(result.manager_reason||result.summary)}</p><details><summary>Evidence and questions</summary><p>${escape(result.jd_reason)}</p><ul>${(result.evidence_ids||[]).map(id=>{const source=api.context(c).sources.find(s=>s.id===id);return `<li>${source?`<strong>${escape(source.kind)}:</strong> ${escape(source.text.slice(0,800))}`:'Source changed; refresh before reviewing.'}</li>`;}).join('')}</ul>${result.questions?.length?`<ul>${result.questions.map(q=>`<li>${escape(q)}</li>`).join('')}</ul>`:'<p class="rf-sub">No additional questions proposed.</p>'}</details>
        <div class="rf-actions"><button type="button" class="rf-btn primary" data-job-review="approve" data-review-candidate="${escape(c.id)}" ${disabled?'disabled':''}>Approve assessment</button><button type="button" class="rf-btn" data-job-review="ignore" data-review-candidate="${escape(c.id)}" ${disabled?'disabled':''}>Keep current assessment</button></div>`;
    }
    function bind(wrap){
      wrap.querySelectorAll('[data-job-review]').forEach(b=>b.addEventListener('click',()=>void review(b.dataset.reviewCandidate,b.dataset.jobReview)));
    }
    // Polling must not close evidence or replace focused controls when nothing changed.
    function updateContent(wrap,html){
      const previous=markup.get(wrap);if(previous?.html===html&&previous.node===wrap.firstChild)return;
      const expanded=[...wrap.querySelectorAll('details')].map(d=>d.open);
      const focused=wrap.contains(global.document?.activeElement)?global.document.activeElement:null;
      const action=focused?.dataset.jobReview;
      wrap.innerHTML=html;markup.set(wrap,{html,node:wrap.firstChild});
      wrap.querySelectorAll('details').forEach((d,i)=>{d.open=expanded[i]||false;});
      bind(wrap);
      if(action)wrap.querySelectorAll('[data-job-review]').forEach(b=>{if(b.dataset.jobReview===action&&!b.disabled)b.focus({preventScroll:true});});
    }
    function render(){
      const wrap=api.root.querySelector('#jobAssessmentUpdates'),status=api.root.querySelector('#jobReviewSummary'),panel=api.root.querySelector('#jobAssessmentPanel');
      if(!wrap||!status||!panel)return;
      const job=api.job(),error=errors.get(job?.id),loaded=jobs.has(job?.id);
      if(panel.dataset.jobId!==(job?.id||'')){
        panel.dataset.jobId=job?.id||'';panel.open=false;wrap.replaceChildren();
      }
      const tasks=rows(),ready=tasks.filter(t=>t.status==='ready'),working=tasks.filter(t=>['queued','processing'].includes(t.status)),failed=tasks.filter(t=>t.status==='failed');
      const counts=[ready.length&&`${ready.length} updated assessment${ready.length===1?'':'s'} ready to review`,working.length&&`${working.length} processing in the background`,failed.length&&`${failed.length} need attention`].filter(Boolean).join(' · ');
      const message=error&&!tasks.some(t=>t.intake)?'Updates temporarily unavailable. Retrying automatically.':!job?'Choose a job to see assessment updates.':!loaded&&!tasks.length?'Checking for updates…':counts||'No updates to review. Assessments run automatically when you save feedback or criteria.';
      if(status.textContent!==message)status.textContent=message;
      panel.dataset.state=error||failed.length?'attention':ready.length?'ready':working.length?'working':loaded?'idle':'loading';
      const relevant=tasks.filter(t=>['ready','queued','processing','failed'].includes(t.status));
      relevant.sort((a,b)=>(a.status==='ready'?0:1)-(b.status==='ready'?0:1));
      const wanted=new Set(relevant.map(t=>t.candidate_id));
      [...wrap.children].forEach(el=>{if(!wanted.has(el.dataset.reviewCard)){
        if(el.contains(global.document?.activeElement))panel.querySelector('summary').focus({preventScroll:true});
        el.remove();
      }});
      relevant.forEach((t,index)=>{
        const c=api.candidates().find(c=>c.id===t.candidate_id&&c.jobId===t.job_id);
        let card=[...wrap.children].find(el=>el.dataset.reviewCard===c.id);
        if(!card){card=global.document.createElement('article');card.className='rf-assessment-item';card.dataset.reviewCard=c.id;}
        if(wrap.children[index]!==card)wrap.insertBefore(card,wrap.children[index]||null);
        if(t.intake){api.renderIntake?.(c,card);return;}
        updateContent(card,`<h3>${escape(c.short)}</h3><p class="rf-sub">${escape(t.reason)}</p>${body(t,c)}`);
      });
    }
    function renderCandidate(candidate,wrap){
      if(global.AncalagonIntake?.pending(candidate)){wrap.hidden=true;return true;}
      const task=taskFor(candidate),pending=requests.has(candidate.id);
      if(!task&&!pending)return false;
      wrap.hidden=false;
      updateContent(wrap,`<span class="rf-kicker">Automatic assessment</span><h3>${pending?'Saving feedback for assessment…':task?.status==='ready'?'Updated candidate assessment':'Assessment update'}</h3>${pending?'<p class="rf-sub">Preparing the latest evidence for background processing.</p>':body(task,candidate)}`);
      return true;
    }
    async function review(id,decision){
      if(busy.has(id))return;
      const candidate=api.candidates().find(c=>c.id===id&&c.jobId===api.job()?.id),task=candidate&&taskFor(candidate);
      if(!task)return;
      busy.add(id);render();api.candidateChanged();
      try{
        await api.review(id,task.revision,decision);
        api.approved(candidate);
        api.toast(decision==='approve'?'Assessment approved and saved.':decision==='ignore'?'Current assessment kept.':'Assessment queued for another try.');
      }catch(e){api.toast(e.message||'Unable to save this decision.','error');}
      finally{busy.delete(id);await refresh();}
    }
    function dispose(){disposed=true;clearTimeout(timer);}
    function init(){plan(300);global.document?.addEventListener('visibilitychange',()=>{if(!document.hidden)plan(300);});}
    return {init,refresh,request,render,renderCandidate,dispose};
  }
  const api={create};if(typeof module!=='undefined')module.exports=api;global.AncalagonJobReview=api;
})(typeof window==='undefined'?globalThis:window);

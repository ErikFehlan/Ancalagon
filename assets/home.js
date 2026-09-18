(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AncalagonHome=api;})(globalThis,function(){
 'use strict';
 const pages=new Set(['dashboard','candidates','detail','pipeline','outcomes','rankings','compare','benchmarks','criteria','feedback','insights']);
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function location(state,saved){
  const job=state.jobs.find(j=>j.id===saved?.last_job_id);if(!job)return null;
  const candidate=state.candidates.find(c=>c.id===saved.last_candidate_id&&c.jobId===job.id);
  return {job,candidate: saved.last_page==='detail'?candidate:null,page:saved.last_page==='detail'&&!candidate?'candidates':pages.has(saved.last_page)?saved.last_page:'dashboard'};
 }
 function model(state,saved,firstVisit,rows=[]){
  const active=state.jobs.filter(j=>j.status!=='closed'),activeIds=new Set(active.map(j=>j.id));
  const candidates=state.candidates.filter(c=>activeIds.has(c.jobId));
  const byId=new Map(candidates.map(c=>[c.id,c]));
  const scopedRows=rows.filter(r=>activeIds.has(r.job_id)&&byId.get(r.candidate_id)?.jobId===r.job_id&&!(r.source==='intake'&&(byId.get(r.candidate_id)?.resumeIntake?.reviewedAt||byId.get(r.candidate_id)?.aiReview)));
  const remoteIntakes=new Set(scopedRows.filter(r=>r.source==='intake').map(r=>r.candidate_id));
  const readyIds=new Set(scopedRows.filter(r=>r.status==='ready').map(r=>r.candidate_id));
  const workingIds=new Set(scopedRows.filter(r=>['queued','processing'].includes(r.status)).map(r=>r.candidate_id));
  const attentionIds=new Set(scopedRows.filter(r=>r.status==='failed').map(r=>r.candidate_id));
  for(const c of candidates){
   if(c.resumeIntake&&!c.resumeIntake.reviewedAt&&!c.aiReview&&!remoteIntakes.has(c.id)){
    const phase=c.resumeIntake.phase||c.resumeIntake.status;
    if(phase==='ready')readyIds.add(c.id);
    if(['uploading','queued','processing'].includes(phase))workingIds.add(c.id);
    if(phase==='error')attentionIds.add(c.id);
   }
   if(c.feedbackEvaluation?.status==='ready')readyIds.add(c.id);
  }
  const ready=candidates.filter(c=>readyIds.has(c.id)),working=candidates.filter(c=>workingIds.has(c.id)&&!readyIds.has(c.id)),attention=candidates.filter(c=>attentionIds.has(c.id)&&!readyIds.has(c.id)&&!workingIds.has(c.id));
  const last=location(state,saved);
  const recent=active.slice().sort((a,b)=>(b.id===last?.job.id)-(a.id===last?.job.id)||(Number(b.updatedAt)||0)-(Number(a.updatedAt)||0));
  const reviewed=c=>c.resumeIntake?.reviewedAt||c.aiReview;
  const candidateCounts=new Map(active.map(j=>[j.id,0]));
  for(const c of candidates)candidateCounts.set(c.jobId,candidateCounts.get(c.jobId)+1);
  return {firstVisit,last,recent,ready,working,attention,candidateCounts,setupJob:recent[0]||null,setupCandidate:ready[0]||candidates.find(c=>!reviewed(c))||candidates[0]||null,
   steps:[state.jobs.length>0,state.candidates.length>0,state.candidates.some(reviewed),(state.feedback||[]).length>0||state.candidates.some(c=>c.screeningInsight?.notes)]};
 }
 function create(api,{delay=250,timeout=6000}={}){
  let saved=null,firstVisit=false,loaded=false,visited=false,loading=true,problem='',pending=null,timer=null,writing=null,loadPromise=null,queue=[],queueProblem=false,refreshPromise=null,disposed=false;
  const changed=()=>{if(!disposed)api.changed?.();};
  async function bounded(work){let t;try{return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>t=setTimeout(()=>reject(Error('Home request timed out')),timeout))]);}finally{clearTimeout(t);}}
  async function load(){
   if(loadPromise)return loadPromise;
   loading=true;problem='';changed();
   loadPromise=(async()=>{try{
    const row=await bounded(()=>api.load());if(disposed)return;
    if(!loaded)firstVisit=!row&&!api.state().jobs.length;saved={...(row||{}),...(pending||{})};loaded=true;visited=Boolean(row);
    // A visit marker is separate from the last working location. Opening Home never erases it.
    await bounded(()=>api.visit());visited=true;
   }catch{problem='Your starting point could not be synced. You can still open any job.';}
   finally{loading=false;loadPromise=null;changed();if(pending)void flush();}})();
   return loadPromise;
  }
  function remember(page,jobId,candidateId=null){
   if(disposed||!pages.has(page))return;
   const state=api.state(),job=state.jobs.find(j=>j.id===jobId);if(!job)return;
   const candidate=page==='detail'?state.candidates.find(c=>c.id===candidateId&&c.jobId===jobId):null;
   if(page==='detail'&&!candidate)return;
   const next={last_job_id:jobId,last_candidate_id:candidate?.id||null,last_page:page,last_opened_at:new Date().toISOString()};
   if(saved&&['last_job_id','last_candidate_id','last_page'].every(k=>saved[k]===next[k])&&!pending)return;
   saved={...saved,...next};pending=next;clearTimeout(timer);timer=setTimeout(()=>void flush(),delay);
  }
  async function flush(){
   clearTimeout(timer);if(writing){await writing;if(pending)return flush();return !problem;}
   if(!pending||!loaded||disposed)return !pending;
   const next=pending;pending=null;
   writing=Promise.resolve().then(async()=>{if(!visited){await bounded(()=>api.visit());visited=true;}return bounded(()=>api.save(next));}).then(()=>{problem='';return true;},()=>{if(!pending)pending=next;problem='Your latest place has not synced yet. You can keep working and retry from Home.';return false;});
   const ok=await writing;writing=null;changed();if(ok&&pending)return flush();return ok;
  }
  async function refresh(){
   if(refreshPromise)return refreshPromise;
   refreshPromise=(async()=>{try{const rows=await bounded(()=>api.reviews());if(!disposed){queue=rows||[];queueProblem=false;}}catch{queueProblem=true;}finally{refreshPromise=null;changed();}})();return refreshPromise;
  }
  function view(){return {...model(api.state(),saved,firstVisit,queue),loaded,loading,problem,queueProblem};}
  function dispose(){disposed=true;clearTimeout(timer);}
  return {load,remember,flush,refresh,view,dispose};
 }
 function render(host,m,{name='',error='',tutorial=null,workflow='',featuredJobId=null}={}){
  if(!host)return;
  const action=(label,kind,job='',candidate='',primary=false,link=false)=>`<button type="button" class="${link?'rf-linkbtn':'rf-btn'}${primary?' primary':''}" data-home-action="${kind}" data-job="${esc(job)}" data-candidate="${esc(candidate)}">${label}</button>`;
  if(error){host.innerHTML=`<div class="rf-card rf-home-hero"><h1>Let’s reconnect your workspace</h1><p>${esc(error)}</p>${action('Try again','reload','','',true)}</div>`;return;}
  const first=m.firstVisit,title=first?'Get started here':'Pick up where you left off';
  const heading=m.loading&&!m.loaded?'Getting your starting point ready…':title;
  const last=m.last,closed=last?.job.status==='closed';
  const otherJobs=m.recent.filter(j=>j.id!==featuredJobId);
  const status=job=>{
   const count=list=>list.filter(c=>c.jobId===job.id).length;
   const attention=count(m.attention),ready=count(m.ready),working=count(m.working);
   if(attention)return {label:`${attention} need${attention===1?'s':''} attention`,tone:'attention'};
   if(ready)return {label:`${ready} to review`,tone:'ready'};
   if(working)return {label:`${working} processing`,tone:'processing'};
   return {label:'Active',tone:'active'};
  };
  const jobRows=otherJobs.slice(0,5).map(j=>{
   const count=m.candidateCounts.get(j.id)||0,progress=status(j);
   return `<li><button type="button" class="rf-home-job" data-home-action="job" data-job="${esc(j.id)}"><span class="rf-home-job-copy"><strong>${esc(j.title)}</strong><small>${count} candidate${count===1?'':'s'}</small></span><span class="rf-home-job-status" data-tone="${progress.tone}">${progress.label}</span><span class="rf-home-job-arrow" aria-hidden="true">→</span></button></li>`;
  }).join('');
  host.innerHTML=`<div class="rf-home-heading"><div><span class="rf-home-eyebrow">${name?'Welcome'+(first?'':' back')+', '+esc(name):'Your workspace'}</span><h1 tabindex="-1">${heading}</h1></div></div>
   ${m.problem?`<div class="rf-home-notice" role="status">${esc(m.problem)} ${action('Retry sync','retry')}</div>`:''}
   ${workflow?`<section id="homeSearchFlow" class="rf-search-flow" aria-label="Next step for your search">${workflow}</section>`:''}
   <div class="rf-home-panels">
    <section class="rf-home-new" aria-labelledby="homeNewJobTitle"><div><span class="rf-home-new-icon" aria-hidden="true">+</span><h2 id="homeNewJobTitle">New job</h2><p>Add a job description to start a new search.</p></div>${action('Create job →','new','','',!workflow)}</section>
   <section class="rf-home-jobs" aria-label="Active jobs"><div class="rf-home-list-heading"><h2>${featuredJobId?'Other active jobs':'Active jobs'}${otherJobs.length?` <span>${otherJobs.length}</span>`:''}</h2>${m.steps[0]?action('All jobs →','jobs','','',false,true):''}</div>
    ${jobRows?`<ul class="rf-home-job-list">${jobRows}</ul>`:`<p class="rf-home-empty">${featuredJobId?'No other active jobs yet.':m.steps[0]?'No active jobs. Find completed searches in All jobs.':'Your jobs will appear here once you create a search.'}</p>`}
    ${otherJobs.length>5?`<p class="rf-home-list-note">Showing 5 of ${otherJobs.length} active jobs.</p>`:''}
    ${m.queueProblem?`<p class="rf-home-list-note" role="status">Assessment status is temporarily unavailable. ${action('Retry','reviews','','',false,true)}</p>`:''}
   </section>
   </div>
   <div class="rf-home-footer"><span>Need a hand?</span><div>${closed?action('View last closed job','continue',last.job.id,'',false,true):''}${tutorial&&!tutorial.complete?action(tutorial.started?'Resume practice':'Try a practice search','practice','','',false,true):''}${action('Learn Ancalagon','learn','','',false,true)}</div></div>`;
 }

 return {create,model,location,render,pages};
});

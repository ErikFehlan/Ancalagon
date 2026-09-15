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
  return {firstVisit,last,recent,ready,working,attention,setupJob:recent[0]||null,setupCandidate:ready[0]||candidates.find(c=>!reviewed(c))||candidates[0]||null,
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
 function render(host,m,{name='',error=''}={}){
  if(!host)return;
  const action=(label,kind,job='',candidate='',primary=false)=>`<button type="button" class="rf-btn${primary?' primary':''}" data-home-action="${kind}" data-job="${esc(job)}" data-candidate="${esc(candidate)}">${label}</button>`;
  if(error){host.innerHTML=`<div class="rf-card rf-home-hero"><h1>Let’s reconnect your workspace</h1><p>${esc(error)}</p>${action('Try again','reload','','',true)}</div>`;return;}
  const first=m.firstVisit,title=first?'Get started here':'Pick up where you left off';
  const heading=m.loading&&!m.loaded?'Getting your starting point ready…':title;
  const intro=first?'A job, a resume, and a little context. Ancalagon turns your inputs into an assessment you can review.':'Continue your last search or choose what needs your attention.';
  const last=m.last;
  const labels={dashboard:'Job dashboard',candidates:'Candidates',detail:'Candidate assessment',pipeline:'Pipeline',outcomes:'Interview activity',rankings:'Rankings',compare:'Compare',benchmarks:'Benchmarks',criteria:'Evaluation criteria',feedback:'Manager feedback',insights:'Hiring insights'};
  const continuation=last?`<div class="rf-home-continue"><div><span class="rf-home-eyebrow">${last.job.status==='closed'?'Closed search · view history':'Last opened · '+esc(labels[last.page])}</span><h2>${esc(last.candidate?.short||last.candidate?.name||last.job.title)}</h2><p>${last.candidate?esc(last.job.title):esc(last.job.client||'Your search')}</p></div>${action(last.job.status==='closed'?'View history':'Continue →','continue',last.job.id,last.candidate?.id||'',true)}</div>`:'';
  const setup=m.steps.some(done=>!done)&&(!m.steps[0]||m.recent.length>0),count=m.steps.filter(Boolean).length;
  const stepActions=[m.steps[0]?action('View jobs','jobs'):action('Create job','new'),m.setupJob?action('Upload resumes','upload',m.setupJob.id):'',m.setupCandidate?action('Open candidate','candidate',m.setupCandidate.jobId,m.setupCandidate.id):'',m.setupCandidate?action('Add a short note','note',m.setupCandidate.jobId,m.setupCandidate.id):''];
  const steps=['Create a job','Add your resumes','Review an assessment','Add what you learned'];
  const tips=['Paste the job description and a few manager priorities. AI organizes them automatically.','Choose several files at once. Saved resumes keep processing after you leave.','Check the evidence and approve. Ancalagon opens the next ready assessment.','A few words from the screen or manager are enough. AI turns them into useful context.'];
  const rows=(list,label)=>list.slice(0,3).map(c=>`<div class="rf-home-row"><div><strong>${esc(c.short||c.name)}</strong><small>${esc(m.recent.find(j=>j.id===c.jobId)?.title||'Candidate assessment')}</small></div>${action(label,'candidate',c.jobId,c.id)}</div>`).join('');
  host.innerHTML=`<div class="rf-home-heading"><div><span class="rf-home-eyebrow">${name?'Welcome'+(first?'': ' back')+', '+esc(name):'Your workspace'}</span><h1 tabindex="-1">${heading}</h1><p>${intro}</p></div>${action('All jobs','jobs')}</div>
   ${m.problem?`<div class="rf-home-notice" role="status">${esc(m.problem)} ${action('Retry sync','retry')}</div>`:''}
   ${continuation}
   ${setup?`<section class="rf-home-onboarding" aria-label="Getting started"><div class="rf-cardhead"><h2>Your first complete search</h2><span class="rf-pill rf-blue">${count} of 4 complete</span></div><ol class="rf-home-steps">${steps.map((s,i)=>`<li class="rf-card${m.steps[i]?' complete':''}"><span class="rf-home-step">${m.steps[i]?'✓':i+1}</span><h3>${s}</h3><p>${tips[i]}</p>${stepActions[i]||'<span class="rf-sub">'+(i===1?'Create a job to begin.':'Add a candidate to begin.')+'</span>'}</li>`).join('')}</ol></section>`:''}
   <div class="rf-home-grid"><div class="rf-card"><div class="rf-cardhead"><h2>Ready to review</h2><span class="rf-pill rf-blue">${m.ready.length}</span></div>${m.queueProblem?`<p class="rf-sub" role="status">Some assessment updates could not be loaded. ${action('Retry','reviews')}</p>`:''}${m.ready.length?rows(m.ready,'Review'):'<div class="rf-home-empty"><strong>No assessments waiting in this view</strong><p>Upload resumes or add feedback. Your next assessments will appear here.</p></div>'}${m.ready.length>3?'<p class="rf-sub">Continue reviewing to work through the rest.</p>':''}${m.working.length?`<p class="rf-sub">${m.working.length} assessment${m.working.length===1?'':'s'} being prepared in the background.</p>`:''}${m.attention.length?`<h3>Needs attention · ${m.attention.length}</h3>${rows(m.attention,'Resolve')}`:''}</div>
    <div class="rf-card"><div class="rf-cardhead"><h2>Active jobs</h2>${action('View all','jobs')}</div>${m.recent.length?m.recent.slice(0,3).map(j=>`<div class="rf-home-row"><div><strong>${esc(j.title)}</strong><small>${esc(j.client||'Independent search')}</small></div>${action('Open','job',j.id)}</div>`).join(''):'<p class="rf-sub">No active jobs. Start a new search or open a completed job from All jobs.</p>'}${action(m.steps[0]?'+ New job':'Create your first job','new','','',!m.steps[0])}</div></div>
   <div class="rf-home-footer"><span>Short notes are enough. Add context as you go.</span>${action('Learn Ancalagon','learn')}</div>`;
 }
 return {create,model,location,render,pages};
});

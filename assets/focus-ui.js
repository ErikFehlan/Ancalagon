(function(global){
 'use strict';
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const workspacePages=new Set(['home','jobs','job-picker','learn','backend','admin-usage']);
 const labels={home:'Home',jobs:'Jobs','job-picker':'Jobs',dashboard:'Overview',candidates:'Candidates',pipeline:'Pipeline',feedback:'Manager feedback',outcomes:'Interview activity',criteria:'Evaluation criteria',rankings:'Rankings',compare:'Compare',benchmarks:'Benchmarks',insights:'Hiring insights',learn:'Learn Ancalagon',backend:'Settings','admin-usage':'Usage analytics'};
 let editingDepth=0;
 // Keep a focused editor at the same place when the assessment above it changes.
 function preserveEditing(root,change){
  if(editingDepth)return change();
  const active=global.document?.activeElement,editing=root?.contains(active)&&active.matches('textarea,input,[contenteditable="true"]');
  const top=editing?active.getBoundingClientRect().top:null;
  editingDepth++;try{return change();}finally{editingDepth--;if(editing&&active.isConnected&&global.document.activeElement===active){const delta=active.getBoundingClientRect().top-top;if(Math.abs(delta)>.5)global.scrollBy({top:delta,behavior:'instant'});}}
 }
 const panelMarkup=new WeakMap(),deferred=new WeakMap();
 function updatePanel(wrap,html,bind=()=>{}){
  if(panelMarkup.get(wrap)===html)return;
  // Leave a correction editor (and its Save button) intact until the user leaves it.
  if(wrap.contains(global.document.activeElement)){
   deferred.set(wrap,{html,bind});if(!wrap.dataset.deferBound){wrap.dataset.deferBound='true';wrap.addEventListener('focusout',()=>setTimeout(()=>{if(wrap.isConnected&&!wrap.contains(global.document.activeElement)){const latest=deferred.get(wrap);if(latest){deferred.delete(wrap);updatePanel(wrap,latest.html,latest.bind);}}},0));}return;
  }
  const expanded=[...wrap.querySelectorAll('details')].map(d=>d.open);
  wrap.innerHTML=html;panelMarkup.set(wrap,html);deferred.delete(wrap);
  wrap.querySelectorAll('details').forEach((d,i)=>d.open=expanded[i]||false);bind(wrap);
 }
 function create({root,navigate}){
  const positions=new Map();let key=null,version=0,currentPage='home',currentJob=null,currentCandidate=null;
  function disclosure(id,title,nodes){
   const valid=nodes.filter(Boolean);if(!valid.length)return;
   const section=document.createElement('details');section.id=id;section.className='rf-card rf-supporting-details';
   const summary=document.createElement('summary');summary.textContent=title;section.append(summary);
   const content=document.createElement('div');content.className='rf-supporting-body';section.append(content);
   valid[0].before(section);valid.forEach(node=>content.append(node));return section;
  }
  function init(){
   root.querySelector('.rf-bench').classList.add('rf-hidden');
   root.querySelector('#jobGuide').open=false;
   const dashboard=root.querySelector('#page-dashboard'),top=root.querySelector('#dashboardTopCandidates').closest('.rf-card');
   root.querySelector('#jobAssessmentPanel').after(top);top.classList.add('rf-dashboard-shortlist');
   const groups=['.rf-dashboard-context','.rf-dashboard-overview','.rf-dashboard-bottom','#jobGuide'].map(s=>dashboard.querySelector(s));
   disclosure('dashboardDetails','Search details and setup',groups);
   const editor=root.querySelector('#jobForm').closest('.rf-card');
   const jobEditor=disclosure('jobEditor','Create or edit a job',[editor]);jobEditor.classList.add('rf-job-editor');jobEditor.addEventListener('toggle',()=>root.querySelector('#newJobBtn').classList.toggle('primary',!jobEditor.open));
   const insights=root.querySelector('#page-insights');
   disclosure('insightDetails','Explore supporting patterns',[...insights.children].slice(4));
   disclosure('preferenceDetails','Reusable manager preferences',[root.querySelector('.rf-preference-card')]);
   const select=root.querySelector('#detailStage'),stage=(select.closest('.rf-select')||select).parentElement;stage.classList.add('rf-candidate-stage');const label=stage.querySelector('label');if(label){label.textContent='Stage';label.htmlFor='detailStage';}
   root.querySelector('#detailActions').prepend(stage);
   root.addEventListener('keydown',event=>{if(event.key==='Escape'){const menu=event.target.closest('.rf-job-menu');if(menu){event.preventDefault();menu.open=false;menu.querySelector('summary').focus();}}});
   root.querySelector('#workspaceBreadcrumbs').addEventListener('click',event=>{const b=event.target.closest('[data-breadcrumb]');if(b)navigate(b.dataset.breadcrumb);});
  }
  function begin(){if(key)positions.set(key,global.scrollY);version++;return version;}
  function context(page=currentPage,job=currentJob,candidate=currentCandidate){
   currentPage=page;currentJob=job;currentCandidate=candidate;
   const isWorkspace=workspacePages.has(page)||!job;root.dataset.page=page;root.dataset.context=isWorkspace?'workspace':'job';
   root.querySelector('.rf-globaljob').classList.toggle('rf-hidden',isWorkspace);
   const selected=page==='detail'?'candidates':page==='job-picker'?'jobs':page;
   root.querySelectorAll('.rf-nav [data-page]').forEach(button=>{const active=button.dataset.page===selected;button.classList.toggle('active',active);if(active){button.setAttribute('aria-current','page');const group=button.closest('details');if(group)group.open=true;}else button.removeAttribute('aria-current');});
   const trail=root.querySelector('#workspaceBreadcrumbs');
   const parts=[{label:'Home',page:'home'}];
   if(!isWorkspace)parts.push({label:job.title,page:'dashboard'});
   if(page!=='home'&&page!=='dashboard')parts.push({label:page==='detail'?candidate?.short||candidate?.name||'Candidate':labels[page]||'Workspace'});
   const html=parts.map((p,i)=>i===parts.length-1?`<span aria-current="page" title="${escape(p.label)}">${escape(p.label)}</span>`:`<button type="button" class="rf-linkbtn" data-breadcrumb="${p.page}" title="${escape(p.label)}">${escape(p.label)}</button><span aria-hidden="true">/</span>`).join('');
   if(trail.dataset.markup!==html){trail.innerHTML=html;trail.dataset.markup=html;}
  }
  function show(page,job,candidate,token){
   context(page,job,candidate);
   const next=page+':'+(workspacePages.has(page)?'workspace':job?.id||'')+':'+(page==='detail'?candidate?.id||'':'');
   const same=next===key;key=next;
   if(!same){const y=['candidates','pipeline','jobs','job-picker'].includes(page)?positions.get(next)||0:0;
    global.requestAnimationFrame(()=>{if(token===version)global.scrollTo({top:y,behavior:'instant'});});}
  }
  return {init,begin,show,context};
 }
 const api={create,preserveEditing,updatePanel};if(typeof module==='object'&&module.exports)module.exports=api;global.AncalagonFocus=api;
})(globalThis);

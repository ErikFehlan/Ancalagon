(function(global){
 'use strict';
 function mount(root,api){
  const lesson=global.AncalagonTutorial,q=selector=>root.querySelector(selector),qa=selector=>Array.from(root.querySelectorAll(selector));
  let page='learn',disposed=false,editingInterpretation=false;
  const session=lesson.create({load:api.load,save:api.save,changed:()=>{if(!disposed){sync();api.changed?.();}}});
  const fieldIds={title:'at-job-title-input',description:'at-job-description',priority:'at-job-priority',note:'at-note-input',interpretation:'at-edit-interpretation',draft:'at-draft'};
  function announce(message){q('#at-status').textContent=message;}
  function sync(){
   const v=session.view(),s=v.state;
   q('#at-sync-status').textContent=v.loading?'Loading practice progress…':v.problem?'Practice progress needs attention':v.saving||v.pending?'Saving practice progress…':s.started?'Practice progress synced to your account':'Your practice search is ready';
   q('#at-sync-error').hidden=!v.problem;q('#at-sync-problem').textContent=v.problem;
   q('[data-action="sync-retry"]').textContent=v.conflict?'Load saved progress':v.loaded?'Retry sync':'Retry loading progress';
   qa('[data-action="start"]').forEach(button=>button.disabled=!v.loaded||v.loading);
   qa('[data-start-label]').forEach(label=>label.textContent=s.complete?'Review practice':s.started?'Resume practice':'Start practice');
  }
  function focusCurrent(){
   const heading=q('[data-view="'+page+'"] '+(page==='practice'?'[data-stage="'+session.view().state.step+'"] h2':'h1'));
   if(heading){heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});heading.scrollIntoView({block:'nearest',behavior:'instant'});}
  }
  function render(focus=false){
   const s=session.view().state,count=s.retried?3:2,done=s.reviewIndex>=count,person=lesson.samples[Math.min(s.reviewIndex,count-1)],p=lesson.proposal(s);
   qa('[data-view]').forEach(el=>el.hidden=el.dataset.view!==page);
   qa('[data-stage]').forEach(el=>el.hidden=Number(el.dataset.stage)!==s.step);
   qa('[data-step]').forEach(button=>{const n=Number(button.dataset.step);button.disabled=n>s.maxStep;button.classList.toggle('at-done',n<s.maxStep||s.complete);if(n===s.step)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');button.setAttribute('aria-label','Step '+n+': '+['Set up a search','Add resumes','Review evidence','Capture feedback','Build a shortlist'][n-1]);});
   for(const [key,id] of Object.entries(fieldIds)){const el=q('#'+id);if(document.activeElement!==el)el.value=s[key];}
   qa('[data-job-title]').forEach(el=>el.textContent=s.title);
   q('#at-upload-empty').hidden=s.uploaded;q('#at-upload-results').hidden=!s.uploaded;
   q('[data-action="retry"]').hidden=s.retried;
   q('#at-retry-description').textContent=s.retried?'Candidate created':'File could not be read';
   q('#at-retry-badge').textContent=s.retried?'Ready to review':'Needs retry';q('#at-retry-badge').className='at-badge '+(s.retried?'at-success':'at-warning');
   q('#at-upload-count').textContent=s.retried?'3 ready · no files need attention':'2 ready · 1 needs attention';
   q('#at-upload-coach').textContent=s.retried?'The retry worked. Jordan and Alex were kept; only Morgan’s file was retried.':s.uploaded?'Two resumes succeeded. Retry Morgan’s file on its own, or continue reviewing the two that are ready.':'Each resume gets its own status. Let’s try a batch with one file that needs a retry.';
   q('#at-assessment-panel').hidden=done;q('#at-reviews-done').hidden=!done;
   const fields={'#at-candidate-name':person.name,'#at-candidate-initials':person.initials,'#at-jd-score':person.jd.toFixed(1),'#at-manager-score':person.manager.toFixed(1),'#at-supported':person.supported,'#at-unknown':person.unknown,'#at-source-location':person.file+' · page 1 · fictional excerpt','#at-source-quote':'“'+person.quote+'”','#at-review-coach':done?'You have reviewed the ready assessments. Now add the evidence from your practice call.':person.coach,'#at-review-count':'Candidate '+(Math.min(s.reviewIndex,count-1)+1)+' of '+count,'#at-approved-count':count+' assessments reviewed'};
   Object.entries(fields).forEach(([selector,value])=>q(selector).textContent=value);
   q('#at-source').open=!done&&s.sourceSeen[s.reviewIndex];
   q('[data-action="approve-assessment"]').disabled=done||!s.sourceSeen[s.reviewIndex];
   q('[data-action="approve-assessment"]').textContent=s.reviewIndex===count-1?'Approve assessment':'Approve & next →';
   q('#at-evidence-prompt').textContent=s.sourceSeen[s.reviewIndex]?'Source checked · ready for your review':'Open the source before approving.';
   q('#at-note-form').hidden=s.notePhase!==0;q('#at-interpretation').hidden=s.notePhase!==1;q('#at-proposal').hidden=s.notePhase!==2;q('#at-feedback-done').hidden=s.notePhase!==3;
   q('#at-original-note').textContent=s.note;q('#at-interpretation-text').textContent=s.interpretation;
   q('#at-edit-wrap').hidden=!editingInterpretation;q('#at-interpretation-text').hidden=editingInterpretation;q('[data-action="correct"]').hidden=editingInterpretation;
   q('#at-proposal-reason').textContent=p.reason;q('#at-jd-change').textContent='7.8 → '+p.jd.toFixed(1);q('#at-manager-change').textContent='6.2 → '+p.manager.toFixed(1);
   q('[data-action="approve-update"]').textContent=p.changed?'Approve update ✓':'Approve with scores unchanged';
   q('#at-feedback-result').textContent=p.changed?'Jordan’s practice assessment now includes the new evidence. The original note remains available.':'Your reviewed note is saved. Jordan’s scores remain unchanged in this practice example.';
   q('#at-feedback-coach').textContent=[
    'Your practice call answered Jordan’s automation question. Save the note, then check that the interpretation preserves its meaning.',
    'Is this what you meant? Correct the interpretation if needed before accepting it.',
    'Review both the reason and the scope. This proposal belongs to Jordan; it does not rescore other candidates.',
    'You stayed in control of the meaning and the assessment. Now turn that evidence into a useful summary.'
   ][s.notePhase];
   sync();if(focus)focusCurrent();
  }
  async function load(){const ok=await session.load();if(!disposed)render();return ok;}
  async function start(){if(!session.view().loaded&&!await load())return;session.update('start');page='practice';render(true);announce('Practice step '+session.view().state.step+' of 5.');}
  function move(action,value){session.update(action,value);render(true);announce('Practice step '+session.view().state.step+' of 5.');}
  async function click(event){
   const button=event.target.closest('button');if(!button||!root.contains(button)||button.disabled)return;
   const action=button.dataset.action;
   if(button.dataset.step){move('step',Number(button.dataset.step));return;}
   if(action==='start'){await start();return;}
   if(action==='sync-retry'){
    const v=session.view();
    if(v.conflict){if(global.confirm('Load your saved tutorial progress? This replaces unsynced tutorial edits on this page.')){await load();render(true);}}
    else if(!v.loaded)await load();else {await session.flush();render();}return;
   }
   if(action==='new-job'){void session.flush().catch(()=>{});api.newJob();return;}
   if(action==='leave'){page='learn';render(true);void session.flush().catch(()=>{});return;}
   if(action==='answers'){page='learn';render();const summary=q('#at-quick-answers summary');summary.parentElement.open=true;summary.focus();return;}
   if(action==='review-steps'){page='practice';move('step',1);return;}
   if(action==='back'){move('step',Math.max(1,session.view().state.step-1));return;}
   if(action==='correct'){editingInterpretation=true;render();q('#at-edit-interpretation').focus();return;}
   if(action==='accept-interpretation'&&!q('#at-edit-interpretation').value.trim()){q('#at-edit-interpretation').reportValidity();return;}
   if(['upload','retry','to-review','approve-assessment','to-feedback','accept-interpretation','approve-update','to-shortlist'].includes(action)){
    session.update(action);render(true);
    if(action==='upload')announce('Two sample resumes are ready. Morgan’s file needs a retry.');
    else if(action==='retry')announce('Retry succeeded. Three sample resumes are ready.');
    else if(action==='approve-assessment')announce('Assessment approved. '+q('#at-review-coach').textContent);
    else announce('Practice step '+session.view().state.step+' of 5.');
   }
  }
  function input(event){const entry=Object.entries(fieldIds).find(([,id])=>id===event.target.id);if(entry)session.update('field',{key:entry[0],value:event.target.value});}
  async function submit(event){
   if(!['at-job-form','at-note-form','at-draft-form'].includes(event.target.id))return;event.preventDefault();
   if(event.target.id==='at-job-form'){move('job');return;}
   if(event.target.id==='at-note-form'){
    if(!q('#at-note-input').value.trim())return;
    session.update('note');await session.flush();editingInterpretation=false;render(true);announce('Original note saved. Review the interpretation.');return;
   }
   if(!q('#at-draft').value.trim())return;
   session.update('save-draft');await session.flush();page='complete';render(true);announce('Practice complete. Your tutorial draft is saved.');
  }
  const safe=fn=>event=>Promise.resolve(fn(event)).catch(()=>sync());
  const onClick=safe(click),onSubmit=safe(submit);
  function source(){if(q('#at-source').open&&!q('#at-assessment-panel').hidden){session.update('source');q('[data-action="approve-assessment"]').disabled=false;q('#at-evidence-prompt').textContent='Source checked · ready for your review';}}
  root.addEventListener('click',onClick);root.addEventListener('input',input);root.addEventListener('submit',onSubmit);q('#at-source').addEventListener('toggle',source);
  render();
  return {load,start,open:()=>render(),flush:session.flush,hasPending:session.hasPending,
   summary:()=>{const v=session.view();return {started:v.state.started,complete:v.state.complete,step:v.state.step,loaded:v.loaded};},
   dispose(){disposed=true;session.dispose();root.removeEventListener('click',onClick);root.removeEventListener('input',input);root.removeEventListener('submit',onSubmit);q('#at-source').removeEventListener('toggle',source);}};
 }
 global.AncalagonTutorialUI={mount};
})(window);

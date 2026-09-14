(function(global){
  'use strict';
  const drafts=new Map(),notes=new Map();let api,current=null;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function summary(candidate,job,feedback){
    const observations=feedback.filter(f=>f.jobId===job.id&&f.candidateId===candidate.id).slice(-3);
    return `${candidate.short} — ${candidate.role||'Candidate'}\nSearch: ${job.title}\n\nProfile evidence to review:\n${(candidate.strengths||[]).slice(0,3).map(x=>'• '+x).join('\n')||'No supporting examples recorded.'}\n\nRecruiter / manager observations:\n${observations.map(f=>'• '+f.text).join('\n')||'No observations recorded.'}\n\nQuestions to resolve:\n${(candidate.concerns||[]).slice(0,3).map(x=>'• '+x).join('\n')||'Confirm the job requirements and personal contribution during screening.'}`;
  }
  function pending(){return [...notes.values()].some(x=>x.trim())||drafts.size>0;}
  function render(candidate){
    if(!candidate||!api)return;current=candidate.id;const job=api.job(),all=api.feedback(),scoped=all.filter(f=>f.jobId===job.id&&f.candidateId===candidate.id),readiness=api.readiness(candidate),context=api.context(candidate),stale=candidate.aiReview?.contextSignature&&candidate.aiReview.contextSignature!==api.signature(context);
    const questions=[...new Set([...readiness.mustGaps.map(r=>`Can you walk me through a specific example of ${r.requirement}, including your own contribution?`),...(global.AncalagonCriteria?.questions(job)||[]),...(candidate.screeningQuestions?.length?candidate.screeningQuestions:api.questions(candidate))])].slice(0,3);
    const wrap=api.root.querySelector('#candidateWorkspace');
    wrap.innerHTML=`<div id="workspaceIntake" class="rf-card rf-intake-brief" hidden></div><div id="workspaceEvaluation" class="rf-card" aria-live="polite" hidden></div><div class="rf-card rf-workspace-overview"><div><span class="rf-kicker">Next action</span><h3>${stale?'Review an outdated evaluation':escape(readiness.label)}</h3><p>${stale?'The recorded context has changed since the last approved evaluation. Review a new proposal before relying on the score.':'Resolve the key uncertainty below, then review the evidence before submitting.'}</p></div><div><strong>Supporting profile evidence</strong><p>${escape(candidate.strengths?.[0]||candidate.signal||'No supporting evidence recorded yet.')}</p></div><div><strong>Key uncertainty</strong><p>${escape(readiness.knockouts[0]?.requirement||readiness.mustGaps[0]?.requirement||candidate.concerns?.[0]||'Verify personal ownership and the job requirements during screening.')}</p></div></div><div class="rf-workspace-columns"><div class="rf-card"><h3>Ask, then capture what you learn</h3><ol id="workspaceQuestions">${questions.map(q=>`<li>${escape(q)}</li>`).join('')}</ol><form id="workspaceNoteForm" class="rf-form"><label for="workspaceNote">Quick feedback for ${escape(candidate.short)}</label><textarea id="workspaceNote" maxlength="10000" required placeholder="Paste rough call notes or a short observation">${escape(notes.get(current)||'')}</textarea><p class="rf-sub">Save a brief note. AI prepares an updated assessment here for you to review.</p><button type="submit" class="rf-btn primary">Save quick feedback</button></form><div id="workspaceFeedback" aria-live="polite"></div></div><div class="rf-card"><h3>Prepare a submission</h3><p class="rf-sub">Review and edit the draft. Only include claims you can support. Saving this summary does not change scores.</p><label for="submissionDraft">Submission summary</label><textarea id="submissionDraft" maxlength="12000">${escape(drafts.get(current)??candidate.submissionDraft?.text??summary(candidate,job,all))}</textarea><div class="rf-actions"><button type="button" class="rf-btn primary" id="saveSubmissionDraft">Save summary</button><button type="button" class="rf-btn" id="workspaceCopy">Copy summary</button></div><p class="rf-sub" id="submissionDraftStatus">${drafts.has(current)?'Unsaved edits':candidate.submissionDraft?'Saved draft — review against the latest feedback.':'Generated draft — edit and save to keep it.'}</p><button type="button" class="rf-linkbtn" id="regenerateSubmission">Generate a fresh draft</button></div></div>`;
    const id=current;
    wrap.querySelector('#workspaceNote').addEventListener('input',e=>notes.set(id,e.target.value));
    wrap.querySelector('#workspaceNoteForm').addEventListener('submit',e=>{e.preventDefault();const text=wrap.querySelector('#workspaceNote').value.trim();if(!text)return;api.saveNote(candidate,text);notes.delete(id);wrap.querySelector('#workspaceNote').value='';refreshFeedback();});
    wrap.querySelector('#submissionDraft').addEventListener('input',e=>{drafts.set(id,e.target.value);wrap.querySelector('#submissionDraftStatus').textContent='Unsaved edits';});
    wrap.querySelector('#saveSubmissionDraft').addEventListener('click',()=>{const text=wrap.querySelector('#submissionDraft').value.trim();if(!text){api.toast('Add a summary before saving.','error');return}candidate.submissionDraft={text,updatedAt:Date.now()};drafts.delete(id);api.save();wrap.querySelector('#submissionDraftStatus').textContent='Summary captured — check the save indicator.';});
    wrap.querySelector('#workspaceCopy').addEventListener('click',copy);
    wrap.querySelector('#regenerateSubmission').addEventListener('click',()=>{if(!global.confirm('Replace the summary text with a fresh draft from the current evidence?'))return;const text=summary(candidate,job,api.feedback());drafts.set(id,text);wrap.querySelector('#submissionDraft').value=text;wrap.querySelector('#submissionDraftStatus').textContent='Unsaved fresh draft';});
    refreshFeedback();
  }
  function refreshFeedback(){
    if(!api||!current)return;const candidate=api.candidate(current),wrap=api.root.querySelector('#workspaceFeedback');if(!candidate||!wrap)return;
    renderEvaluation(candidate);
    const overview=api.root.querySelector('.rf-workspace-overview > div'),readiness=api.readiness(candidate);
    const stale=candidate.aiReview?.contextSignature&&candidate.aiReview.contextSignature!==api.signature(api.context(candidate));
    if(overview&&!global.AncalagonIntake?.pending(candidate)){
      overview.querySelector('h3').textContent=stale?'Review an outdated evaluation':readiness.label;
      overview.querySelector('p').textContent=stale?'The recorded context has changed since the last approved evaluation. Review a new proposal before relying on the score.':'Resolve the key uncertainty below, then review the evidence before submitting.';
    }
    refreshIntake();
    const all=api.feedback(),items=all.map((f,i)=>({f,i})).filter(x=>x.f.candidateId===current&&x.f.jobId===candidate.jobId).slice(-3).reverse();
    const outdated=candidate.aiReview?.contextSignature&&candidate.aiReview.contextSignature!==api.signature(api.context(candidate));
    wrap.innerHTML='<h4>What your feedback is teaching us</h4>'+(outdated?'<p class="rf-note">New context since the last approved evaluation. Review a fresh proposal; the score has not automatically changed.</p>':'')+ (items.map(({f,i})=>`<div class="rf-workspace-note"><p><strong>Original note:</strong> ${escape(f.text)}</p>${api.interpretationHTML(f,i)}<p class="rf-sub">${f.learningScope==='job'?'Shared preference: '+escape(f.signalStatus):'Applies to this candidate only'}</p><button type="button" class="rf-linkbtn" data-workspace-preference="${i}">Review as a reusable preference</button></div>`).join('')||'<p class="rf-sub">Your saved observations and interpretations will appear here.</p>');
    api.bindInterpretations(wrap);
    wrap.querySelectorAll('[data-workspace-preference]').forEach(b=>b.addEventListener('click',()=>api.editPreference(Number(b.dataset.workspacePreference))));
    const history=api.root.querySelector('#workspaceScoreHistory');
    const changes=candidate.aiReview?.history||[];
    history.innerHTML=changes.length?changes.slice(-3).reverse().map(h=>`<div class="rf-workspace-note"><strong>${Number(h.previousScore).toFixed(1)} → ${Number(h.newScore).toFixed(1)} Manager Fit</strong><p>${escape((h.reasons||[]).join(' '))}</p><span class="rf-sub">Approved ${escape(new Date(h.appliedAt).toLocaleString())}</span></div>`).join(''):'<p class="rf-sub">No approved AI re-evaluation changes yet. Saving a quick note does not automatically change the score.</p>';
  }
  function renderEvaluation(candidate){
    const wrap=api.root.querySelector('#workspaceEvaluation');if(!wrap)return;
    if(api.remoteEvaluation?.(candidate,wrap))return;
    const state=candidate.feedbackEvaluation,phase=api.evaluationPhase(candidate);wrap.hidden=!state;
    if(!state){wrap.innerHTML='';return;}
    const p=state.proposal,reviewable=api.canReview(candidate);
    if(['queued','running','saving'].includes(phase)){
      wrap.innerHTML=`<h3>${phase==='saving'?'Saving updated assessment…':'Updating assessment from your feedback…'}</h3><p class="rf-sub">You can keep working. The AI proposal will appear here for review.</p>`;return;
    }
    if(phase==='pending'&&reviewable){
      wrap.innerHTML=`<span class="rf-kicker">Ready for review</span><h3>Updated candidate assessment</h3><p><strong>Manager Fit: ${Number(p.currentScore).toFixed(1)} → ${Number(p.proposedScore).toFixed(1)} / 10</strong></p><p class="rf-sub">${escape(p.currentRecommendation)} → ${escape(p.proposedRecommendation)}</p><ul>${p.reasons.map(r=>`<li>${escape(r)}</li>`).join('')}</ul><p class="rf-sub">Based on the current job evidence and feedback. This AI proposal has not changed the candidate’s score.</p><div class="rf-actions"><button type="button" class="rf-btn primary" data-evaluation-action="apply">Approve assessment</button><button type="button" class="rf-btn" data-evaluation-action="ignore">Keep current assessment</button></div>`;
    }else if(phase==='error'){
      wrap.innerHTML=`<h3>Assessment needs another try</h3><p class="rf-sub">${escape(state.error)} Your feedback is retained; no AI score change was applied.</p><button type="button" class="rf-btn" data-evaluation-action="retry">Try again</button>`;
    }else if(phase==='pending'){
      wrap.innerHTML='<h3>New evidence since this proposal</h3><p class="rf-sub">The previous suggestion is out of date and cannot be applied.</p><button type="button" class="rf-btn" data-evaluation-action="retry">Prepare current assessment</button>';
    }else{
      wrap.innerHTML=`<p class="rf-sub">${phase==='applied'?'Assessment approved. The score and approval history are updated.':'Current assessment kept. Saving new feedback will prepare another proposal.'}</p>`;
    }
    wrap.querySelectorAll('[data-evaluation-action]').forEach(b=>b.addEventListener('click',()=>api.reviewEvaluation(candidate,b.dataset.evaluationAction)));
  }
  function refreshIntake(){
    if(!api||!current)return;const c=api.candidate(current);if(!c)return;
    api.intakeBrief?.(c,api.root.querySelector('#workspaceIntake'));
    if(c.resumeIntake?.brief?.screening_questions){
      const list=api.root.querySelector('#workspaceQuestions');if(list)list.innerHTML=c.resumeIntake.brief.screening_questions.map(q=>'<li>'+escape(q)+'</li>').join('');
    }
    if(c.resumeIntake?.phase==='ready'&&!drafts.has(c.id)&&!c.submissionDraft){const draft=api.root.querySelector('#submissionDraft');if(draft)draft.value=summary(c,api.job(),api.feedback());}
    const label=api.root.querySelector('label[for="workspaceNote"]');if(label)label.textContent='Quick feedback for '+c.short;
    const evidence=api.root.querySelector('.rf-workspace-overview > div:nth-child(2) p');if(evidence)evidence.textContent=c.strengths?.[0]||c.signal;
    const overview=api.root.querySelector('.rf-workspace-overview > div');
    if(overview&&global.AncalagonIntake?.pending(c)){
      const failed=c.resumeIntake.phase==='error',ready=c.resumeIntake.phase==='ready';
      overview.querySelector('h3').textContent=failed?'Retry the resume assessment':ready?'Review the screening brief':'Preparing the resume assessment';
      overview.querySelector('p').textContent=failed?'Use Try again above to continue with this candidate. No assessment scores have been applied.':ready?'Check the evidence and proposed assessment, then use the questions below in your screen.':'You can keep working while the screening brief is prepared.';
      if(evidence&&!ready)evidence.textContent=failed?'Assessment unavailable. Resume evidence has not been confirmed.':'Resume evidence is being checked.';
    }
  }
  function refreshEvaluation(){if(!api||!current)return;const candidate=api.candidate(current);if(candidate)renderEvaluation(candidate);}
  async function copy(){const area=api.root.querySelector('#submissionDraft');if(!area)return;try{await navigator.clipboard.writeText(area.value);api.toast('Edited submission summary copied.');}catch{area.focus();area.select();api.toast('Select and copy the summary using your browser.','error');}}
  const methods={init:options=>{api=options;},render,refreshFeedback,refreshEvaluation,refreshIntake,hasDrafts:pending,copy,summary};
  if(typeof module!=='undefined')module.exports=methods;global.AncalagonWorkspace=methods;
})(typeof window!=='undefined'?window:globalThis);


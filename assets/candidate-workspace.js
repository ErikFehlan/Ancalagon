(function(global){
  'use strict';
  const drafts=new Map();let api,current=null,currentCandidate=null,quickNotes;
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Presentation only: keep the stored candidate identity and exact source text intact.
  function displayName(candidate){
    const name=String(candidate.short||candidate.name||'Candidate');
    const stem=String(candidate.resumeIntake?.fileName||'').replace(/\.[^.]+$/,'');
    if(name!==stem&&!name.includes('_'))return name;
    return name.replace(/_/g,' ').replace(/\.(?:pdf|docx?)$/i,'').replace(/\s+(?:resume|cv)$/i,'').replace(/\s+/g,' ').trim()||name;
  }
  function evidenceFor(candidate){
    const text=String(candidate.strengths?.[0]||candidate.signal||'No supporting evidence recorded yet.');
    const marker=' — Resume: “',start=text.indexOf(marker);
    if(start<0||!text.endsWith('”'))return {claim:text,quote:''};
    return {claim:text.slice(0,start),quote:text.slice(start+marker.length,-1)};
  }
  function fitHTML(candidate){
    return [['JD Fit',candidate.jdScore],['Manager Fit',candidate.managerScore]].map(([label,value])=>
      `<div class="rf-brief-score"><span>${label}</span><strong>${Number.isFinite(value)?value.toFixed(1):'—'}<small> / 10</small></strong></div>`).join('');
  }
  function summary(candidate,job,feedback){
    const observations=feedback.filter(f=>f.jobId===job.id&&f.candidateId===candidate.id).slice(-3);
    return `${candidate.short} — ${candidate.role||'Candidate'}\nSearch: ${job.title}\n\nProfile evidence to review:\n${(candidate.strengths||[]).slice(0,3).map(x=>'• '+x).join('\n')||'No supporting examples recorded.'}\n\nRecruiter / manager observations:\n${observations.map(f=>'• '+f.text).join('\n')||'No observations recorded.'}\n\nQuestions to resolve:\n${(candidate.concerns||[]).slice(0,3).map(x=>'• '+x).join('\n')||'Confirm the job requirements and personal contribution during screening.'}`;
  }
  function pending(){return !!quickNotes?.pending()||drafts.size>0;}
  function noteStatus(candidate){
    if(current!==candidate.id||!api)return;
    const state=quickNotes.entry(candidate),status=api.root.querySelector('#workspaceNoteStatus');if(!status)return;
    status.textContent=state.status==='error'?'Not saved — '+state.error:state.status==='saving'?'Saving feedback…':state.status==='editing'?'Waiting for a pause to save…':state.savedText?(state.text.trim()?'Saved · assessment updates automatically':'Saved note kept in feedback history.'):'Saves automatically.';
    status.dataset.state=state.status;
    const retry=api.root.querySelector('#retryQuickNote');if(retry)retry.hidden=state.status!=='error';
  }
  function questionsFor(candidate){
    const proposed=api.reviewQuestions?.(candidate)||[],intake=candidate.resumeIntake?.phase==='ready'?candidate.resumeIntake.brief?.screening_questions:[];
    const questions=proposed.length?proposed:intake?.length?intake:candidate.screeningQuestions?.length?candidate.screeningQuestions:api.questions(candidate);
    return [...new Set(questions?.length?questions:['Which parts of this work did you personally own?'])].slice(0,3);
  }
  function render(candidate){
    if(!candidate||!api)return;
    if(current===candidate.id&&api.root.querySelector('#candidateWorkspace').dataset.workspaceCandidate===candidate.id){currentCandidate=candidate;refreshFeedback();noteStatus(candidate);return;}
    if(current&&current!==candidate.id){const previous=currentCandidate;if(previous)void quickNotes.flush(previous);}
    current=candidate.id;currentCandidate=candidate;const job=api.job(),all=api.feedback(),readiness=api.readiness(candidate);
    const questions=questionsFor(candidate);
    const wrap=api.root.querySelector('#candidateWorkspace'),note=quickNotes.entry(candidate);
    wrap.dataset.workspaceCandidate=candidate.id;
    wrap.innerHTML=`<div class="rf-assessment-region"><div id="workspaceIntake" class="rf-card rf-intake-brief" hidden></div><div id="workspaceEvaluation" class="rf-card" aria-live="polite" hidden></div>
      <section class="rf-card rf-workspace-overview" aria-labelledby="workspaceBriefTitle"><div class="rf-brief-heading"><div><span class="rf-kicker">Screening brief</span><h3 id="workspaceBriefTitle">${escape(readiness.label)}</h3><p class="rf-sub"></p></div><div id="workspaceFit" class="rf-brief-fit" aria-label="Assessment scores"></div></div><div class="rf-brief-evidence"><h4>Strongest evidence</h4><p id="workspaceEvidence"></p><details id="workspaceSource" class="rf-source-details" hidden><summary>View resume excerpt</summary><blockquote id="workspaceSourceQuote"></blockquote></details></div><div class="rf-brief-uncertainty"><h4>What to verify</h4><p id="workspaceUncertainty"></p></div></section></div>
      <div class="rf-card rf-screening-work"><div class="rf-workspace-columns"><form id="workspaceNoteForm" class="rf-form"><label for="workspaceNote">Screening notes</label><textarea id="workspaceNote" maxlength="10000" placeholder="What did you learn about their skills, ownership, or working style?">${escape(note.text)}</textarea><div class="rf-note-controls"><p id="workspaceNoteStatus" class="rf-sub" role="status"></p><button type="button" class="rf-linkbtn" id="newQuickNote">New note</button><button type="submit" class="rf-btn" id="retryQuickNote" hidden>Retry save</button></div></form><div class="rf-screen-questions"><h3>Ask in your screen</h3><ol id="workspaceQuestions">${questions.map(q=>`<li>${escape(q)}</li>`).join('')}</ol></div></div><details class="rf-feedback-history"><summary>Saved notes &amp; AI insights</summary><div id="workspaceFeedback" aria-live="polite"></div></details></div>
      <details id="workspaceSubmission" class="rf-card rf-workspace-details rf-submission-tools"><summary>Prepare a submission</summary><p class="rf-sub">Edit the draft and check its claims against the evidence before sharing.</p><label for="submissionDraft">Submission summary</label><textarea id="submissionDraft" maxlength="12000">${escape(drafts.get(current)??candidate.submissionDraft?.text??summary(candidate,job,all))}</textarea><div class="rf-actions"><button type="button" class="rf-btn primary" id="saveSubmissionDraft">Save summary</button><button type="button" class="rf-btn" id="workspaceCopy">Copy summary</button><button type="button" class="rf-linkbtn" id="regenerateSubmission">Generate a fresh draft</button></div><p class="rf-sub" id="submissionDraftStatus">${drafts.has(current)?'Unsaved edits':candidate.submissionDraft?'Saved draft — review against the latest feedback.':'Generated draft — edit and save to keep it.'}</p></details>`;
    const id=current,area=wrap.querySelector('#workspaceNote');
    area.addEventListener('input',e=>quickNotes.edit(candidate,e.target.value));
    area.addEventListener('blur',()=>void quickNotes.flush(candidate));
    wrap.querySelector('#workspaceNoteForm').addEventListener('submit',e=>{e.preventDefault();void quickNotes.flush(candidate);});
    wrap.querySelector('#newQuickNote').addEventListener('click',async()=>{if(await quickNotes.fresh(candidate)&&current===id){area.value='';area.focus();}});
    wrap.querySelector('#submissionDraft').addEventListener('input',e=>{drafts.set(id,e.target.value);wrap.querySelector('#submissionDraftStatus').textContent='Unsaved edits';});
    wrap.querySelector('#saveSubmissionDraft').addEventListener('click',()=>{const text=wrap.querySelector('#submissionDraft').value.trim();if(!text){api.toast('Add a summary before saving.','error');return;}candidate.submissionDraft={text,updatedAt:Date.now()};drafts.delete(id);api.save();wrap.querySelector('#submissionDraftStatus').textContent='Summary captured — check the save indicator.';});
    wrap.querySelector('#workspaceCopy').addEventListener('click',copy);
    wrap.querySelector('#regenerateSubmission').addEventListener('click',()=>{if(!global.confirm('Replace the summary text with a fresh draft from the current evidence?'))return;const text=summary(candidate,job,api.feedback());drafts.set(id,text);wrap.querySelector('#submissionDraft').value=text;wrap.querySelector('#submissionDraftStatus').textContent='Unsaved fresh draft';});
    refreshFeedback();noteStatus(candidate);
  }
  function preserve(change){
    const region=api?.root.querySelector('.rf-assessment-region');
    // A shorter status panel cannot be offset by scrolling when the page is at the top.
    // Keep the reserved space for this visit so clicking away from notes cannot move the target.
    if(region&&global.document?.activeElement===api.root.querySelector('#workspaceNote'))region.style.minHeight=region.getBoundingClientRect().height+'px';
    return global.AncalagonFocus?global.AncalagonFocus.preserveEditing(api?.root,change):change();
  }
  function refreshFeedback(){return preserve(refreshFeedbackContent);}
  function refreshFeedbackContent(){
    if(!api||!current)return;const candidate=api.candidate(current),wrap=api.root.querySelector('#workspaceFeedback');if(!candidate||!wrap)return;
    renderEvaluation(candidate);
    const overview=api.root.querySelector('.rf-workspace-overview > div'),readiness=api.readiness(candidate);
    const stale=candidate.aiReview?.contextSignature&&candidate.aiReview.contextSignature!==api.signature(api.context(candidate));
    if(overview&&!global.AncalagonIntake?.pending(candidate)){
      overview.querySelector('h3').textContent=stale?'Review an outdated evaluation':readiness.label;
      overview.querySelector('p').textContent=stale?'The recorded context has changed since the last approved evaluation. Review a new proposal before relying on the score.':'Review the evidence and confirm any open questions before submitting.';
    }
    refreshIntake();
    const all=api.feedback(),items=all.map((f,i)=>({f,i})).filter(x=>x.f.candidateId===current&&x.f.jobId===candidate.jobId).slice(-3).reverse();
    const outdated=candidate.aiReview?.contextSignature&&candidate.aiReview.contextSignature!==api.signature(api.context(candidate));
    const feedbackHTML=(outdated?'<p class="rf-note">New context since the last approved evaluation. Review a fresh proposal; the score has not automatically changed.</p>':'')+ (items.map(({f,i})=>`<div class="rf-workspace-note"><p><strong>Original note:</strong> ${escape(f.text)}</p>${api.interpretationHTML(f,i)}<p class="rf-sub">${f.learningScope==='job'?'Shared preference: '+escape(f.signalStatus):'Applies to this candidate only'}</p><button type="button" class="rf-linkbtn" data-workspace-preference="${i}">Review as a reusable preference</button></div>`).join('')||'<p class="rf-sub">Your saved observations and interpretations will appear here.</p>');
    const bind=()=>{api.bindInterpretations(wrap);wrap.querySelectorAll('[data-workspace-preference]').forEach(b=>b.addEventListener('click',()=>api.editPreference(Number(b.dataset.workspacePreference))));};
    if(global.AncalagonFocus)global.AncalagonFocus.updatePanel(wrap,feedbackHTML,bind);else{wrap.innerHTML=feedbackHTML;bind();}
    const history=api.root.querySelector('#workspaceScoreHistory');
    const changes=candidate.aiReview?.history||[];
    if(history)history.innerHTML=changes.length?changes.slice(-3).reverse().map(h=>`<div class="rf-workspace-note"><strong>${Number(h.previousScore).toFixed(1)} → ${Number(h.newScore).toFixed(1)} Manager Fit</strong><p>${escape((h.reasons||[]).join(' '))}</p><span class="rf-sub">Approved ${escape(api.formatDate?api.formatDate(h.appliedAt):new Date(h.appliedAt).toLocaleString())}</span></div>`).join(''):'<p class="rf-sub">No approved AI re-evaluation changes yet. Saving a quick note does not automatically change the score.</p>';
  }
  function renderEvaluation(candidate){
    const wrap=api.root.querySelector('#workspaceEvaluation');if(!wrap)return;
    if(api.remoteEvaluation?.(candidate,wrap))return;
    const state=candidate.feedbackEvaluation,phase=api.evaluationPhase(candidate);
    wrap.hidden=!state||['applied','ignored'].includes(phase);if(wrap.hidden)return;
    const p=state.proposal,reviewable=api.canReview(candidate);let html;
    if(['queued','running','saving'].includes(phase)){
      html=`<h3>${phase==='saving'?'Saving updated assessment…':'Updating assessment from your feedback…'}</h3><p class="rf-sub">You can keep working. The AI proposal will appear here for review.</p>`;
    }else if(phase==='pending'&&reviewable){
      html=`<span class="rf-kicker">Ready for review</span><h3>Updated candidate assessment</h3><p><strong>Manager Fit: ${Number(p.currentScore).toFixed(1)} → ${Number(p.proposedScore).toFixed(1)} / 10</strong></p><p class="rf-sub">${escape(p.currentRecommendation)} → ${escape(p.proposedRecommendation)}</p><ul>${p.reasons.map(r=>`<li>${escape(r)}</li>`).join('')}</ul><p class="rf-sub">Review this proposal before applying it.</p><div class="rf-actions"><button type="button" class="rf-btn primary" data-evaluation-action="apply-next">Approve &amp; next</button><button type="button" class="rf-btn" data-evaluation-action="apply">Approve assessment</button><button type="button" class="rf-btn" data-evaluation-action="ignore">Keep current assessment</button></div>`;
    }else if(phase==='error'){
      html=`<h3>Assessment needs another try</h3><p class="rf-sub">${escape(state.error)} Your feedback is retained; no AI score change was applied.</p><button type="button" class="rf-btn" data-evaluation-action="retry">Try again</button>`;
    }else if(phase==='pending'){
      html='<h3>New evidence since this proposal</h3><p class="rf-sub">The previous suggestion is out of date and cannot be applied.</p><button type="button" class="rf-btn" data-evaluation-action="retry">Prepare current assessment</button>';
    }else{html='<p class="rf-sub">Current assessment kept. New feedback will prepare another proposal.</p>';}
    const bind=()=>wrap.querySelectorAll('[data-evaluation-action]').forEach(b=>b.addEventListener('click',()=>api.reviewEvaluation(candidate,b.dataset.evaluationAction)));
    if(global.AncalagonFocus)global.AncalagonFocus.updatePanel(wrap,html,bind);else{wrap.innerHTML=html;bind();}
  }
  function refreshIntake(){return preserve(refreshIntakeContent);}
  function refreshIntakeContent(){
    if(!api||!current)return;const c=api.candidate(current);if(!c)return;
    api.intakeBrief?.(c,api.root.querySelector('#workspaceIntake'));
    const list=api.root.querySelector('#workspaceQuestions');if(list)list.innerHTML=questionsFor(c).map(q=>'<li>'+escape(q)+'</li>').join('');
    if(c.resumeIntake?.phase==='ready'&&!drafts.has(c.id)&&!c.submissionDraft){const draft=api.root.querySelector('#submissionDraft');if(draft)draft.value=summary(c,api.job(),api.feedback());}
    const proof=evidenceFor(c),evidence=api.root.querySelector('#workspaceEvidence');if(evidence)evidence.textContent=proof.claim;
    const source=api.root.querySelector('#workspaceSource'),quote=api.root.querySelector('#workspaceSourceQuote');
    if(source)source.hidden=!proof.quote;if(quote)quote.textContent=proof.quote;
    const readiness=api.readiness(c),uncertainty=api.root.querySelector('#workspaceUncertainty');
    if(uncertainty)uncertainty.textContent=readiness.knockouts[0]?.requirement||readiness.mustGaps[0]?.requirement||c.concerns?.[0]||'Confirm personal ownership and the job requirements.';
    const overview=api.root.querySelector('.rf-workspace-overview > div');
    const fit=api.root.querySelector('#workspaceFit');if(fit)fit.innerHTML=global.AncalagonIntake?.pending(c)?'':fitHTML(c);
    const card=api.root.querySelector('.rf-workspace-overview');if(card)card.hidden=!api.root.querySelector('#workspaceIntake').hidden||!api.root.querySelector('#workspaceEvaluation').hidden;
    if(overview&&global.AncalagonIntake?.pending(c)){
      const failed=c.resumeIntake.phase==='error',ready=c.resumeIntake.phase==='ready';
      overview.querySelector('h3').textContent=failed?'Retry the resume assessment':ready?'Review the screening brief':'Preparing the resume assessment';
      overview.querySelector('p').textContent=failed?'Use Try again above to continue with this candidate. No assessment scores have been applied.':ready?'Check the evidence and proposed assessment, then use the questions below in your screen.':'You can keep working while the screening brief is prepared.';
      if(evidence&&!ready)evidence.textContent=failed?'Assessment unavailable. Resume evidence has not been confirmed.':'Resume evidence is being checked.';
    }
  }
  function refreshEvaluation(){if(!api||!current)return;return preserve(()=>{const candidate=api.candidate(current);if(candidate){renderEvaluation(candidate);refreshIntake();}});}
  async function copy(){const area=api.root.querySelector('#submissionDraft');if(!area)return;try{await navigator.clipboard.writeText(area.value);api.toast('Edited submission summary copied.');}catch{area.focus();area.select();api.toast('Select and copy the summary using your browser.','error');}}
  async function beforeReview(candidate){
    if(!quickNotes?.pending(candidate.id))return true;
    const saved=await quickNotes.flush(candidate);
    api.toast(saved?'Feedback saved. Review the updated assessment when it is ready.':'Save your feedback before approving this assessment.',saved?'info':'error');return false;
  }
  function leave(){const candidate=currentCandidate;if(candidate)void quickNotes.flush(candidate);}
  const methods={init:options=>{api=options;quickNotes=global.AncalagonQuickNotes.create({id:api.noteId,valid:api.validCandidate,save:api.saveNote,changed:noteStatus});},leave,beforeReview,flushNotes:()=>quickNotes?.flushAll(),hasPendingNotes:id=>quickNotes?.pending(id),render,refreshFeedback,refreshEvaluation,refreshIntake,hasDrafts:pending,copy,summary,displayName,evidenceFor};
  if(typeof module!=='undefined')module.exports=methods;global.AncalagonWorkspace=methods;
})(typeof window!=='undefined'?window:globalThis);


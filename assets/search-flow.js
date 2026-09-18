(function(global){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function next({job,candidates=[],selected=null,canReview=()=>false,uploads=[]}){
  const result=(step,action,label,text,candidate=null)=>({step,action,label,text,candidateId:candidate?.id||null});
  if(!job)return result(0,'start','Start a search','Add a job description to begin.');
  if(job.status==='closed')return result(0,'jobs','Choose an open search','This search is closed. Your work is still available.');
  if(!job.description?.trim())return result(0,'setup','Finish job setup','Add the requirements before assessing candidates.');
  const list=candidates.filter(c=>c.jobId===job.id&&!['Rejected','Withdrew','Hired'].includes(c.stage));
  const pending=c=>!!c.resumeIntake&&!c.resumeIntake.reviewedAt&&!c.aiReview;
  const phase=c=>pending(c)?c.resumeIntake.phase||c.resumeIntake.status||'queued':c.feedbackEvaluation?.status;
  const ready=c=>canReview(c)||phase(c)==='ready'||(!pending(c)&&!c.aiReview);
  const working=c=>['uploading','queued','processing'].includes(phase(c));
  const failed=c=>['error','failed'].includes(phase(c));
  const chosen=list.find(c=>c.id===selected?.id);
  const review=chosen&&ready(chosen)?chosen:list.find(ready);
  if(review)return result(2,'review','Review candidate','Check the evidence and approve or correct the assessment.',review);
  const issue=list.find(failed);
  if(issue)return result(2,'review','Resolve assessment issue','Open the candidate to retry or correct the issue.',issue);
  const uploadIssue=uploads.some(i=>i.jobId===job.id&&i.state==='error');
  if(uploadIssue)return result(1,'uploads','Resolve upload issue','Retry the failed file in Resume uploads.');
  const eligible=list.filter(c=>!pending(c)&&!working(c)&&!failed(c)&&!!c.aiReview);
  const draft=chosen&&eligible.includes(chosen)?chosen:eligible.find(c=>!c.submissionDraft?.text?.trim())||eligible[0];
  if(draft)return result(3,'submittal',draft.submissionDraft?.text?.trim()?'Open submittal':'Prepare submittal','Review the client pitch, save it, and copy it when ready. Nothing is sent automatically.',draft);
  if(list.some(working)||uploads.some(i=>i.jobId===job.id&&['waiting','reading','saving'].includes(i.state)))return result(2,'progress','View processing status','Assessments are preparing. You can upload more resumes while you wait.');
  return result(1,'upload','Upload resumes','Add resumes to prepare your first candidate review.');
 }
 function markup(s,current=next(s)){
  return `<div class="rf-search-flow-top"><div><span class="rf-search-flow-eyebrow">${esc(s.job?.title||'Your next search')}</span><p>${esc(current.text)}</p></div><div class="rf-actions"><button type="button" class="rf-btn primary" data-search-action="next">${esc(current.label)} →</button>${s.job&&s.showStart!==false?'<button type="button" class="rf-linkbtn" data-search-action="start">Start another search</button>':''}</div></div><ol aria-label="Search workflow">${['Set up job','Upload resumes','Review candidates','Prepare submittal'].map((label,i)=>`<li ${i===current.step?'aria-current="step"':''}><span>${i+1}</span>${label}</li>`).join('')}</ol>`;
 }
 function mount({host,state,act}){
  let current;
  host.addEventListener('click',event=>{const button=event.target.closest('[data-search-action]');if(!button)return;const fresh=next(state());act(button.dataset.searchAction==='next'?fresh.action:button.dataset.searchAction,fresh);});
  function render(){const s=state();host.hidden=!s.visible;if(host.hidden)return;current=next(s);
   const html=markup(s,current);
   if(host.dataset.markup!==html){const focused=host.contains(global.document.activeElement)?global.document.activeElement.dataset.searchAction:null;host.innerHTML=html;host.dataset.markup=html;if(focused)host.querySelector(`[data-search-action="${focused}"]`)?.focus({preventScroll:true});}
  }
  return {render};
 }
 const api={next,markup,mount};if(typeof module!=='undefined')module.exports=api;global.AncalagonSearchFlow=api;
})(typeof window==='undefined'?globalThis:window);

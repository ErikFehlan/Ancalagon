(function(global){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const pending=c=>!!c.resumeIntake&&!c.resumeIntake.reviewedAt&&!c.aiReview;
 function phase(c){
  if(pending(c))return c.resumeIntake.phase||c.resumeIntake.status||'queued';
  return c.feedbackEvaluation?.status==='ready'?'ready':'reviewed';
 }
 function queue(candidates,job,canReview=()=>false){
  const list=job?.status==='closed'?[]:candidates.filter(c=>c.jobId===job?.id);
  return {ready:list.filter(c=>phase(c)==='ready'||canReview(c)),
   working:list.filter(c=>['uploading','queued','processing'].includes(phase(c))),
   attention:list.filter(c=>['error','failed'].includes(phase(c)))};
 }
 function jobList(jobs,filter='active',search=''){
  const query=search.trim().toLowerCase();
  return jobs.filter(j=>(filter==='all'||(filter==='closed')===(j.status==='closed'))&&[j.title,j.client].some(s=>String(s||'').toLowerCase().includes(query)));
 }
 // Only reading and saving are serialized. Each saved document is handed to the
 // durable server queue immediately; one bad file never blocks the next one.
 function createBatch(api){
  const items=[];let sequence=0,running=false;
  const changed=()=>api.changed?.();
  function add(files){
   const selected=Array.from(files||[]),job=api.job();
   if(!job||job.status==='closed'){api.toast('Choose an open job before uploading resumes.','error');return false;}
   const retained=items.filter(i=>i.file);
   if(selected.length+retained.length>20||selected.reduce((n,f)=>n+f.size,0)+retained.reduce((n,i)=>n+i.file.size,0)>100*1024*1024){api.toast('Choose up to 20 resumes (100 MB total). Let the current uploads finish before adding more.','error');return false;}
   // Keep a bounded session history. Durable progress is rebuilt from candidates.
   while(items.length+selected.length>60){const old=items.findIndex(i=>!i.file);if(old<0)break;items.splice(old,1);}
   const open=selected.length===1&&!running&&!retained.length;
   for(const file of selected)items.push({id:String(++sequence),file,fileName:file.name,jobId:job.id,jobTitle:job.title,workspaceId:api.workspace(),state:'waiting',open});
   changed();void drain();return true;
  }
  async function drain(){
   if(running)return;running=true;
   try{for(let item; (item=items.find(i=>i.state==='waiting'));){
    item.state='reading';changed();
    try{
     if(api.workspace()!==item.workspaceId)throw Error('Your account changed. Select the resumes in the current workspace.');
     const c=await api.upload(item.file,{jobId:item.jobId,workspaceId:item.workspaceId,silent:true,open:item.open,
      progress:state=>{item.state=state;changed();},candidate:(c,duplicate)=>{item.candidateId=c.id;item.duplicate=duplicate;}});
     if(!c)throw Error('The upload did not finish. Try again.');
     if(item.duplicate&&item.open)api.toast('This resume is already attached to '+(c.short||c.name||'this candidate')+'.');
     item.state='saved';item.error='';item.file=null;changed();
    }catch(e){item.state='error';item.error=e.message||'Upload could not finish.';changed();}
   }}finally{running=false;changed();}
  }
  function retry(id){const i=items.find(x=>x.id===id);if(!i||i.state!=='error'||!i.file)return;i.state='waiting';i.error='';i.open=false;changed();void drain();}
  function dismiss(id){const i=items.find(x=>x.id===id);if(!i||!['waiting','error','saved'].includes(i.state))return;items.splice(items.indexOf(i),1);if(i.candidateId&&!items.some(x=>x.candidateId===i.candidateId&&x.file))api.release?.(i.candidateId);i.file=null;changed();}
  function view(){return items.map(({file,...i})=>({...i,retained:!!file}));}
  return {add,retry,dismiss,view,hasUnsaved:()=>items.some(i=>!!i.file)};
 }
 function renderBatch(host,items,currentJob){
  if(!host)return;host.hidden=!items.length;if(host.hidden)return;
  const active=items.filter(i=>['waiting','reading','saving'].includes(i.state)),errors=items.filter(i=>i.state==='error'),saved=items.filter(i=>i.state==='saved');
  const summary=active.length?`${saved.length} of ${items.length} files saved · ${active.length} uploading`:errors.length?`${errors.length} upload${errors.length===1?'':'s'} need attention`:`${saved.length} file${saved.length===1?'':'s'} saved`;
  const labels={waiting:'Waiting to upload',reading:'Reading resume…',saving:'Saving resume…',saved:'Resume saved',error:'Upload needs attention'};
  const rows=items.map(i=>`<div class="rf-upload-row"><div><strong>${esc(i.fileName)}</strong><small>${i.jobId!==currentJob?esc(i.jobTitle)+' · ':''}${i.duplicate&&i.state==='saved'?'Already attached · no duplicate created':labels[i.state]}</small>${i.error?`<p class="rf-upload-error">${esc(i.error)}</p>`:''}</div><div class="rf-actions">${i.state==='error'?`<button type="button" class="rf-btn" data-batch-retry="${i.id}">Retry</button>`:''}${['waiting','error'].includes(i.state)?`<button type="button" class="rf-linkbtn" data-batch-dismiss="${i.id}">Remove from upload queue</button>`:''}</div></div>`).join('');
  const html=`<summary><strong>Resume uploads</strong><span role="status">${summary}</span></summary><div class="rf-batch-body"><p class="rf-sub">${active.length||errors.length?'Keep this tab open until each file is saved. Removing a file from this queue keeps any candidate already created.':'Your resumes are saved. You can close this tab while assessments finish.'}</p>${rows}</div>`;
  if(host.dataset.markup!==html){
   const focused=host.contains(global.document?.activeElement)?{...global.document.activeElement.dataset}:null;
   host.innerHTML=html;host.dataset.markup=html;
   if(focused)for(const key of ['batchRetry','batchDismiss'])if(focused[key]){
    const button=[...host.querySelectorAll('button')].find(b=>b.dataset[key]===focused[key]);
    (button||host.querySelector('summary'))?.focus({preventScroll:true});break;
   }
  }
  if(errors.length&&!host.dataset.hadError)host.open=true;host.dataset.hadError=errors.length?'yes':'';
 }
 const api={createBatch,phase,queue,jobList,renderBatch};if(typeof module!=='undefined')module.exports=api;global.AncalagonRecruiter=api;
})(typeof window==='undefined'?globalThis:window);

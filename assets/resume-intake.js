(function(global){
  'use strict';
  const normalize=s=>String(s||'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pending=c=>!!c?.resumeIntake&&!c.resumeIntake.reviewedAt&&!c.aiReview;
  const strings=(a,max,len)=>Array.isArray(a)&&a.length<=max&&a.every(s=>typeof s==='string'&&s.trim()&&s.length<=len);
  // Keep content identity normalization unchanged: existing uploaded resumes use it.
  // This separate index ignores only typography and maps matches back to the actual
  // source. Never remove words, negation, numbers, or join noncontiguous passages.
  function quoteIndex(text){
    let value='',offset=0;const starts=[],ends=[];
    for(const char of String(text||'')){
      const start=offset;offset+=char.length;
      const clean=char.normalize('NFKC').toLowerCase()
        .replace(/[\u00ad\u200b\ufeff]/g,'').replace(/[\u2010-\u2015]/g,'-')
        .replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"')
        .replace(/[\u2022\u25cf\u25aa]/g,' ');
      for(const c of clean.split('')){
        if(/\s/.test(c)){
          if(!value||value.endsWith(' ')){if(value)ends[ends.length-1]=offset;continue;}
          value+=' ';
        }else value+=c;
        starts.push(start);ends.push(offset);
      }
    }
    if(value.endsWith(' ')){value=value.slice(0,-1);starts.pop();ends.pop();}
    return {value,starts,ends};
  }
  function sourceQuote(text,quote,index=quoteIndex(text)){
    const needle=quoteIndex(quote).value,at=needle?index.value.indexOf(needle):-1;
    return at<0?null:String(text).slice(index.starts[at],index.ends[at+needle.length-1]);
  }
  function invalid(code){const e=new Error('The AI response could not be verified against this resume. Try the assessment again.');e.code=code;throw e;}
  function validate(a,text){
    const source=normalize(text);
    if(!a||!['score','manager_score'].every(k=>typeof a[k]==='number'&&Number.isFinite(a[k])&&a[k]>=0&&a[k]<=10))invalid('invalid_score');
    if(!['name','role','primary_signal','jd_reason','manager_reason'].every(k=>typeof a[k]==='string'&&a[k].trim()&&a[k].length<=2000))invalid('invalid_profile');
    if(!strings(a.concerns,6,800))invalid('invalid_concerns');
    if(!strings(a.screening_questions,3,600))invalid('invalid_questions');
    if(!strings(a.tags,8,100))invalid('invalid_tags');
    if(!Array.isArray(a.resume_evidence)||a.resume_evidence.length>5)invalid('invalid_evidence');
    const index=quoteIndex(text),evidence=a.resume_evidence.map(e=>{
      if(!e||typeof e.claim!=='string'||!e.claim.trim()||e.claim.length>800||typeof e.quote!=='string'||e.quote.trim().length<12||e.quote.length>1000)invalid('invalid_evidence');
      const quote=sourceQuote(text,e.quote,index);
      if(!quote)invalid('unmatched_quote');
      if(quote.length>1000)invalid('invalid_evidence');
      return {claim:e.claim,quote};
    });
    if(!evidence.length&&(a.score>0||a.manager_score>0))invalid('unsupported_score');
    return {...a,name:source.includes(normalize(a.name))?a.name:'Candidate',role:source.includes(normalize(a.role))?a.role:'Role not stated',
      score:Math.round(a.score*10)/10,manager_score:Math.round(a.manager_score*10)/10,
      resume_evidence:evidence,tags:a.tags.filter(t=>source.includes(normalize(t)))};
  }
  async function hash(text){const bytes=await global.crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalize(text)));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');}
  async function identity(workspace,jobId,text){const contentHash=await hash(text),key=await hash(workspace+'|'+jobId+'|'+contentHash);return {hash:contentHash,id:key.slice(0,8)+'-'+key.slice(8,12)+'-5'+key.slice(13,16)+'-a'+key.slice(17,20)+'-'+key.slice(20,32)};}
  function create(api){
    const files=new Map(),queue=new Set(),reviewing=new Set();let running=false,extracting=false;
    const valid=c=>api.candidates().includes(c)&&!!api.job(c.jobId)&&api.job(c.jobId).status!=='closed';
    const context=c=>api.context(c);
    const remote=api.requestRemote?global.AncalagonRemoteIntake.create({...api,valid,changed:c=>changed(c)}):null;
    const useRemote=()=>!!remote&&(!api.remoteAvailable||api.remoteAvailable());
    const changed=c=>{api.changed(c);render();};
    function set(c,phase,error=''){Object.assign(c.resumeIntake,{phase,error,updatedAt:Date.now()});changed(c);}
    async function upload(file,options={}){
      const job=api.job(options.jobId),workspace=options.workspaceId||api.workspace();
      const fail=message=>{if(options.silent)throw Error(message);api.toast(message,'error');};
      if(extracting){fail('The current resume is still being read.');return;}
      if(workspace!==api.workspace()||!job||job.status==='closed'){fail('Choose an open job before adding a resume.');return;}
      if(!file||! /\.(pdf|docx|txt)$/i.test(file.name)||file.size>10*1024*1024){fail('Choose a PDF, DOCX, or TXT resume up to 10 MB.');return;}
      const jobId=job.id;extracting=true;options.progress?.('reading');status('Reading '+file.name+'…');
      let candidate;
      try{
        const extracted=await api.extract(file,status);
        const text=typeof extracted==='string'?extracted:extracted.text;
        if(!text.trim()||text.trim().length<40)throw Error('No usable resume text was found. Try a text-based PDF, DOCX, or TXT file.');
        if(text.length>120000)throw Error('This resume is too long to assess in full. Upload a shorter resume.');
        const check=()=>{if(workspace!==api.workspace()||!api.job(jobId)||api.job(jobId).status==='closed')throw Error('The selected job was closed or removed. Reopen it before retrying.');};
        check();const key=await identity(workspace,jobId,text),keys=[key];
        // Recognize files uploaded before the PDF word-boundary fix as the same candidate.
        if(typeof extracted?.legacyText==='string'&&extracted.legacyText!==text)keys.push(await identity(workspace,jobId,extracted.legacyText));
        check();
        const existing=api.candidates().find(c=>c.jobId===jobId&&keys.some(k=>c.id===k.id||c.resumeIntake?.hash===k.hash));
        if(existing){options.candidate?.(existing,true);if(!existing.resumeIntake?.stored&&existing.resumeIntake){files.set(existing.id,{file,text});await storeDocument(existing);enqueue(existing);}else if(existing.resumeIntake?.phase==='error')await retry(existing);if(!options.silent)api.toast('This resume is already attached to '+existing.short+'.');if(options.open!==false)api.open(existing,true);return existing;}
        const now=Date.now();
        candidate=api.add({id:key.id,jobId,name:file.name.replace(/\.[^.]+$/,'').slice(0,160),role:'Resume awaiting analysis',score:0,jdScore:0,resumeJDScore:0,managerScore:0,originalManagerScore:0,rec:'Screen First',signal:'Preparing a screening brief.',strengths:[],concerns:[],tags:[],screeningQuestions:[],stage:'Sourced',createdAt:now,updatedAt:now,resumeIntake:{backend:useRemote()?'durable-v1':undefined,hash:key.hash,fileName:file.name,phase:'uploading',updatedAt:now}});
        options.candidate?.(candidate,false);options.progress?.('saving');files.set(candidate.id,{file,text});changed(candidate);
        await api.persist();
        check();
        await storeDocument(candidate);
        check();if(!valid(candidate))throw Error('This candidate was removed during upload.');
        if(!options.silent)api.toast('Candidate created. Preparing the screening brief.');
        if(options.open!==false)api.open(candidate);enqueue(candidate);return candidate;
      }catch(e){
        if(candidate&&valid(candidate)){set(candidate,'error',e.message||'Resume intake could not finish.');try{await api.persist();}catch{}}
        if(options.silent)throw e;api.toast(e.message||'Resume intake could not finish.','error');
      }finally{extracting=false;status('Upload a resume to create a candidate and prepare a screening brief automatically.');}
    }
    function status(message){const el=api.root?.querySelector('#resumeUploadNote');if(el)el.textContent=message;}
    async function storeDocument(c){
      if(!valid(c))return;
      const source=files.get(c.id);
      if(source&&!c.resumeIntake.stored){
        await api.upload(c,source.file,source.text);c.resumeIntake.stored=true;files.delete(c.id);
      }
      set(c,'queued');await api.persist();
    }
    function enqueue(c){if(!valid(c)||!pending(c))return;if(useRemote()){void remote.request(c);return;}queue.add(c.id);void drain();}
    async function drain(){
      if(running)return;running=true;
      try{while(queue.size){
        const id=queue.values().next().value;queue.delete(id);const c=api.candidates().find(c=>c.id===id);
        if(!c||!valid(c)||!pending(c))continue;
        if(c.resumeIntake.phase==='ready'&&c.resumeIntake.signature===api.signature(context(c)))continue;
        try{
          if(files.has(id))await storeDocument(c);
          const text=await api.text(c);
          if(!text)throw Error('The resume was not fully uploaded. Select that resume again to attach it to this candidate.');
          if(!valid(c)||!pending(c))continue;
          c.resumeIntake.stored=true;
          // One retry for changed evidence, never use a late result for an old context.
          for(let attempt=0;attempt<2;attempt++){
            const snapshot=context(c),signature=api.signature(snapshot);
            set(c,'processing');await api.persist();
            if(!valid(c)||!pending(c))break;
            const result=validate(await api.analyze(text,c.resumeIntake.fileName,api.job(c.jobId),snapshot),text);
            if(!valid(c)||!pending(c))break;
            if(signature!==api.signature(context(c))){
              if(attempt===0)continue;
              throw Error('The job or feedback changed during analysis. Try again with the latest evidence.');
            }
            Object.assign(c,{name:result.name==='Candidate'?c.name:result.name,short:result.name==='Candidate'?c.name:result.name,role:result.role,
              signal:result.primary_signal,strengths:result.resume_evidence.map(e=>e.claim+' — Resume: “'+e.quote+'”'),concerns:result.concerns,tags:result.tags,screeningQuestions:result.screening_questions,updatedAt:Date.now()});
            Object.assign(c.resumeIntake,{brief:result,signature,phase:'ready',updatedAt:Date.now(),error:''});
            await api.persist();changed(c);api.track('resume_analyzed');api.toast('Screening brief ready for '+c.short+'.');break;
          }
        }catch(e){if(valid(c)&&pending(c)){set(c,'error',e.message||'Assessment unavailable. Your resume is saved.');try{await api.persist();}catch{}}}
      }}finally{running=false;}
    }
    async function retry(c){
      if(!valid(c)||reviewing.has(c.id))return;
      if(!c.resumeIntake.stored&&!files.has(c.id)){
        // A document may have saved just before the browser closed.
        try{if(await api.text(c))c.resumeIntake.stored=true;}catch{}
      }
      if(useRemote()){
        try{
          if(files.has(c.id))await storeDocument(c);
          if(!c.resumeIntake.stored){api.toast('Select this resume again to finish attaching it.','error');return;}
          await remote.request(c,true);
        }catch(e){set(c,'error',e.message||'The resume could not be saved. Try again.');api.toast(c.resumeIntake.error,'error');}
        return;
      }
      enqueue(c);
    }
    function duplicates(c){return api.candidates().filter(x=>x.id!==c.id&&x.jobId===c.jobId&&normalize(x.name)===normalize(c.name)&&c.resumeIntake?.brief?.name!=='Candidate');}
    async function approve(c,{next=false}={}){
      if(!valid(c)||reviewing.has(c.id)||c.resumeIntake.phase!=='ready'||!pending(c))return;
      if(c.resumeIntake.signature!==api.signature(context(c))){await retry(c);return;}
      reviewing.add(c.id);changed(c);
      let approved=false;
      const before={jdScore:c.jdScore,resumeJDScore:c.resumeJDScore,originalManagerScore:c.originalManagerScore,managerScore:c.managerScore,aiReview:c.aiReview,rec:c.rec},brief=c.resumeIntake.brief;
      try{
        if(api.beforeReview&&!await api.beforeReview(c))return;
        await api.persist();
        if(!valid(c)||c.resumeIntake.signature!==api.signature(context(c)))throw Error('Evidence changed. Prepare the latest assessment.');
        if(useRemote()){
          if(!c.resumeIntake.remoteRevision)throw Error('The latest assessment is still loading. Try again shortly.');
          await api.reviewRemote(c.id,c.resumeIntake.remoteRevision);
          approved=true;api.toast('Assessment approved and saved.');return true;
        }
        const now=Date.now();c.resumeIntake.reviewedAt=now;
        Object.assign(c,{jdScore:brief.score,resumeJDScore:brief.score,originalManagerScore:brief.manager_score,managerScore:brief.manager_score,rec:api.recommendation(brief.manager_score),
          aiReview:{source:'resume_intake',verdict:'Needs Adjustment',correctedScore:brief.manager_score,correctedJDScore:brief.score,notes:brief.manager_reason,createdAt:now,reasons:['Resume assessment reviewed']}});
        c.aiReview.contextSignature=api.signature(api.fullContext(c));await api.persist();
        approved=true;api.toast('Assessment approved and added to rankings.');
      }catch(e){Object.assign(c,before);delete c.resumeIntake.reviewedAt;api.toast(e.message||'Approval could not be saved. Try again.','error');}
      finally{reviewing.delete(c.id);if(approved)api.reviewed?.(c);changed(c);if(useRemote()&&approved&&next)api.next?.(c);}
      if(approved&&next)api.next?.(c);
      return approved;
    }
    function bind(wrap,c){
      wrap.querySelector('[data-intake-approve]')?.addEventListener('click',()=>void approve(c));
      wrap.querySelector('[data-intake-next]')?.addEventListener('click',()=>void approve(c,{next:true}));
      wrap.querySelector('[data-intake-retry]')?.addEventListener('click',()=>void retry(c));
      wrap.querySelectorAll('[data-intake-existing]').forEach(b=>b.addEventListener('click',()=>{const existing=api.candidates().find(x=>x.id===b.dataset.intakeExisting&&x.jobId===c.jobId);if(existing)api.open(existing,true);}));
    }
    function renderCandidate(c,wrap){
      if(!wrap)return;const state=c?.resumeIntake;wrap.hidden=!state||(wrap.id==='workspaceIntake'&&!pending(c));if(wrap.hidden){wrap.innerHTML='';delete wrap.dataset.markup;return;}
      const brief=state.brief,needsReview=pending(c),stale=needsReview&&state.phase==='ready'&&state.signature!==api.signature(context(c));
      if(stale)queueMicrotask(()=>enqueue(c));
      let html='<span class="rf-kicker">Resume screening brief</span>';
      if(needsReview&&api.job(c.jobId)?.status==='closed')html+='<h3>Search closed · assessment paused</h3><p class="rf-sub">Reopen this search from Jobs to resume assessment work. Existing candidate records are retained.</p>';
      else if(state.phase==='error')html+='<h3>Resume intake needs attention</h3><p>'+escape(state.error)+'</p><button class="rf-btn" type="button" data-intake-retry>Try again</button>';
      else if(state.phase!=='ready')html+='<h3>Preparing your screening brief…</h3><p class="rf-sub">You can keep working. Once your resume is saved, processing continues even if you close this tab. Scores appear after review.</p>';
      else{
        html+='<div class="rf-cardhead"><h3>'+(wrap.id==='workspaceIntake'?'Resume assessment':escape(c.short))+'</h3><span class="rf-pill '+(needsReview?'rf-amber':'rf-green')+'">'+(needsReview?'Awaiting your review':'Reviewed')+'</span></div><p>'+escape(brief.primary_signal)+'</p>';
        if(needsReview)html+='<p><strong>Proposed JD Fit: '+brief.score.toFixed(1)+'/10 · Manager Fit: '+brief.manager_score.toFixed(1)+'/10</strong></p>';
        html+='<p><strong>Key uncertainty:</strong> '+escape(brief.concerns[0]||'Confirm the job requirements during screening.')+'</p><details><summary>Supporting resume evidence and score details</summary><p class="rf-sub">'+escape(brief.jd_reason)+'</p><p class="rf-sub">'+escape(brief.manager_reason)+'</p><ul>'+brief.resume_evidence.map(e=>'<li><strong>'+escape(e.claim)+'</strong><blockquote>'+escape(e.quote)+'</blockquote></li>').join('')+'</ul>'+(brief.resume_evidence.length?'':'<p>No supporting job-related evidence was confirmed. Verify the requirements during screening.</p>')+'<h4>Concerns to clarify</h4><ul>'+brief.concerns.map(s=>'<li>'+escape(s)+'</li>').join('')+'</ul></details>';
        if(brief.name==='Candidate'||brief.role==='Role not stated')html+='<p class="rf-note">The resume did not clearly identify the name or professional role. Verify these details during screening.</p>';
        const matches=duplicates(c);
        if(matches.length)html+='<div class="rf-note">Possible duplicate: this name is already on this job. '+matches.map(x=>'<button class="rf-linkbtn" type="button" data-intake-existing="'+escape(x.id)+'">Open '+escape(x.short)+'</button>').join(' ')+' No records have been merged.</div>';
        if(needsReview){
          const inline=wrap.id==='workspaceIntake',disabled=reviewing.has(c.id)||api.job(c.jobId)?.status==='closed';
          html+='<p class="rf-evidence-caution">Missing evidence is a question to verify, not proof of a missing skill.</p><details class="rf-review-explanation"><summary>What happens when I approve?</summary><p>Saves the proposed JD Fit and Manager Fit scores, recommendation, and supporting assessment for this candidate. Their pipeline stage stays the same. Approval does not submit them to a manager or change another candidate.</p><p>Approve &amp; next also opens the next ready assessment. You can leave this assessment pending and return after checking the evidence.</p></details>';
          html+='<div class="rf-actions">'+(!stale&&inline?'<button class="rf-btn primary" type="button" data-intake-next'+(disabled?' disabled':'')+'>'+(matches.length?'Keep separate, approve &amp; next':'Approve &amp; next')+'</button>':'')+'<button class="rf-btn'+(!inline||stale?' primary':'')+'" type="button" '+(stale?'data-intake-retry':'data-intake-approve')+(disabled?' disabled':'')+'>'+(stale?'Update from latest evidence':matches.length?'Keep separate and approve assessment':'Approve assessment')+'</button></div>';
        }
        if(stale)html+='<p class="rf-sub">The job or feedback changed. This proposal needs updating before approval.</p>';
      }
      // Keep evidence expanded across intake status refreshes.
      if(wrap.dataset.markup!==html||wrap.dataset.candidate!==c.id){const open=wrap.querySelector('details')?.open;wrap.innerHTML=html;wrap.dataset.markup=html;wrap.dataset.candidate=c.id;if(open&&wrap.querySelector('details'))wrap.querySelector('details').open=true;bind(wrap,c);}
    }
    function render(){
      if(api.renderQueue){api.renderQueue();return;}
      const wrap=api.root?.querySelector('#resumeIntakeStatus');if(!wrap)return;
      const list=api.candidates().filter(c=>c.jobId===api.job()?.id&&pending(c));
      wrap.hidden=!list.length;
      wrap.innerHTML=list.map(c=>'<button type="button" class="rf-intake-status" data-intake-open="'+escape(c.id)+'"><strong>'+escape(c.short)+'</strong><span>'+({uploading:'Saving resume…',queued:'Queued for assessment',processing:'Preparing screening brief…',ready:'Screening brief ready · review',error:'Needs attention'}[c.resumeIntake.phase]||'Preparing…')+'</span></button>').join('');
      wrap.querySelectorAll('[data-intake-open]').forEach(b=>b.addEventListener('click',()=>api.open(api.candidates().find(c=>c.id===b.dataset.intakeOpen),true)));
    }
    function resume(){
      if(useRemote()){remote.resume();render();return;}
      api.candidates().filter(c=>pending(c)&&valid(c)).forEach(c=>{
        const state=c.resumeIntake;
        const legacyFailure=state.phase==='error'&&state.validationRecovery!=='word-quotes-v2'&&[
          'The resume evidence could not be verified. Please retry the assessment.',
          'The AI response could not be verified against this resume. Try the assessment again.'
        ].includes(state.error);
        if(legacyFailure)state.validationRecovery='word-quotes-v2';
        if(legacyFailure||['queued','processing','uploading'].includes(state.phase)||(state.phase==='ready'&&state.signature!==api.signature(context(c))))enqueue(c);
      });render();
    }
    function hasUnsavedFile(){for(const id of files.keys())if(!api.candidates().some(c=>c.id===id))files.delete(id);return extracting||files.size>0;}
    function releaseFile(id){files.delete(id);}
    return {upload,retry,approve,resume,render,renderCandidate,hasUnsavedFile,releaseFile};
  }
  const api={create,validate,identity,pending,normalize,sourceQuote};if(typeof module!=='undefined')module.exports=api;global.AncalagonIntake=api;
})(typeof window==='undefined'?globalThis:window);

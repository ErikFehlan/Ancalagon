(function(global){
  'use strict';
  const tips=Object.freeze({
    assessment:{title:'Start with the evidence',text:'Check the resume excerpt behind the assessment. An unanswered question means the evidence is missing; it does not establish that the person lacks the skill.',more:'JD Fit reflects the job requirements. Manager Fit also considers approved manager priorities and recorded feedback. Use the scores to organize your review, then verify the examples and open questions.'},
    feedback:{title:'Your words come first',text:'Capture what you observed. Then accept or correct the interpretation so it reflects what you meant.',more:'Your original note stays available. Accepting an interpretation marks its wording as reviewed and leaves scores unchanged. A correction becomes candidate evidence for a new assessment proposal. A reusable manager preference needs its own approval before it applies across the job.'},
    approval:{title:'Review the change before approving',text:'Check the proposed scores, their reasons, and the supporting evidence. Your approval saves this candidate’s assessment.',more:'Approval does not submit the candidate, change their pipeline stage, or approve a reusable manager preference. For an updated assessment, Keep current assessment leaves the existing scores in place. Approve & next saves this assessment and opens the next ready review.'},
    submission:{title:'Make the summary your own',text:'Check each claim against the evidence and keep unresolved questions visible before sharing.',more:'Save summary keeps your edited draft with this candidate. Copy summary puts the text on your clipboard. Neither action sends it to a manager or changes the candidate’s stage.'}
  });
  function normalize(value){const state={enabled:value?.enabled!==false,tips:{}};for(const key of Object.keys(tips))if(['dismissed','completed'].includes(value?.tips?.[key]))state.tips[key]=value.tips[key];return state;}
  function create(api){
    let state=normalize(null),loaded=false,busy=0,problem='',failed=null,disposed=false,chain=Promise.resolve();
    const view=()=>({state:normalize(state),loaded,busy:busy>0,problem});
    const changed=()=>{if(!disposed)api.changed?.(view());};
    async function load(){if(disposed)return false;busy++;problem='';changed();try{const row=await api.load();if(disposed)return false;state=normalize(row);loaded=true;failed=null;return true;}catch{if(!disposed)problem='Guidance preferences could not load. Your work is still available.';return false;}finally{busy--;changed();}}
    function update(action,tip=null){
      if(disposed||!loaded)return Promise.resolve(false);
      if(!['dismiss','complete','enable','disable','reset'].includes(action)||(['dismiss','complete'].includes(action)&&!Object.hasOwn(tips,tip)))return Promise.resolve(false);
      busy++;problem='';changed();
      const work=chain.then(async()=>{
        if(disposed)return false;
        if(action==='complete'&&state.tips[tip])return true;
        try{const next=await api.save(action,tip);if(disposed)return false;state=normalize(next);failed=null;return true;}
        catch{if(!disposed){failed={action,tip};problem='Guidance preference did not save. Your work is unaffected. Retry when connected.';}return false;}
      }).finally(()=>{busy--;changed();});
      chain=work;return work;
    }
    return {view,load,update,retry:()=>failed?update(failed.action,failed.tip):load(),dispose:()=>{disposed=true;}};
  }
  function mount(root,api){
    const opened=new Set();let disposed=false;
    const session=create({load:api.load,save:api.save,changed:render});
    function render(){
      if(disposed)return;const v=session.view();
      root.querySelectorAll('[data-guidance-tip]').forEach(slot=>{
        const key=slot.dataset.guidanceTip,tip=tips[key];if(!tip)return;
        const expanded=opened.has(key)||(v.loaded&&v.state.enabled&&!v.state.tips[key]),bodyId=slot.id+'-body';
        const html=`<div class="rf-guidance ${expanded?'is-open':''}"><div class="rf-guidance-head"><button type="button" class="rf-linkbtn" data-guidance-open="${key}" aria-expanded="${expanded}" aria-controls="${bodyId}">${expanded?tip.title:'Show guidance: '+tip.title}</button>${expanded?`<button type="button" class="rf-linkbtn" data-guidance-dismiss="${key}" ${v.busy?'disabled':''}>${v.loaded?'Got it':'Close'}</button>`:''}</div><div id="${bodyId}" ${expanded?'':'hidden'}><p>${tip.text}</p><details><summary>More context</summary><p>${tip.more}</p></details></div>${v.problem?`<p class="rf-guidance-status" role="status">${v.problem} <button type="button" class="rf-linkbtn" data-guidance-retry ${v.busy?'disabled':''}>Retry</button></p>`:''}</div>`;
        if(slot.dataset.guidanceMarkup!==html){const wasOpen=slot.querySelector('details')?.open;const focused=slot.contains(global.document?.activeElement);slot.innerHTML=html;slot.dataset.guidanceMarkup=html;if(wasOpen)slot.querySelector('details').open=true;if(focused)slot.querySelector('[data-guidance-open]').focus({preventScroll:true});}
      });
      const settings=root.querySelector('#guidanceSettings');if(settings){
        const html=`<h4>Guidance while you work</h4><p class="rf-sub">Tips retire as you complete tasks or dismiss them. You can reopen a tip on its page at any time. These preferences are private to you in this workspace.</p><div class="rf-actions"><button type="button" class="rf-btn" data-guidance-setting="${v.state.enabled?'disable':'enable'}" ${!v.loaded||v.busy?'disabled':''}>${v.state.enabled?'Hide automatic tips':'Show automatic tips'}</button><button type="button" class="rf-btn" data-guidance-setting="reset" ${!v.loaded||v.busy?'disabled':''}>Restore all tips</button></div><p class="rf-sub" role="status">${v.problem||(!v.loaded?'Loading guidance preferences…':v.busy?'Saving guidance preference…':v.state.enabled?'Guidance is on. Completed and dismissed tips stay collapsed.':'Automatic tips are hidden. Help remains available.')}</p>${v.problem?'<button type="button" class="rf-btn" data-guidance-retry>Retry guidance sync</button>':''}`;
        if(settings.dataset.markup!==html){const focused=settings.contains(global.document?.activeElement);settings.innerHTML=html;settings.dataset.markup=html;if(focused)settings.querySelector('button:not(:disabled)')?.focus({preventScroll:true});}
      }
    }
    async function click(event){
      const button=event.target.closest('button');if(!button||!root.contains(button)||button.disabled)return;
      if(button.hasAttribute('data-guidance-open')){const key=button.dataset.guidanceOpen;if(button.getAttribute('aria-expanded')==='true'){if(session.view().loaded)await session.update('dismiss',key);opened.delete(key);}else opened.add(key);render();}
      if(button.hasAttribute('data-guidance-dismiss')){const key=button.dataset.guidanceDismiss;if(!session.view().loaded||await session.update('dismiss',key))opened.delete(key);render();}
      if(button.hasAttribute('data-guidance-setting')){if(await session.update(button.dataset.guidanceSetting))opened.clear();render();}
      if(button.hasAttribute('data-guidance-retry'))await session.retry();
    }
    root.addEventListener('click',click);render();
    return {load:session.load,show:(slot,key)=>{if(slot&&tips[key]){slot.dataset.guidanceTip=key;render();}},complete:key=>session.update('complete',key),refresh:render,dispose:()=>{disposed=true;session.dispose();root.removeEventListener('click',click);},view:session.view};
  }
  const api={tips,normalize,create,mount};if(typeof module==='object'&&module.exports)module.exports=api;global.AncalagonGuidance=api;
})(typeof window==='undefined'?globalThis:window);

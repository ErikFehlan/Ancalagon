(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AncalagonTutorial=api;})(globalThis,function(){
 'use strict';
 const sampleNote='Jordan built the Playwright test suite and maintained it for two releases.';
 const sampleMeaning='Jordan has hands-on experience building and maintaining test automation.';
 const samples=Object.freeze([
  {name:'Jordan Lee',initials:'JL',jd:7.8,manager:6.2,file:'Jordan_Lee.pdf',supported:'Regression testing and clear defect documentation.',unknown:'Did Jordan personally build and maintain automated tests?',quote:'Wrote regression test cases, documented reproducible defects, and partnered with the automation team to extend regression coverage.',coach:'Open the resume excerpt. For Jordan, automation ownership is a question to ask, not a reason to assume they lack the skill.'},
  {name:'Alex Rivera',initials:'AR',jd:7.3,manager:5.8,file:'Alex_Rivera.docx',supported:'Exploratory testing, detailed bug reports, and SQL validation.',unknown:'What automated tests has Alex personally built?',quote:'Led exploratory testing for checkout flows, documented defects with reproduction steps, and validated transactions using SQL.',coach:'Approve & next brought you straight to Alex. Inspect the evidence, then decide whether the assessment is supported.'},
  {name:'Morgan Chen',initials:'MC',jd:8.6,manager:8.2,file:'Morgan_Chen.pdf',supported:'Hands-on automation ownership and regression coverage.',unknown:'How did Morgan decide which tests were worth automating?',quote:'Owned the Cypress regression suite, added checkout coverage, and maintained test reliability across weekly releases.',coach:'Morgan’s resume supports automation ownership. There is still a useful screening question about judgment and prioritization.'}
 ]);
 const text=(value,fallback,limit)=>typeof value==='string'?value.slice(0,limit):fallback;
 const integer=(value,min,max)=>Number.isInteger(value)?Math.max(min,Math.min(max,value)):min;
 function initial(){return {version:1,started:false,step:1,maxStep:1,jobCreated:false,uploaded:false,retried:false,reviewIndex:0,sourceSeen:[false,false,false],notePhase:0,complete:false,title:'QA Engineer',description:'Own regression testing for a web product. Write clear defect reports, collaborate with engineers, and build reliable automated tests.',priority:'Hands-on ownership of test automation',note:sampleNote,interpretation:sampleMeaning,draft:''};}
 function normalize(value){
  const state=initial();if(!value||value.version!==1||typeof value!=='object')return state;
  for(const key of ['started','jobCreated','uploaded','retried','complete'])state[key]=value[key]===true;
  for(const [key,limit] of Object.entries({title:100,description:2000,priority:300,note:2000,interpretation:2500,draft:5000}))state[key]=text(value[key],state[key],limit);
  state.maxStep=integer(value.maxStep,1,5);state.step=integer(value.step,1,state.maxStep);state.reviewIndex=integer(value.reviewIndex,0,state.retried?3:2);state.notePhase=integer(value.notePhase,0,3);
  state.sourceSeen=[0,1,2].map(i=>value.sourceSeen?.[i]===true);
  return state;
 }
 function proposal(state){const changed=state.note.trim()===sampleNote&&state.interpretation.trim()===sampleMeaning;return {changed,jd:changed?8.4:7.8,manager:changed?7.9:6.2,reason:changed?'Jordan’s automation ownership is now supported by the screening note.':'Your wording is preserved. This exercise only scores its supplied example; edited notes stay available for review with scores unchanged.'};}
 function defaultDraft(state){return 'Jordan Lee — '+state.title.trim()+'\n\nWhy consider Jordan\nThe resume supports regression testing and clear defect documentation.'+(proposal(state).changed?' In the screening call, Jordan confirmed building the Playwright suite and maintaining it for two releases.':'\n\nScreening note\n'+state.note.trim())+'\n\nWhat to explore next\n'+(proposal(state).changed?'Ask how Jordan chose which tests to automate and handled unreliable tests.':'Clarify Jordan’s personal role in building and maintaining automated tests.')+'\n\nSuggested next step\nA focused technical conversation to validate depth and approach.';}
 function reduce(current,action,value){
  const state=normalize(current),count=state.retried?3:2;
  const step=n=>{state.step=n;state.maxStep=Math.max(state.maxStep,n);};
  switch(action){
   case 'start':state.started=true;break;
   case 'field':if(['title','description','priority','note','interpretation','draft'].includes(value?.key))state[value.key]=value.value;break;
   case 'job':if(!state.title.trim()||!state.description.trim()||!state.priority.trim())return state;state.jobCreated=true;step(2);break;
   case 'upload':if(state.jobCreated)state.uploaded=true;break;
   case 'retry':if(state.uploaded)state.retried=true;break;
   case 'to-review':if(state.uploaded)step(3);break;
   case 'source':if(state.uploaded&&state.reviewIndex<count)state.sourceSeen[state.reviewIndex]=true;break;
   case 'approve-assessment':if(state.uploaded&&state.reviewIndex<count&&state.sourceSeen[state.reviewIndex])state.reviewIndex++;break;
   case 'to-feedback':if(state.uploaded&&state.reviewIndex>=count)step(4);break;
   case 'note':if(state.step<4||!state.note.trim())return state;state.notePhase=1;state.interpretation=state.note.trim()===sampleNote?sampleMeaning:'Additional candidate evidence to review: '+state.note.trim();break;
   case 'accept-interpretation':if(state.notePhase===1&&state.interpretation.trim())state.notePhase=2;break;
   case 'approve-update':if(state.notePhase===2)state.notePhase=3;break;
   case 'to-shortlist':if(state.notePhase===3){if(!state.draft)state.draft=defaultDraft(state);step(5);}break;
   case 'save-draft':if(state.step===5&&state.notePhase===3&&state.draft.trim())state.complete=true;break;
   case 'step':if(Number.isInteger(value)&&value>=1&&value<=state.maxStep)state.step=value;break;
   case 'restart':return {...initial(),started:true};
  }
  return normalize(state);
 }
 function create(api,{delay=500,timeout=8000}={}){
  let state=initial(),revision=0,loaded=false,loading=false,problem='',conflict=false,lastSaved=JSON.stringify(state),timer=null,writing=null,loadingPromise=null,disposed=false;
  const changed=()=>{if(!disposed)api.changed?.();};
  const pending=()=>JSON.stringify(state)!==lastSaved;
  async function bounded(work){let t;try{return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>t=setTimeout(()=>reject(Error('Tutorial sync timed out.')),timeout))]);}finally{clearTimeout(t);}}
  async function load(){
   if(loadingPromise)return loadingPromise;loading=true;problem='';changed();
   loadingPromise=(async()=>{try{
    const row=await bounded(()=>api.load());if(disposed)return false;
    state=normalize(row?.state);revision=integer(row?.revision,0,2147483646);lastSaved=JSON.stringify(state);loaded=true;conflict=false;return true;
   }catch{problem='Practice progress could not be loaded. Retry when your connection is available. Quick answers and your workspace are still available.';return false;}
   finally{loading=false;loadingPromise=null;changed();}})();return loadingPromise;
  }
  function update(action,value){
   if(!loaded||loading||disposed)return false;
   state=reduce(state,action,value);changed();clearTimeout(timer);
   if(pending()&&!conflict)timer=setTimeout(()=>void flush().catch(()=>{}),delay);
   return true;
  }
  async function flush(){
   clearTimeout(timer);if(writing){await writing;if(pending())return flush();return;}
   if(!pending()||disposed)return;
   if(!loaded||conflict)throw Error(problem||'Practice progress is not ready.');
   const snapshot=normalize(state),fingerprint=JSON.stringify(snapshot);
   writing=(async()=>{try{
    const result=await bounded(()=>api.save(snapshot,revision));if(disposed)return;
    revision=result.revision;lastSaved=fingerprint;problem='';
   }catch(error){conflict=error.code==='TUTORIAL_CONFLICT';problem=conflict?'Practice was changed in another tab. Load the saved progress before continuing.':'Practice changes have not synced. They remain on this page; retry before closing it.';throw error;
   }finally{writing=null;changed();}})();
   changed();await writing;if(pending())return flush();
  }
  function view(){return {state:normalize(state),loaded,loading,saving:Boolean(writing),pending:pending(),problem,conflict};}
  function dispose(){disposed=true;clearTimeout(timer);}
  return {load,update,flush,view,dispose,hasPending:()=>pending()||Boolean(writing)};
 }
 return {initial,normalize,reduce,proposal,defaultDraft,samples,sampleNote,sampleMeaning,create};
});

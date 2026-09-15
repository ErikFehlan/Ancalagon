const test=require('node:test'),assert=require('node:assert/strict');
const T=require('../assets/tutorial.js');
const clone=x=>JSON.parse(JSON.stringify(x));
function toFeedback(){let s=T.initial();for(const action of ['start','job','upload','to-review','source','approve-assessment','source','approve-assessment','to-feedback'])s=T.reduce(s,action);return s;}
test('practice cannot approve an unread source or advance without ready resumes',()=>{
 let s=T.initial();s=T.reduce(s,'approve-assessment');s=T.reduce(s,'to-feedback');assert.equal(s.step,1);assert.equal(s.reviewIndex,0);
 for(const action of ['job','upload','to-review','approve-assessment'])s=T.reduce(s,action);assert.equal(s.reviewIndex,0);
 s=T.reduce(s,'source');s=T.reduce(s,'approve-assessment');assert.equal(s.reviewIndex,1);assert.equal(s.sourceSeen[1],false);
 s=T.reduce(s,'approve-assessment');assert.equal(s.reviewIndex,1);
});
test('retry preserves previously reviewed candidates and adds only the failed sample',()=>{
 let s=toFeedback();assert.equal(s.reviewIndex,2);s=T.reduce(s,'step',2);s=T.reduce(s,'retry');s=T.reduce(s,'to-review');
 assert.equal(s.reviewIndex,2);assert.equal(T.samples[s.reviewIndex].name,'Morgan Chen');assert.equal(s.sourceSeen[2],false);
 s=T.reduce(s,'source');s=T.reduce(s,'approve-assessment');s=T.reduce(s,'to-feedback');assert.equal(s.reviewIndex,3);assert.equal(s.step,4);
});
test('edited notes and corrected interpretations never receive fabricated demo score improvements',()=>{
 let s=T.reduce(toFeedback(),'note');assert.equal(T.proposal(s).changed,true);
 s=T.reduce(s,'field',{key:'interpretation',value:'Jordan only observed someone else building tests.'});assert.equal(T.proposal(s).changed,false);assert.equal(T.proposal(s).manager,6.2);
 s=T.reduce(toFeedback(),'field',{key:'note',value:'Automation ownership still needs clarification.'});s=T.reduce(s,'note');assert.equal(T.proposal(s).changed,false);
 assert.match(s.interpretation,/still needs clarification/);assert.doesNotMatch(T.defaultDraft(s),/confirmed building/);
});
test('progress restores all editable practice work and drops unrecognized records',()=>{
 let s=toFeedback();s=T.reduce(s,'note');s=T.reduce(s,'accept-interpretation');s=T.reduce(s,'approve-update');s=T.reduce(s,'to-shortlist');s=T.reduce(s,'field',{key:'draft',value:'My edited practice summary'});s=T.reduce(s,'save-draft');
 const restored=T.normalize({...clone(s),jobs:[{id:'real'}],candidateId:'real'});assert.equal(restored.complete,true);assert.equal(restored.draft,'My edited practice summary');assert.equal(restored.jobs,undefined);assert.equal(restored.candidateId,undefined);
 assert.deepEqual(T.normalize({version:99}),T.initial());assert.equal(T.normalize({version:1,step:100,maxStep:100,note:'x'.repeat(3000)}).note.length,2000);
});
test('progress save failures retain edits, retry succeeds, and a fresh session resumes remotely',async()=>{
 let remote=null,fail=true;const api={load:async()=>remote,save:async(state,revision)=>{if(fail)throw Error('offline');remote={state:clone(state),revision:revision+1};return remote;}};
 const session=T.create(api,{delay:60000});await session.load();session.update('start');session.update('job');await assert.rejects(session.flush());assert.equal(session.hasPending(),true);assert.match(session.view().problem,/not synced/);
 fail=false;await session.flush();assert.equal(session.hasPending(),false);session.dispose();
 const fresh=T.create(api);await fresh.load();assert.equal(fresh.view().state.step,2);assert.equal(fresh.view().state.started,true);fresh.dispose();
});
test('edits made during an in-flight save are serialized and never lost',async()=>{
 let release,call=0;const writes=[];
 const session=T.create({load:async()=>null,save:async(state,revision)=>{writes.push(clone(state));if(++call===1)await new Promise(resolve=>release=resolve);return {revision:revision+1};}},{delay:60000});
 await session.load();session.update('start');const flush=session.flush();await new Promise(resolve=>setImmediate(resolve));session.update('field',{key:'title',value:'Edited while saving'});release();await flush;
 assert.equal(writes.length,2);assert.equal(writes[1].title,'Edited while saving');assert.equal(session.hasPending(),false);session.dispose();
});
test('a conflicting tab cannot silently overwrite saved progress',async()=>{
 let remote={state:{...T.initial(),started:true,step:2,maxStep:2},revision:2};
 const session=T.create({load:async()=>clone(remote),save:async()=>{throw Object.assign(Error('conflict'),{code:'TUTORIAL_CONFLICT'});}},{delay:60000});
 await session.load();session.update('field',{key:'title',value:'This tab'});await assert.rejects(session.flush());assert.equal(session.view().conflict,true);await assert.rejects(session.flush());
 remote.state.title='Other tab';await session.load();assert.equal(session.view().state.title,'Other tab');assert.equal(session.hasPending(),false);session.dispose();
});
test('failed progress loading never writes default progress over saved work',async()=>{
 let writes=0;const session=T.create({load:async()=>{throw Error('offline');},save:async()=>writes++});assert.equal(await session.load(),false);assert.equal(session.update('start'),false);await session.flush();assert.equal(writes,0);session.dispose();
});

const {test}=require('node:test'),assert=require('node:assert/strict');
const {create,model,location}=require('../assets/home.js');
const state={jobs:[{id:'j',title:'QA'},{id:'closed',status:'closed'}],candidates:[{id:'a',jobId:'j',resumeIntake:{status:'ready'}},{id:'b',jobId:'j'},{id:'old',jobId:'closed',resumeIntake:{status:'ready'}}]};
test('bookmarks resolve only against loaded workspace and correct job, with deleted-record fallback',()=>{
 assert.equal(location(state,{last_job_id:'foreign'}),null);
 assert.equal(location(state,{last_job_id:'j',last_candidate_id:'old',last_page:'detail'}).page,'candidates');
 assert.equal(location(state,{last_job_id:'j',last_candidate_id:'a',last_page:'detail'}).candidate.id,'a');
 assert.equal(location(state,{last_job_id:'j',last_page:'javascript:alert(1)'}).page,'dashboard');
 const m=model(state,null,false,[{job_id:'j',candidate_id:'b',status:'ready'},{job_id:'wrong',candidate_id:'a',status:'ready'},{job_id:'j',candidate_id:'absent',status:'ready'}]);
 assert.deepEqual(m.ready.map(c=>c.id),['a','b']);assert.deepEqual(m.recent.map(j=>j.id),['j']);
});
test('first visit is recorded once; returning empty accounts and existing workspaces use returning Home',async()=>{
 let row=null,visits=0;const api={state:()=>({jobs:[],candidates:[]}),load:async()=>row,visit:async()=>{visits++;row??={first_visited_at:'now'}},save:async()=>{},reviews:async()=>[]};
 const first=create(api);await first.load();assert.equal(first.view().firstVisit,true);first.dispose();
 const again=create(api);await again.load();assert.equal(again.view().firstVisit,false);again.dispose();
 row=null;const existing=create({...api,state:()=>state});await existing.load();assert.equal(existing.view().firstVisit,false);existing.dispose();assert.equal(visits,3);
});
test('navigation while loading is retained; Home and settings never erase the working location',async()=>{
 let resolve,latest;const c=create({state:()=>state,load:()=>new Promise(r=>resolve=r),visit:async()=>{},save:async x=>latest=x,reviews:async()=>[]},{delay:10000});
 const p=c.load();await Promise.resolve();c.remember('detail','j','a');resolve(null);await p;await c.flush();
 assert.equal(latest.last_candidate_id,'a');c.remember('home','j');c.remember('backend','j');await c.flush();assert.equal(c.view().last.candidate.id,'a');c.dispose();
});
test('slow and failed bookmark writes preserve the latest destination and recover without blocking work',async()=>{
 let fail=true,release,holding=false,saved=[];const c=create({state:()=>state,load:async()=>({}),visit:async()=>{},reviews:async()=>[],save:async x=>{if(fail){fail=false;throw Error('offline')}if(holding)await new Promise(r=>release=r);saved.push(x)}},{delay:10000});
 await c.load();c.remember('detail','j','a');assert.equal(await c.flush(),false);assert.match(c.view().problem,/not synced/);
 holding=true;const p=c.flush();await new Promise(r=>setImmediate(r));c.remember('detail','j','b');holding=false;release();await p;
 assert.equal(saved.at(-1).last_candidate_id,'b');assert.equal(c.view().problem,'');c.dispose();
});
test('missing Home service times out without hiding the workspace or losing a pending bookmark',async()=>{
 let fail=true;const c=create({state:()=>state,load:()=>fail?new Promise(()=>{}):Promise.resolve(null),visit:async()=>{},save:async()=>{},reviews:async()=>[]},{delay:10000,timeout:20});
 await c.load();assert.equal(c.view().loading,false);assert.match(c.view().problem,/could not be synced/);
 c.remember('detail','j','a');assert.equal(await c.flush(),false);fail=false;await c.load();await c.flush();assert.equal(c.view().last.candidate.id,'a');c.dispose();
});
test('Home data reads and writes are scoped to both the user and workspace, and keep assessments lightweight',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),calls=[];
 const client={from(table){const entry={table,filters:[]};calls.push(entry);const q={select(columns){entry.columns=columns;return q},eq(k,v){entry.filters.push([k,v]);return q},or(v){entry.versionGuard=v;return q},maybeSingle(){entry.single=true;return q},update(payload){entry.payload=payload;return q},upsert(payload,options){Object.assign(entry,{payload,options});return q},then(resolve){return Promise.resolve({data:entry.single?null:[],error:null}).then(resolve)}};return q;}};
 const context={window:{},console,setTimeout,clearTimeout};vm.runInNewContext(fs.readFileSync('assets/data.js','utf8'),context);
 const service=context.window.AncalagonData.create({client,session:{user:{id:'me'}},workspace:{id:'my-workspace'}});
 await service.loadHome();await service.visitHome();await service.saveHome({last_job_id:'job',last_page:'dashboard',last_opened_at:'2026-09-14T14:00:00.000Z'});await service.loadHomeReviews();
 for(const i of [0,2])assert.deepEqual(calls[i].filters,[['user_id','me'],['workspace_id','my-workspace']]);
 assert.equal(calls[1].payload.user_id,'me');assert.equal(calls[1].payload.workspace_id,'my-workspace');assert.equal(calls[1].options.ignoreDuplicates,true);
 assert.match(calls[2].versionGuard,/last_opened_at.lte.2026-09-14/);assert.equal(calls[3].columns,'candidate_id,job_id,status');assert.deepEqual(calls[3].filters,[['workspace_id','my-workspace'],['status','ready']]);
});

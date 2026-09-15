const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const rows=[{user_id:'user',workspace_id:'workspace',last_job_id:'real-job',last_page:'detail',tutorial_revision:0,tutorial_progress:null}],calls=[];let lose=false;
 const client={from(table){assert.equal(table,'workspace_home');let operation='select',payload,filters=[];
  const q={select(){return q;},eq(k,v){filters.push([k,v]);return q;},update(v){operation='update';payload=v;return q;},upsert(v){operation='insert';payload=v;return q;},maybeSingle(){return q;},then(resolve,reject){return Promise.resolve().then(()=>{
   calls.push({operation,filters,payload});const row=rows.find(r=>filters.every(([k,v])=>r[k]===v));
   if(operation==='insert'){if(!rows.some(r=>r.user_id===payload.user_id&&r.workspace_id===payload.workspace_id))rows.push({...payload,tutorial_revision:0});return {error:null};}
   if(operation==='update'&&row){Object.assign(row,JSON.parse(JSON.stringify(payload)));if(lose){lose=false;return {error:Error('Response lost')};}}
   return {data:row?JSON.parse(JSON.stringify(row)):null,error:null};
  }).then(resolve,reject);}};return q;}};
 const context={window:{},console,setTimeout,clearTimeout};vm.runInNewContext(fs.readFileSync('assets/data.js','utf8'),context);
 return {rows,calls,lose(){lose=true;},service:context.window.AncalagonData.create({client,workspace:{id:'workspace'},session:{user:{id:'user'}}})};
}
test('tutorial writes are scoped and preserve the real workspace bookmark',async()=>{
 const f=fixture();const result=await f.service.saveTutorial({version:1,step:2},0);assert.equal(result.revision,1);assert.equal(f.rows[0].last_job_id,'real-job');assert.equal(f.rows[0].last_page,'detail');
 assert.deepEqual(f.calls.find(c=>c.operation==='update').filters,[['user_id','user'],['workspace_id','workspace'],['tutorial_revision',0]]);
});
test('a lost successful save is recoverable without allowing a stale different snapshot',async()=>{
 const f=fixture(),state={version:1,step:3,sourceSeen:[true,false,false]};f.lose();await assert.rejects(f.service.saveTutorial(state,0));
 assert.equal((await f.service.saveTutorial(state,0)).revision,1);
 await assert.rejects(f.service.saveTutorial({...state,step:2},0),e=>e.code==='TUTORIAL_CONFLICT');assert.equal(f.rows[0].tutorial_progress.step,3);
});

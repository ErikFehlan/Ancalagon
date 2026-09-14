const {test}=require('node:test'),assert=require('node:assert/strict'),{create}=require('../assets/quick-notes.js');
const until=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}throw Error('Timed out');};
function fixture(save=async()=>{}){let next=0;const a={id:'a',jobId:'job-a'},b={id:'b',jobId:'job-b'},calls=[],valid=new Set([a,b]);const flow=create({id:()=>String(++next),valid:c=>valid.has(c),save:async(...args)=>{calls.push(args);return save(...args);}},{delay:10});return {a,b,flow,calls,valid};}
test('typing autosaves one candidate-scoped note and later edits reuse its identity',async()=>{
 const f=fixture();f.flow.edit(f.a,'First');f.flow.edit(f.a,'First complete note');assert.equal(f.flow.pending(),true);await until(()=>f.flow.entry(f.a).status==='saved');assert.equal(f.calls.length,1);const id=f.calls[0][2];
 f.flow.edit(f.a,'First complete note, with detail');await f.flow.flush(f.a);assert.equal(f.calls[1][2],id);assert.equal(f.calls[1][3],'First complete note');assert.equal(f.flow.pending(),false);f.flow.dispose();
});
test('edits during a slow save are preserved and serialized without duplicate notes',async()=>{
 let release;const f=fixture(()=>new Promise(r=>release=r));f.flow.edit(f.a,'Earlier');const saved=f.flow.flush(f.a);await until(()=>release);f.flow.edit(f.a,'Newer');release();await until(()=>f.calls.length===2);assert.equal(f.flow.pending(),true);release();await saved;assert.equal(f.flow.entry(f.a).savedText,'Newer');assert.equal(f.calls[0][2],f.calls[1][2]);f.flow.dispose();
});
test('failed saves stay dirty, block departure and new note, then recover with the same ID',async()=>{
 let fail=true;const f=fixture(()=>{if(fail)throw Error('Offline');});f.flow.edit(f.a,'Keep this note');assert.equal(await f.flow.flush(f.a),false);assert.equal(f.flow.pending(),true);assert.equal(f.flow.entry(f.a).text,'Keep this note');assert.equal(await f.flow.fresh(f.a),false);await assert.rejects(()=>f.flow.flushAll());
 fail=false;await f.flow.flushAll();assert.equal(f.flow.pending(),false);assert.equal(new Set(f.calls.map(c=>c[2])).size,1);assert.equal(await f.flow.fresh(f.a),true);assert.equal(f.flow.entry(f.a).text,'');f.flow.dispose();
});
test('navigation saves to the captured candidate and job; removed candidates are skipped',async()=>{
 const f=fixture();f.flow.edit(f.a,'A note');f.flow.edit(f.b,'B note');await f.flow.flushAll();assert.deepEqual(f.calls.map(c=>[c[0].id,c[0].jobId,c[1]]),[['a','job-a','A note'],['b','job-b','B note']]);
 f.flow.edit(f.a,'Deleted candidate');f.valid.delete(f.a);await f.flow.flushAll();assert.equal(f.calls.length,2);assert.equal(f.flow.pending(),false);f.flow.dispose();
});

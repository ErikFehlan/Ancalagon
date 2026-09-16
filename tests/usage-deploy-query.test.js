const assert=require('node:assert/strict');
const test=require('node:test');
const error=(state)=>({ok:false,status:400,json:async()=>({message:`ERROR: ${state}: could not obtain lock on relation "jobs"\nDETAIL: private customer data`})});
test('deployment retries the same transaction only after confirmed lock aborts',async()=>{
 const {runUsageQuery}=await import('../scripts/usage-deploy-query.mjs');
 const calls=[],waits=[],logs=[];const success={ok:true};
 const result=await runUsageQuery('begin; select 1; commit;',{token:'synthetic',ref:'synthetic',mode:'prepare',
  fetchImpl:async(_,args)=>{calls.push(args.body);return calls.length===1?error('40P01'):calls.length===2?error('55P03'):success;},
  wait:async(ms)=>waits.push(ms),log:(...args)=>logs.push(args.join(' '))});
 assert.equal(result,success);assert.equal(calls.length,3);assert.equal(new Set(calls).size,1);
 assert.equal(waits.length,2);assert.ok(waits[0]>=1000&&waits[0]<1500);
 assert.ok(!logs.join(' ').includes('private customer data'));
});
test('persistent contention stops after five attempts',async()=>{
 const {runUsageQuery}=await import('../scripts/usage-deploy-query.mjs');let calls=0;
 await assert.rejects(runUsageQuery('begin; commit;',{mode:'prepare',fetchImpl:async()=>{calls++;return error('55P03');},wait:async()=>{},log:()=>{}}),/deployment stopped/);
 assert.equal(calls,5);
});
test('schema errors, unknown failures, and activation are not retried',async()=>{
 const {runUsageQuery}=await import('../scripts/usage-deploy-query.mjs');
 for(const [mode,state] of [['prepare','42703'],['prepare','unknown'],['activate','40P01']]){
  let calls=0;await assert.rejects(runUsageQuery('query',{mode,fetchImpl:async()=>{calls++;return error(state);},wait:async()=>assert.fail('must not retry'),log:()=>{}}));assert.equal(calls,1);
 }
 let calls=0;await assert.rejects(runUsageQuery('query',{mode:'prepare',fetchImpl:async()=>{calls++;throw Error('network failure');},wait:async()=>assert.fail('must not retry')}),/network failure/);assert.equal(calls,1);
});

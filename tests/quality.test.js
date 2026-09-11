const assert=require('node:assert/strict'),test=require('node:test');
const suite=require('../assets/quality.js');
const output=score=>({jd_score:7.5,manager_score:score,confidence:'medium',summary:'Evidence reviewed.',jd_reason:'Qualification evidence remains unchanged.',manager_reason:'[feedback-followup] New observation considered.',model:'simulated-model'});
test('initial stage cannot leak follow-up evidence or reviewer expectations',()=>{
 for(const item of suite.cases){const first=JSON.stringify(suite.payload(item,'initial'));
 assert.ok(!first.includes(item.followup));assert.ok(!first.includes('feedback-followup'));assert.ok(!first.includes('expectedDirection'));
 for(const criterion of item.rubric)assert.ok(!first.includes(criterion));
 const next=suite.payload(item,'followup',output(8.1));assert.equal(next.candidate.current_manager_score,8.1);assert.ok(JSON.stringify(next).includes(item.followup));}
});
test('direction checks distinguish changed evidence from non-capability outcomes',()=>{
 assert.equal(suite.assess(suite.cases[0],output(8),output(7)).directionPassed,true);
 assert.equal(suite.assess(suite.cases[1],output(7),output(8)).directionPassed,true);
 assert.equal(suite.assess(suite.cases[3],output(8),output(6)).directionPassed,false);
 assert.equal(suite.assess(suite.cases[3],output(8),output(8)).directionPassed,true);
 const fabricated=output(7);fabricated.manager_reason='[invented-source] supports this';assert.deepEqual(suite.assess(suite.cases[0],output(8),fabricated).unknownCitations,['invented-source']);
 assert.equal(suite.assess(suite.cases[0],output(8),{manager_score:'7'}).valid,false);
});
test('runner sends exactly two ordered requests per case and never transmits rubrics',async()=>{
 const calls=[];const report=await suite.run(async p=>{calls.push(p);return output(p.candidate.current_manager_score)});
 assert.equal(calls.length,8);assert.equal(report.status,'completed');assert.equal(report.results.length,4);
 calls.forEach((p,i)=>assert.equal(p.evaluation_context.sources.some(s=>s.id==='feedback-followup'),i%2===1));
 assert.ok(report.results.every(r=>r.humanReview==='unreviewed'));
 assert.ok(!JSON.stringify(calls).includes('expectedDirection'));
});
test('failed first stage never fabricates a follow-up; other cases can finish',async()=>{
 let calls=0;const report=await suite.run(async()=>{if(++calls===1)throw Error('Service unavailable');return output(8)});
 assert.equal(calls,7);assert.equal(report.status,'completed_with_errors');assert.equal(report.results[0].stages.length,0);assert.match(report.results[0].error,/unavailable/);
});
test('cancellation stops subsequent calls and preserves partial report',async()=>{
 const control=new AbortController();let calls=0;const report=await suite.run(async()=>{calls++;control.abort();return output(8)},{signal:control.signal});
 assert.equal(calls,1);assert.equal(report.status,'cancelled');assert.equal(report.results[0].stages.length,1);
});
test('baseline comparison rejects incompatible or duplicated cases',async()=>{
 const r=await suite.run(async()=>output(8));assert.equal(suite.compare(r,r).length,4);
 assert.throws(()=>suite.compare(r,{...r,suite:'other'}));
 assert.throws(()=>suite.compare(r,{...r,results:[r.results[0],r.results[0],r.results[2],r.results[3]]}));
});

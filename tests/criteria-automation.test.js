const test=require('node:test'),assert=require('node:assert/strict');
const client=require('../assets/criteria-automation.js');
test('criteria automation preserves priorities, numeric thresholds, and original text',async()=>{
 const {prepare,validate}=await import('../supabase/functions/refine-job-criteria/logic.mjs');
 const original=['-5+ years QA testing required','BDD preferred','Selenium is a plus','API testing','No production support'];const source=prepare({criteria:original});
 assert.deepEqual(source.map(x=>x.priority),['Required','Preferred','Bonus','Unspecified','Unspecified']);
 const output={criteria:source.map(x=>({index:x.index,label:x.original.replace(/^-/,''),question:'Describe your relevant experience.'}))};const result=validate(output,source);assert.equal(result.criteria[0].original,original[0]);
 output.criteria[0].label='3+ years QA testing required';assert.throws(()=>validate(output,source),/threshold_changed/);
 assert.equal(prepare({criteria:['Manual testing not required']})[0].priority,'Unspecified');
 assert.throws(()=>prepare({criteria:Array(41).fill('x')}),/input_too_large/);
});
test('only results for the current job inputs may be displayed',()=>{
 const job={id:'a',title:'QA',description:'Test',criteria:['5+ years'],managerFeedback:'Manual focus',knockouts:[]},task={input:{title:'QA',description:'Test',criteria:['5+ years'],manager_notes:'Manual focus',knockouts:[]}};
 assert.equal(client.matches(task,job),true);assert.equal(client.matches(task,{...job,criteria:['8+ years']}),false);assert.equal(client.matches(task,{...job,managerFeedback:'New'}),false);
});

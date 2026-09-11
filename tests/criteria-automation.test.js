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
test('matching results appear automatically and original wording can be restored',async()=>{
 const vm=require('node:vm'),fs=require('node:fs');
 const sandbox={module:{exports:{}},setInterval:()=>1,document:{visibilityState:'visible',addEventListener(){}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../assets/criteria-automation.js'),'utf8'),sandbox);
 const app=sandbox.module.exports,job={id:'a',title:'QA',criteria:['-5+ years QA required']};
 const task={job_id:'a',revision:'v1',status:'ready',input:{title:job.title,criteria:job.criteria},result:{criteria:[{original:job.criteria[0],label:'5+ years of QA experience required',priority:'Required',question:'Describe your QA experience.'}]}};
 let click,updates=0,available=true;
 const button={disabled:false,addEventListener:(name,fn)=>{click=fn;}},wrap={innerHTML:'',querySelector:()=>button};
 app.init({root:{querySelector:()=>wrap},ready:()=>true,job:()=>job,fetch:async()=>available?task:null,toggle:async(id,revision,original)=>{assert.equal(id,'a');assert.equal(revision,'v1');assert.equal(original,true);return true;},updated:()=>updates++,toast:()=>{throw Error('Unexpected error');}});
 await app.refresh(job,true);
 assert.equal(app.label(job.criteria[0],job),'5+ years of QA experience required');
 assert.match(wrap.innerHTML,/Describe your QA experience/);assert.equal(updates,1);
 await click();assert.equal(app.label(job.criteria[0],job),'5+ years QA required');assert.match(wrap.innerHTML,/Showing original wording/);
 job.criteria=['8+ years QA required'];assert.equal(app.questions(job).length,0);
 available=false;await app.refresh(job,true);const previous=updates;await app.refresh(job,true);assert.equal(updates,previous,'unchanged empty results must not redraw the candidate workspace');
});

const test=require('node:test'),assert=require('node:assert/strict');
const {buildPayload,fromResult}=require('../assets/feedback.js');
test('interpretation snapshots scoped context and never applies returned scores',()=>{
 const note={text:'strong technically, ownership unclear',jobId:'j',candidateId:'c'},job={id:'j',criteria:['ownership']},candidate={id:'c',jobId:'j',managerScore:7},context={sources:[{text:note.text}]};
 const request=buildPayload(note,job,candidate,context);context.sources[0].text='changed';job.criteria.push('new');
 assert.equal(request.evaluation_context.sources[0].text,note.text);assert.deepEqual(request.job.criteria,['ownership']);
 const result=fromResult({summary:'Technical strength noted; personal ownership needs clarification.',manager_score:10,jd_score:10});
 assert.equal(candidate.managerScore,7);assert.equal(result.manager_score,undefined);assert.equal(note.text,'strong technically, ownership unclear');
 assert.throws(()=>buildPayload(note,{id:'other'},candidate,context));assert.throws(()=>fromResult({manager_score:10}));
});

const test=require('node:test'),assert=require('node:assert/strict');
const {buildPayload,fromResult}=require('../assets/feedback.js');
test('interpretation snapshots scoped context and never applies returned scores',()=>{
 const note={text:'strong technically, ownership unclear',jobId:'j',candidateId:'c'},job={id:'j',criteria:['ownership']},candidate={id:'c',jobId:'j',managerScore:7},context={requirements:['ownership'],sources:[{text:note.text}]};
 const request=buildPayload(note,job,candidate,context);context.sources[0].text='changed';job.criteria.push('new');
 assert.equal(request.evaluation_context.sources[0].text,note.text);assert.equal(request.analysis_type,'feedback');assert.equal(request.candidate,undefined);assert.deepEqual(request.evaluation_context.requirements,['ownership']);
 const result=fromResult({summary:'Technical strength noted; personal ownership needs clarification.',manager_score:10,jd_score:10});
 assert.equal(candidate.managerScore,7);assert.equal(result.manager_score,undefined);assert.equal(note.text,'strong technically, ownership unclear');
 assert.throws(()=>buildPayload(note,{id:'other'},candidate,context));assert.throws(()=>fromResult({manager_score:10}));
});
test('accepting interpretation wording preserves the original evidence signature and source',()=>{
 const {review}=require('../assets/feedback.js'),{build,signature}=require('../assets/context.js');
 const job={id:'j'},candidate={id:'c',jobId:'j'},note={id:'f',jobId:'j',candidateId:'c',text:'Owned test planning.',updatedAt:10,interpretation:{text:'Test planning ownership.',source:'ai',updatedAt:11}};
 const original=structuredClone(note),before=signature(build(job,candidate,[note],[]));
 note.interpretation=review(note.interpretation,null,20);
 assert.equal(note.text,original.text);assert.equal(note.updatedAt,10);assert.equal(note.interpretation.source,'ai');assert.equal(note.interpretation.reviewStatus,'accepted');assert.equal(note.interpretation.reviewedAt,20);assert.equal(signature(build(job,candidate,[note],[])),before);
 const corrected=review(note.interpretation,'Owned the plan; did not build automation.',30);
 assert.equal(corrected.source,'recruiter');assert.equal(corrected.reviewStatus,'corrected');assert.notEqual(signature(build(job,candidate,[{...note,interpretation:corrected}],[])),before);
 assert.throws(()=>review(corrected,'  '));assert.throws(()=>review(null));
});

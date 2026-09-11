const assert=require('node:assert/strict'),test=require('node:test');
const {build,signature}=require('../assets/context.js');
const job={id:'job',description:'Build enterprise tools',criteria:['Ownership']},candidate={id:'a',jobId:'job',strengths:['Led delivery'],concerns:[]};
const feedback=[{id:'f1',jobId:'job',candidateId:'a',text:'Good initial impression',createdAt:1},{id:'f2',jobId:'job',candidateId:'a',text:'Interview examples showed limited ownership',createdAt:2},{id:'f3',jobId:'job',candidateId:'b',text:'Private observation'},{id:'f4',jobId:'other',candidateId:'a',text:'Other job'},{id:'f5',jobId:'job',candidateId:'b',learningScope:'job',signalStatus:'approved',signalDirection:'positive',signalLabel:'Ownership',text:'Specific ownership examples'}];
test('context preserves chronology and contradictions while respecting feedback scope',()=>{
 const c=build(job,candidate,feedback,[]),ids=c.sources.map(x=>x.id);
 assert.ok(ids.includes('feedback-f1')&&ids.includes('feedback-f2'));
 assert.ok(ids.indexOf('feedback-f1')<ids.indexOf('feedback-f2'));
 assert.ok(ids.includes('preference-f5'));assert.ok(!ids.includes('feedback-f3'));assert.ok(!ids.includes('feedback-f4'));
 const resume=build(job,null,feedback,[]);assert.ok(resume.sources.every(x=>x.scope==='job'));
});
test('changes to criteria, feedback and approvals invalidate evaluations; score-only changes do not',()=>{
 const s=signature(build(job,candidate,feedback,[]));
 assert.notEqual(s,signature(build({...job,criteria:['New priority']},candidate,feedback,[])));
 assert.notEqual(s,signature(build(job,candidate,feedback.map(f=>f.id==='f2'?{...f,text:'Changed observation'}:f),[])));
 assert.equal(s,signature(build(job,{...candidate,managerScore:9},feedback,[])));
});
test('approved AI evaluation preserves prior manual correction context',()=>{
 const correction={notes:'Specific correction',createdAt:42};
 const before=signature(build(job,{...candidate,aiReview:correction},feedback,[]));
 const after=signature(build(job,{...candidate,aiReview:{source:'hybrid_reevaluation',priorCorrection:correction,correctedScore:9}},feedback,[]));
 assert.equal(before,after);
});

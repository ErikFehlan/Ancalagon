const test=require('node:test'),assert=require('node:assert/strict');
const {next}=require('../assets/search-flow');
const job={id:'j',description:'Manual QA',status:'active'};
const candidate={id:'c',jobId:'j',stage:'Sourced'};
test('new, incomplete and closed searches have useful entry points',()=>{
 assert.equal(next({}).action,'start');assert.equal(next({job:{id:'j'}}).action,'setup');
 assert.equal(next({job:{...job,status:'closed'},candidates:[candidate]}).action,'jobs');assert.equal(next({job}).action,'upload');
});
test('review is required before the guided submittal path',()=>{
 assert.equal(next({job,candidates:[candidate]}).action,'review');
 for(const phase of ['queued','processing'])assert.equal(next({job,candidates:[{...candidate,resumeIntake:{phase}}]}).action,'progress');
 assert.equal(next({job,candidates:[{...candidate,resumeIntake:{phase:'failed'}}]}).label,'Resolve assessment issue');
 assert.equal(next({job,candidates:[{...candidate,resumeIntake:{phase:'ready'}}]}).action,'review');
 const approved={...candidate,aiReview:{verdict:'Accurate'}};
 assert.equal(next({job,candidates:[approved]}).action,'submittal');
 assert.equal(next({job,candidates:[approved],canReview:()=>true}).action,'review');
});
test('state comes from saved work, excludes other jobs and inactive candidates',()=>{
 assert.equal(next({job,candidates:[{...candidate,jobId:'other'},{...candidate,stage:'Rejected'}]}).action,'upload');
 const saved={...candidate,aiReview:{},submissionDraft:{text:'My pitch'}};
 assert.equal(next({job,candidates:[saved]}).label,'Open submittal');
 assert.equal(next({job,uploads:[{jobId:'other',state:'error'}]}).action,'upload');
 assert.equal(next({job,uploads:[{jobId:'j',state:'error'}]}).action,'uploads');
});
test('selected reviewed candidate is used for the submittal, pending reviews take priority',()=>{
 const first={...candidate,aiReview:{}},second={...first,id:'second'};
 assert.equal(next({job,candidates:[first,second],selected:second}).candidateId,'second');
 assert.equal(next({job,candidates:[first,{...candidate,id:'pending'}],selected:first}).action,'review');
});

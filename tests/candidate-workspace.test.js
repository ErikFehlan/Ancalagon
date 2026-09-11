const test=require('node:test'),assert=require('node:assert/strict');
const {summary}=require('../assets/candidate-workspace.js');
test('submission draft uses profile evidence and only this candidate and job feedback',()=>{
 const result=summary({id:'c',short:'Example',role:'Tester',strengths:['Built test cases'],concerns:['Ownership unclear']},{id:'j',title:'QA'},[{jobId:'j',candidateId:'c',text:'Good examples'},{jobId:'other',candidateId:'c',text:'PRIVATE OTHER JOB'},{jobId:'j',candidateId:'other',text:'PRIVATE OTHER CANDIDATE'}]);
 assert.match(result,/Built test cases/);assert.match(result,/Ownership unclear/);assert.match(result,/Good examples/);assert.doesNotMatch(result,/PRIVATE/);
});

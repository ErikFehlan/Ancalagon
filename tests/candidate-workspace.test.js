const test=require('node:test'),assert=require('node:assert/strict');
const {summary,displayName,evidenceFor}=require('../assets/candidate-workspace.js');
test('submission draft uses profile evidence and only this candidate and job feedback',()=>{
 const result=summary({id:'c',short:'Example',role:'Tester',strengths:['Built test cases'],concerns:['Ownership unclear']},{id:'j',title:'QA'},[{jobId:'j',candidateId:'c',text:'Good examples'},{jobId:'other',candidateId:'c',text:'PRIVATE OTHER JOB'},{jobId:'j',candidateId:'other',text:'PRIVATE OTHER CANDIDATE'}]);
 assert.match(result,/Built test cases/);assert.match(result,/Ownership unclear/);assert.match(result,/Good examples/);assert.doesNotMatch(result,/PRIVATE/);
});

test('candidate heading cleans a file label without guessing a name or changing stored identity',()=>{
 const c={short:'Example_Person_QA_Engineer_Resume',resumeIntake:{fileName:'Example_Person_QA_Engineer_Resume.pdf'}};
 assert.equal(displayName(c),'Example Person QA Engineer');assert.equal(c.short,'Example_Person_QA_Engineer_Resume');
 assert.equal(displayName({short:"Anne-Marie O’Neill"}),"Anne-Marie O’Neill");
});
test('screening evidence separates the claim and preserves the exact resume quote',()=>{
 const quote='Q A  testing\nA P I coverage — source “text”';
 const c={strengths:['Built regression tests — Resume: “'+quote+'”']};
 assert.deepEqual(evidenceFor(c),{claim:'Built regression tests',quote});
 assert.equal(c.strengths[0],'Built regression tests — Resume: “'+quote+'”');
 assert.deepEqual(evidenceFor({strengths:['Built regression tests']}),{claim:'Built regression tests',quote:''});
});

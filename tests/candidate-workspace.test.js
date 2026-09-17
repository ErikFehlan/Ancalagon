const test=require('node:test'),assert=require('node:assert/strict');
const {summary,displayName,evidenceFor}=require('../assets/candidate-workspace.js');
test('client submittal uses supported positives without internal concerns, notes, scores, or resume dumps',()=>{
 const result=summary({id:'c',short:'Example',role:'Tester',strengths:['Built test cases — Resume: “PRIVATE LONG SOURCE”','Owned regression planning','Automation ownership is unclear'],concerns:['Ownership unclear'],managerScore:9},{id:'j',title:'QA'},[{jobId:'j',candidateId:'c',text:'PRIVATE CLIENT NOTE'},{jobId:'other',candidateId:'c',text:'PRIVATE OTHER JOB'}]);
 assert.match(result,/Built test cases/);assert.match(result,/Owned regression planning/);assert.match(result,/For your QA opening/);
 assert.doesNotMatch(result,/PRIVATE|unclear|Resume:|score|Questions to resolve|No observations/i);
 assert.equal(summary({short:'Example',strengths:[]},{title:'QA'}),'','no invented strengths');
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

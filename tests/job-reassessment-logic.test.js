const test=require('node:test'),assert=require('node:assert/strict');
const logic=import('../supabase/functions/reassess-job/logic.mjs');
function input(){return {job:{id:'j',title:'QA',description:'Manual QA',criteria:['Must Have | manual testing'],weights:[],knockouts:[]},candidate:{id:'c',jobId:'j',managerScore:7,jdScore:7,resumeJDScore:7,role:'QA',tags:[],strengths:['Built manual regression tests'],concerns:[]},feedback:[{id:'own',jobId:'j',candidateId:'c',type:'General note',text:'Explained hands-on ownership.',createdAt:1},{id:'other',jobId:'j',candidateId:'other',text:'PRIVATE CANDIDATE'},{id:'foreign',jobId:'elsewhere',candidateId:'c',text:'PRIVATE JOB'},{id:'approved',jobId:'j',candidateId:'other',text:'Manual work matters',learningScope:'job',signalStatus:'approved',signalDirection:'positive',signalLabel:'Hands-on manual testing'}],outcomes:[]};}
test('worker uses the same evidence model, includes shared approvals, and isolates private notes',async()=>{
 const {prepare}=await logic,prepared=prepare(input()),text=JSON.stringify(prepared.payload);
 assert.match(text,/hands-on ownership/);assert.match(text,/Hands-on manual testing/);assert.doesNotMatch(text,/PRIVATE/);
 assert.ok(prepared.sourceIds.has('preference-approved'));assert.match(prepared.contextSignature,/^context-v1-/);
 assert.throws(()=>prepare({...input(),candidate:{...input().candidate,jobId:'other'}}),/invalid_scope/);
});
test('worker rejects invented source references, invalid scores, and unbounded questions',async()=>{
 const {prepare,validate}=await logic,p=prepare(input());
 const result={manager_score:8,jd_score:7,confidence:'medium',summary:'Evidence reviewed',manager_reason:'Ownership supports manual testing',jd_reason:'Baseline unchanged',evidence_ids:['feedback-own'],evidence_support:[{source_id:'feedback-own',claim:'Ownership described',quote:'Explained hands-on ownership.'}],questions:['Which releases did you own?']};
 assert.equal(validate(result,p).context_signature,p.contextSignature);
 assert.throws(()=>validate({...result,evidence_ids:['invented']},p),/invalid_result/);
 assert.throws(()=>validate({...result,manager_score:11},p),/invalid_result/);
 assert.throws(()=>validate({...result,evidence_ids:[]},p),/invalid_result/);
 assert.throws(()=>validate({...result,evidence_support:undefined},p),/invalid_result/);
 assert.throws(()=>validate({...result,questions:Array(4).fill('Question')},p),/invalid_result/);
});
test('AI interpretations are never recycled as candidate evidence and corrections remain candidate-scoped',async()=>{
 const {prepare}=await logic,x=input();x.feedback[0].interpretation={source:'ai',text:'INVENTED INFERENCE'};
 assert.doesNotMatch(JSON.stringify(prepare(x).payload),/INVENTED/);
 x.feedback[0].interpretation={source:'recruiter',text:'Clarified ownership',updatedAt:2};
 assert.match(JSON.stringify(prepare(x).payload),/Clarified ownership/);
});

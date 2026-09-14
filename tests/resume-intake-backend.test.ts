import {handleAnalysis} from '../supabase/functions/analyze-patterns-v2/index.ts';
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const resume='Alex Carter\nQA Analyst\nOwned manual regression testing for billing systems.';
const analysis={name:'Alex Carter',role:'QA Analyst',score:8,manager_score:8.5,primary_signal:'Relevant manual testing.',jd_reason:'Manual testing demonstrated.',manager_reason:'Ownership matches approved context.',strengths:['Manual testing'],concerns:['Verify automation scope.'],tags:['QA'],screening_questions:['What testing did you personally own?'],resume_evidence:[{claim:'Manual regression',quote:'Owned manual regression testing for billing systems'}]};
Deno.test('automatic intake validates quoted evidence, preserves approved context, and keeps legacy resume clients compatible',async()=>{
 const original=globalThis.fetch;Deno.env.set('OPENAI_API_KEY','test-only');let output:unknown=analysis,auto=true;
 globalThis.fetch=async(_url,init)=>{
  const body=JSON.parse(String(init?.body));
  assert(body.store===false,'resume model storage must be disabled');
  assert(body.input.includes('preference-1'),'approved preference lost');
  if(auto){assert(body.text.format.schema.required.includes('resume_evidence'),'missing quote schema');assert(body.max_output_tokens===2500,'unbounded intake output');assert(body.instructions.includes('untrusted'),'source instructions not isolated');}
  return new Response(JSON.stringify({output_text:JSON.stringify(output)}),{status:200});
 };
 const request=()=>new Request('https://example.invalid/analysis',{method:'POST',body:JSON.stringify({analysis_type:'resume',auto_intake:auto,job:{title:'QA'},resume_text:resume,evaluation_context:{sources:[{id:'preference-1',text:'Manual testing ownership',scope:'job'}]}})});
 try{
  let response=await handleAnalysis(request());assert(response.ok,'valid resume rejected');const result=await response.json();assert(result.manager_score===8.5&&result.resume_evidence.length===1,'screening brief missing');
  output={...analysis,resume_evidence:[{claim:'Manager',quote:'Led twenty engineers across two countries'}]};response=await handleAnalysis(request());assert(response.status===502,'invented quotation accepted');
  auto=false;output={name:'Legacy Candidate',score:7};assert((await handleAnalysis(request())).ok,'legacy resume client broken');
 }finally{globalThis.fetch=original;Deno.env.delete('OPENAI_API_KEY');}
});


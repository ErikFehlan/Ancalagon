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
  if(auto){assert(body.text.format.schema.required.includes('resume_evidence'),'missing quote schema');assert([2500,3200].includes(body.max_output_tokens),'unbounded intake output');assert(body.instructions.includes('untrusted'),'source instructions not isolated');}
  return new Response(JSON.stringify({output_text:JSON.stringify(output)}),{status:200});
 };
 const request=()=>new Request('https://example.invalid/analysis',{method:'POST',body:JSON.stringify({analysis_type:'resume',auto_intake:auto,job:{title:'QA'},resume_text:resume,evaluation_context:{sources:[{id:'preference-1',text:'Manual testing ownership',scope:'job'}]}})});
 try{
  let response=await handleAnalysis(request());assert(response.ok,'valid resume rejected');const result=await response.json();assert(result.manager_score===8.5&&result.resume_evidence.length===1,'screening brief missing');
  output={...analysis,resume_evidence:[{claim:'Manager',quote:'Led twenty engineers across two countries'}]};response=await handleAnalysis(request());assert(response.status===502,'invented quotation accepted');
  auto=false;output={name:'Legacy Candidate',score:7};assert((await handleAnalysis(request())).ok,'legacy resume client broken');
 }finally{globalThis.fetch=original;Deno.env.delete('OPENAI_API_KEY');}
});


Deno.test('intake repairs one invalid response, rejects repeated failures, and restores exact Word source quotes',async()=>{
 const original=globalThis.fetch;Deno.env.set('OPENAI_API_KEY','test-only');
 const wordResume='Alex Carter\nQA Analyst\nOwned risk •documentation and business\u2011aligned security controls.';
 const valid={...analysis,resume_evidence:[{claim:'Risk documentation',quote:'Owned risk documentation and business-aligned security controls.'}]};
 let outputs:unknown[]=[],requests:Record<string,any>[]=[];
 globalThis.fetch=async(_url,init)=>{
  requests.push(JSON.parse(String(init?.body)));const output=outputs.shift();
  return new Response(JSON.stringify(typeof output==='string'?{output_text:output}:output),{status:200});
 };
 const request=()=>new Request('https://example.invalid/analysis',{method:'POST',body:JSON.stringify({analysis_type:'resume',auto_intake:true,job:{title:'QA'},resume_text:wordResume})});
 const output=(value:unknown)=>({output_text:JSON.stringify(value)});
 try{
  outputs=[output(valid)];let response=await handleAnalysis(request());assert(response.ok,'typography must not cause a retry');let result=await response.json();assert(requests.length===1,'unneeded second model call');assert(wordResume.includes(result.resume_evidence[0].quote),'must return original source text');
  for(const bad of [output({...valid,resume_evidence:[{claim:'Invented',quote:'Managed a team of twenty engineers'}]}),output({...valid,jd_reason:''}),'{truncated', {status:'incomplete',output_text:JSON.stringify(valid)}]){
   requests=[];outputs=[bad,output(valid)];response=await handleAnalysis(request());assert(response.ok,'automatic repair failed');result=await response.json();assert(requests.length===2,'repair must run exactly once');assert(requests[1].instructions.includes('VALIDATION REPAIR'),'repair context missing');assert(requests[0].input===requests[1].input,'original evidence changed');assert(!requests[1].input.includes('Managed a team of twenty'),'failed model claims must not become evidence');assert(requests[1].store===false,'retry must not store model content');
  }
  requests=[];outputs=[output({...valid,manager_score:NaN}),output({...valid,manager_score:NaN})];response=await handleAnalysis(request());assert(response.status===502&&requests.length===2,'invalid scores accepted or unlimited retries');result=await response.json();assert(result.code==='resume_validation_failed'&&result.validation_issue==='invalid_score','diagnostic category missing');assert(!JSON.stringify(result).includes('Alex Carter'),'error response leaked resume');
  const properties=requests[0].text.format.schema.properties;assert(properties.tags.items.maxLength===100&&properties.resume_evidence.items.properties.quote.minLength===12,'schema and validator limits differ');
 }finally{globalThis.fetch=original;Deno.env.delete('OPENAI_API_KEY');}
});

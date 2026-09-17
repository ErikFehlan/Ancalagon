import {analysisModel,modelReasoning} from '../supabase/functions/_shared/model-routing.mjs';
import {handleAnalysis} from '../supabase/functions/analyze-patterns-v2/analysis.ts';
import {handleSolCheck} from '../supabase/functions/sol-model-check/handler.ts';
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
Deno.test('Sol is used for assessments and feedback; inexpensive and pinned routes remain separate',()=>{
 const env=(key:string)=>key==='OPENAI_MODEL'?'gpt-4.1-mini':undefined;
 for(const task of ['feedback','resume','screening','reassessment'])assert(analysisModel(task,env)==='gpt-5.6-sol','old global setting overrode '+task);
 assert(analysisModel('patterns',env)==='gpt-4.1-mini','pattern workload changed');
 assert(analysisModel('feedback',key=>key==='FEEDBACK_MODEL'?'gpt-4.1-mini-2025-04-14':undefined)==='gpt-4.1-mini-2025-04-14','server rollback unavailable');
 assert(modelReasoning('gpt-5.6-sol').reasoning?.effort==='none','Sol inherited medium reasoning');
 for(const model of ['gpt-4.1-mini','ft:gpt-4.1-mini-2025-04-14:test:model'])assert(!Object.hasOwn(modelReasoning(model),'reasoning'),'Sol parameters leaked into legacy models');
});
Deno.test('public payload cannot select a model; Sol preserves the feedback contract and quota reservation',async()=>{
 const saved=globalThis.fetch,names=['OPENAI_API_KEY','FEEDBACK_MODEL','ASSESSMENT_MODEL','OPENAI_MODEL'],previous=names.map(n=>Deno.env.get(n));
 Deno.env.set('OPENAI_API_KEY','synthetic');Deno.env.set('OPENAI_MODEL','gpt-4.1-mini');Deno.env.delete('FEEDBACK_MODEL');Deno.env.delete('ASSESSMENT_MODEL');
 let reserved=false;
 globalThis.fetch=async(_url,init)=>{
  const body=JSON.parse(String(init?.body));
  assert(reserved,'provider preceded budget reservation');
  assert(body.model==='gpt-5.6-sol'&&body.reasoning.effort==='none','wrong model or effort');
  assert(body.max_output_tokens===700&&body.store===false,'output/privacy contract changed');
  assert(body.text.format.strict&&body.text.format.name==='feedback_interpretation','structured contract changed');
  return new Response(JSON.stringify({model:body.model,output_text:JSON.stringify({summary:'Ownership remains unclear.',clarification_question:'What work did they personally own?'})}));
 };
 try{
  const r=await handleAnalysis(new Request('https://synthetic.invalid',{method:'POST',body:JSON.stringify({analysis_type:'feedback',model:'gpt-6-astra',modelOverride:'gpt-6-astra',feedbackModel:'attacker',job:{title:'QA'},feedback:{text:'Ownership unclear'}})}),{beforeModel:async(bytes,tokens)=>{assert(bytes>0&&tokens===700,'wrong quota bound');reserved=true;}});
  assert(r.ok&&(await r.json()).model==='gpt-5.6-sol','model provenance missing');
 }finally{globalThis.fetch=saved;names.forEach((n,i)=>previous[i]===undefined?Deno.env.delete(n):Deno.env.set(n,previous[i]!));}
});
Deno.test('temporary Sol validation rejects ordinary users before any API or database request',async()=>{
 const saved=globalThis.fetch,prior=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','server-only');
 globalThis.fetch=()=>{throw Error('Unauthorized validation reached remote service');};
 try{
  for(const token of ['', 'ordinary-user'])assert((await handleSolCheck(new Request('https://synthetic.invalid',{method:'POST',headers:{Authorization:'Bearer '+token},body:'{}'}))).status===401,'non-service caller admitted');
  assert((await handleSolCheck(new Request('https://synthetic.invalid',{method:'POST',headers:{Authorization:'Bearer server-only'},body:'{"case":"arbitrary","model":"sol"}'}))).status===400,'arbitrary input accepted');
 }finally{globalThis.fetch=saved;if(prior===undefined)Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');else Deno.env.set('SUPABASE_SERVICE_ROLE_KEY',prior);}
});

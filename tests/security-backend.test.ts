import {handleAuthenticatedAnalysis} from '../supabase/functions/analyze-patterns-beta/handler.ts';
import {boundedJSON, reserveModelCall, SecurityLimit} from '../supabase/functions/_shared/security.ts';
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status});
const payload={workspace_id:'owned-workspace',user_id:'forged-user',analysis_type:'feedback',job:{title:'Synthetic'},feedback:{text:'Verify testing ownership'}};
const request=(body:unknown=payload)=>new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Bearer caller'},body:JSON.stringify(body)});
function configure(){const values={SUPABASE_URL:'https://backend.invalid',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'private',OPENAI_API_KEY:'synthetic'};
 const old=Object.fromEntries(Object.keys(values).map(k=>[k,Deno.env.get(k)]));Object.entries(values).forEach(([k,v])=>Deno.env.set(k,v));
 return()=>Object.keys(values).forEach(k=>old[k]===undefined?Deno.env.delete(k):Deno.env.set(k,old[k]!));}
Deno.test('AI limits fail closed before provider work and ignore forged caller identity',async()=>{
 const restore=configure(),original=globalThis.fetch;let budget:unknown={allowed:false,code:'usage_limit'},budgetStatus=200,providerCalls=0,reservations=0,custom=true;
 globalThis.fetch=async(url,init)=>{
  const u=String(url);
  if(u.includes('workspace_members'))return json([{workspace_id:'owned-workspace'}]);
  if(u.includes('/auth/v1/user'))return json({id:'verified-caller'});
  if(u.includes('ai_usage_events'))return json({});
  if(u.includes('get_feedback_learning_model'))return json(custom?'ft:gpt-4.1-mini-2025-04-14:test:feedback:model':null);
  if(u.includes('reserve_ai_budget')){reservations++;const p=JSON.parse(String(init?.body));
   assert(p.p_actor==='verified-caller'&&p.p_workspace==='owned-workspace','client forged budget scope');
   assert(p.p_input_bytes>0&&p.p_output_tokens===700,'unbounded model reservation');
   assert(new Headers(init?.headers).get('Authorization')==='Bearer private','reservation uses client credential');
   if(budget==='offline')throw Error('Transport unavailable');return json(budget,budgetStatus);
  }
  providerCalls++;return json({output_text:JSON.stringify({summary:'Testing ownership needs evidence.',clarification_question:null})});
 };
 try{
  for(const code of ['usage_limit','ai_paused','beta_access_required']){
   budget={allowed:false,code};const response=await handleAuthenticatedAnalysis(request());
   assert(response.status===(code==='beta_access_required'?403:429),'wrong limit response');
   assert((await response.json()).code===code&&providerCalls===0,'blocked request reached provider or fell back');
  }
  for(const failure of ['offline',{},null,{allowed:true}]){
   budget=failure;budgetStatus=failure&&typeof failure==='object'&&'allowed' in failure?503:200;
   const response=await handleAuthenticatedAnalysis(request());assert(response.status===503&&providerCalls===0,'unavailable admission failed open');
  }
  budget={allowed:true};budgetStatus=200;custom=false;
  assert((await handleAuthenticatedAnalysis(request())).ok&&Number(providerCalls)===1,'approved request failed');
  assert(reservations===8,'a rejection bypassed or retried its budget check');
 }finally{globalThis.fetch=original;restore();}
});
Deno.test('body limits reject oversized streams even without a Content-Length header',async()=>{
 const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(800001));c.close();}});
 try{await boundedJSON(new Request('https://test.invalid',{method:'POST',body}));throw Error('Oversized body accepted');}
 catch(e){assert(e instanceof SecurityLimit&&e.status===413,'wrong streaming limit');}
});
Deno.test('budget configuration is required; no missing-secret bypass',async()=>{
 const old=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
 try{await reserveModelCall('workspace',null,100,100);throw Error('Missing secret bypassed limit');}
 catch(e){assert(e instanceof SecurityLimit&&e.status===503,'unexpected missing config result');}
 finally{if(old)Deno.env.set('SUPABASE_SERVICE_ROLE_KEY',old);}
});

import {handleAuthenticatedAnalysis} from '../supabase/functions/analyze-patterns-beta/handler.ts';
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status});
Deno.test('learning models are workspace scoped, feedback only, server selected, and fail back to base',async()=>{
 const saved=globalThis.fetch,names={OPENAI_API_KEY:'synthetic',SUPABASE_URL:'https://synthetic.invalid',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'service'};
 const prior=Object.fromEntries(Object.keys(names).map(k=>[k,Deno.env.get(k)]));Object.entries(names).forEach(([k,v])=>Deno.env.set(k,v));
 let allowed=true,lookupFail=false,modelFail=false,lookups=0,failureStatus=200;const models:string[]=[];
 const model='ft:gpt-4.1-mini-2025-04-14:synthetic:feedback:model',base='gpt-5.6-sol';
 globalThis.fetch=async(url,init)=>{
  const u=String(url),body=init?.body?JSON.parse(String(init.body)):null;
  if(u.includes('/reserve_ai_budget'))return json({allowed:true});
  if(u.includes('workspace_members'))return json(allowed?[{workspace_id:'a'}]:[],allowed?200:403);
  if(u.includes('/auth/v1/user'))return json({id:'user'});
  if(u.includes('ai_usage_events'))return json({});
  if(u.includes('get_feedback_learning_model')){
   lookups++;assert(new Headers(init?.headers).get('Authorization')==='Bearer caller','lookup used elevated identity');
   if(lookupFail)throw Error('Unavailable');return json(body.p_workspace==='a'?model:null);
  }
  models.push(body.model);
  if(modelFail&&body.model===model&&failureStatus!==200)return json({error:{type:"synthetic",code:"unavailable"}},failureStatus);
  if(modelFail&&body.model===model)return json({output_text:'{"summary":"missing question"}'});
  return json({model:body.model,output_text:JSON.stringify({summary:'Documented ownership.',clarification_question:null})});
 };
 const request=(workspace='a',type='feedback')=>new Request('https://synthetic.invalid',{method:'POST',headers:{Authorization:'Bearer caller'},body:JSON.stringify({workspace_id:workspace,analysis_type:type,model:'ft:attacker',feedbackModel:'ft:attacker',job:{title:'QA'},feedback:{text:'Owned planning'},screening:{notes:'Owned planning'}})});
 try{
  assert((await handleAuthenticatedAnalysis(request())).ok&&models.at(-1)===model,'approved model not used');
  assert((await handleAuthenticatedAnalysis(request('b'))).ok&&models.at(-1)===base,'model crossed workspace');
  lookupFail=true;assert((await handleAuthenticatedAnalysis(request())).ok&&models.at(-1)===base,'registry failure broke base');lookupFail=false;
  modelFail=true;for(const status of [200,404,429,503]){failureStatus=status;const before=models.length;assert((await handleAuthenticatedAnalysis(request())).ok&&models.length===before+2&&models.at(-1)===base,'invalid or unavailable custom model did not fall back');}modelFail=false;
  const calls=lookups;assert((await handleAuthenticatedAnalysis(request('a','screening'))).ok&&lookups===calls,'learning model reached candidate scoring');
  allowed=false;const count=models.length;assert((await handleAuthenticatedAnalysis(request())).status===403&&models.length===count&&lookups===calls,'unauthorized request resolved or invoked a model');
 }finally{globalThis.fetch=saved;Object.keys(names).forEach(k=>prior[k]===undefined?Deno.env.delete(k):Deno.env.set(k,prior[k]!));}
});

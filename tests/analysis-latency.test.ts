import { handleAnalysis } from '../supabase/functions/analyze-patterns-v2/index.ts';
import { handleAuthenticatedAnalysis } from '../supabase/functions/analyze-patterns-beta/handler.ts';
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status});
const payload = {analysis_type:'feedback',workspace_id:'workspace-a',job:{title:'QA'},feedback:{text:'Strong technically; ownership unclear'},evaluation_context:{sources:[{id:'feedback-1',text:'Strong technically; ownership unclear'}]}};
const request = (body: unknown) => new Request('https://example.invalid/analysis', {method:'POST',headers:{Authorization:'Bearer test-only'},body:JSON.stringify(body)});
const modelResult = {model:'test-model',output_text:JSON.stringify({summary:'Technical strength noted. Ownership needs clarification.',clarification_question:'What did they personally own?'})};

Deno.test('feedback uses a short non-scoring schema and preserves supplied context', async () => {
  const oldFetch=globalThis.fetch; Deno.env.set('OPENAI_API_KEY','test-only');
  let calls=0;
  globalThis.fetch=async (_url,init) => {
    const body=JSON.parse(String(init?.body));calls++;
    assert(body.max_output_tokens===700,'short output cap missing');
    assert(body.text.format.name==='feedback_interpretation','wrong task');
    assert(body.text.format.schema.required.join(',')==='summary,clarification_question','unneeded score output');
    assert(body.input.includes('feedback-1'),'context removed');
    assert(body.instructions.includes('Candidate-only feedback'),'scope instruction missing');
    return json(modelResult);
  };
  try {
    for (const body of [payload,{...payload,analysis_type:'screening',screening:{notes:payload.feedback.text},evaluation_context:{...payload.evaluation_context,feedback_interpretation_task:'legacy client'}}]) {
      const response=await handleAnalysis(request(body)),out=await response.json();
      assert(response.ok&&out.clarification_question,'missing interpretation');
      assert(out.manager_score===undefined,'feedback generated a score');
    }
    const invalid=await handleAnalysis(request({...payload,feedback:{text:''}}));
    assert(invalid.status===400&&calls===2,'empty note reached the model');
  } finally {globalThis.fetch=oldFetch;Deno.env.delete('OPENAI_API_KEY');}
});

Deno.test('malformed authenticated payloads fail before any remote requests',async()=>{
 const oldFetch=globalThis.fetch;
 const names=['SUPABASE_URL','SUPABASE_ANON_KEY'],prior=names.map(n=>Deno.env.get(n));
 Deno.env.set('SUPABASE_URL','https://example.invalid');Deno.env.set('SUPABASE_ANON_KEY','test-public');
 globalThis.fetch=async()=>{throw Error('Malformed payload reached remote service');};
 try{for(const body of [null,[],42])assert((await handleAuthenticatedAnalysis(request(body))).status===400,'invalid shape was not rejected');}
 finally{globalThis.fetch=oldFetch;names.forEach((n,i)=>prior[i]===undefined?Deno.env.delete(n):Deno.env.set(n,prior[i]!));}
});

Deno.test('real screening still uses the full score schema', async () => {
  const oldFetch=globalThis.fetch;Deno.env.set('OPENAI_API_KEY','test-only');
  globalThis.fetch=async (_url,init)=>{
    const body=JSON.parse(String(init?.body));
    assert(body.text.format.name==='screening_reassessment','screening routed to feedback');
    assert(body.text.format.schema.required.includes('manager_score'),'score schema removed');
    assert(body.max_output_tokens===undefined,'feedback cap affected screening');
    return json({output_text:JSON.stringify({summary:'screen',manager_score:7,jd_score:7})});
  };
  try {assert((await handleAnalysis(request({...payload,analysis_type:'screening',screening:{notes:'Specific technical example'}}))).ok,'screen failed');}
  finally{globalThis.fetch=oldFetch;Deno.env.delete('OPENAI_API_KEY');}
});

Deno.test('auth checks overlap, model waits for both, telemetry does not delay response', async () => {
  const oldFetch=globalThis.fetch;
  const globals=globalThis as typeof globalThis & {EdgeRuntime?:{waitUntil(p:Promise<unknown>):void}};
  const oldRuntime=globals.EdgeRuntime;
  for(const [key,value] of Object.entries({OPENAI_API_KEY:'test-only',SUPABASE_URL:'https://example.invalid',SUPABASE_ANON_KEY:'test-public',SUPABASE_SERVICE_ROLE_KEY:'test-service'}))Deno.env.set(key,value);
  let releaseMember!:(r:Response)=>void,releaseUser!:(r:Response)=>void,releaseUsage!:(r:Response)=>void;
  let authCalls=0,modelCalled=false,background:Promise<unknown>|undefined;
  globals.EdgeRuntime={waitUntil:p=>{background=p;}};
  globalThis.fetch=(url,init)=>{
    const u=String(url);
    if(u.includes('workspace_members')){authCalls++;return new Promise(r=>{releaseMember=r;});}
    if(u.includes('/auth/v1/user')){authCalls++;return new Promise(r=>{releaseUser=r;});}
    if(u.includes('ai_usage_events')){
      const row=JSON.parse(String(init?.body));assert(row.operation==='screening_reassessment','unsupported usage type');
      return row.status==='started'?new Promise(r=>{releaseUsage=r;}):Promise.resolve(json({}));
    }
    modelCalled=true;return Promise.resolve(json(modelResult));
  };
  try{
    const pending=handleAuthenticatedAnalysis(request(payload));
    // Parsing a cloned request is asynchronous; wait until the two auth calls start.
    for(let i=0;i<100&&(!releaseMember||!releaseUser);i++)await new Promise(r=>setTimeout(r,1));
    assert(typeof releaseMember==='function'&&typeof releaseUser==='function','auth checks did not start together');assert(!modelCalled,'model ran before authorization');
    releaseMember(json([{workspace_id:'workspace-a'}]));releaseUser(json({id:'test-user'}));
    const response=await pending;
    assert(response.ok&&modelCalled&&typeof releaseUsage==='function'&&background,'response blocked on telemetry');
    releaseUsage(json({}));await background;
    // Rejecting membership must still prevent any model request.
    modelCalled=false;
    const rejected=handleAuthenticatedAnalysis(request(payload));
    for(let i=0;i<1000&&authCalls<4;i++)await new Promise(r=>setTimeout(r,1));
    assert(authCalls===4,'second auth checks did not start');releaseMember(json([],403));releaseUser(json({id:'test-user'}));
    assert((await rejected).status===403&&!modelCalled,'workspace authorization bypassed');
  }finally{
    globalThis.fetch=oldFetch;globals.EdgeRuntime=oldRuntime;
    for(const key of ['OPENAI_API_KEY','SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'])Deno.env.delete(key);
  }
});

Deno.test('AI telemetry retries a stable operation identity using server credentials',async()=>{
 const oldFetch=globalThis.fetch,rows:Array<{status:string;request_id:string}>=[];
 const values={OPENAI_API_KEY:'test-only',SUPABASE_URL:'https://example.invalid',SUPABASE_ANON_KEY:'test-public',SUPABASE_SERVICE_ROLE_KEY:'test-service'};
 const prior=Object.fromEntries(Object.keys(values).map(k=>[k,Deno.env.get(k)]));
 Object.entries(values).forEach(([k,v])=>Deno.env.set(k,v));
 let retried=false,modelOK=true;
 globalThis.fetch=async(url,init)=>{
  const u=String(url);
  if(u.includes('workspace_members'))return json([{workspace_id:'workspace-a'}]);
  if(u.includes('/auth/v1/user'))return json({id:'test-user'});
  if(u.includes('ai_usage_events')){
   const row=JSON.parse(String(init?.body));rows.push(row);
   assert(new Headers(init?.headers).get('Authorization')==='Bearer test-service','client credential used for trusted telemetry');
   assert(u.includes('on_conflict=request_id,status'),'retry deduplication missing');
   if(row.status==='succeeded'&&!retried){retried=true;throw Error('Lost response after commit');}
   return json({});
  }
  return modelOK?json(modelResult):json({error:{message:'Synthetic unavailable'}},503);
 };
 try{
  assert((await handleAuthenticatedAnalysis(request(payload))).ok,'analysis failed');
  assert(rows.length===3&&new Set(rows.map(r=>r.request_id)).size===1,'transport retry used a second operation identity');
  modelOK=false;assert(!(await handleAuthenticatedAnalysis(request(payload))).ok,'failed model treated as success');
  assert(rows.at(-1)?.status==='failed','failure recorded as completion');
  assert(new Set(rows.map(r=>r.request_id)).size===2,'separate requests shared an identity');
 }finally{globalThis.fetch=oldFetch;Object.keys(values).forEach(k=>prior[k]===undefined?Deno.env.delete(k):Deno.env.set(k,prior[k]!));}
});

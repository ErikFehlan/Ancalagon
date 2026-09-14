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
  for(const [key,value] of Object.entries({OPENAI_API_KEY:'test-only',SUPABASE_URL:'https://example.invalid',SUPABASE_ANON_KEY:'test-public'}))Deno.env.set(key,value);
  let releaseMember!:(r:Response)=>void,releaseUser!:(r:Response)=>void,releaseUsage!:(r:Response)=>void;
  let modelCalled=false,background:Promise<unknown>|undefined;
  globals.EdgeRuntime={waitUntil:p=>{background=p;}};
  globalThis.fetch=(url,init)=>{
    const u=String(url);
    if(u.includes('workspace_members'))return new Promise(r=>{releaseMember=r;});
    if(u.includes('/auth/v1/user'))return new Promise(r=>{releaseUser=r;});
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
    assert(releaseMember&&releaseUser,'auth checks did not start together');assert(!modelCalled,'model ran before authorization');
    releaseMember(json([{workspace_id:'workspace-a'}]));releaseUser(json({id:'test-user'}));
    const response=await pending;
    assert(response.ok&&modelCalled&&releaseUsage&&background,'response blocked on telemetry');
    releaseUsage(json({}));await background;
    // Rejecting membership must still prevent any model request.
    modelCalled=false;
    const rejected=handleAuthenticatedAnalysis(request(payload));
    await new Promise(r=>setTimeout(r,5));releaseMember(json([],403));releaseUser(json({id:'test-user'}));
    assert((await rejected).status===403&&!modelCalled,'workspace authorization bypassed');
  }finally{
    globalThis.fetch=oldFetch;globals.EdgeRuntime=oldRuntime;
    for(const key of ['OPENAI_API_KEY','SUPABASE_URL','SUPABASE_ANON_KEY'])Deno.env.delete(key);
  }
});

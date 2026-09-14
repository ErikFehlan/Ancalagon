import {handleReassessment} from '../supabase/functions/reassess-job/handler.ts';
function assert(condition:unknown,message='Assertion failed'){if(!condition)throw Error(message);}
Deno.test('reassessment endpoint requires its private credential before configuration or work is exposed',async()=>{
 const names=['JOB_REASSESSMENT_SECRET','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','OPENAI_API_KEY'];
 const previous=Object.fromEntries(names.map(name=>[name,Deno.env.get(name)]));
 try{
  Deno.env.set('JOB_REASSESSMENT_SECRET','private-worker-test');Deno.env.set('SUPABASE_URL','https://unused.invalid');Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','private-service-test');Deno.env.set('OPENAI_API_KEY','private-ai-test');
  const unauthorized=await handleReassessment(new Request('https://worker.invalid',{method:'POST',body:'{"health":true}'}));assert(unauthorized.status===401);
  const health=await handleReassessment(new Request('https://worker.invalid',{method:'POST',headers:{'x-worker-secret':'private-worker-test'},body:'{"health":true}'}));
  assert(health.status===200);const text=await health.text();assert(text.includes('job_reassessment'));assert(!text.includes('private-'));
  const invalid=await handleReassessment(new Request('https://worker.invalid',{method:'POST',headers:{'x-worker-secret':'private-worker-test'},body:'{"job_id":"not-a-job"}'}));assert(invalid.status===400);
  const malformed=await handleReassessment(new Request('https://worker.invalid',{method:'POST',headers:{'x-worker-secret':'private-worker-test'},body:'null'}));assert(malformed.status===400);
 }finally{for(const name of names){if(previous[name]===undefined)Deno.env.delete(name);else Deno.env.set(name,previous[name]!);}}
});

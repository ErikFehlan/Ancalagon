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

Deno.test('saved resumes start while job edits are still coalescing and retain their lease',async()=>{
 const names=['JOB_REASSESSMENT_SECRET','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','OPENAI_API_KEY'];
 const previous=Object.fromEntries(names.map(name=>[name,Deno.env.get(name)]));
 const originalFetch=globalThis.fetch,originalTimer=globalThis.setTimeout;
 let releaseDelay:()=>void=()=>{},markStarted:()=>void=()=>{},markDelayed:()=>void=()=>{},timer:ReturnType<typeof setTimeout>|undefined;
 const started=new Promise<void>(resolve=>markStarted=resolve),delayed=new Promise<void>(resolve=>markDelayed=resolve);
 let finished=false,jobClaimed=false,run:Promise<Response>|undefined;
 const task={candidate_id:'c',revision:'revision-1',lease_id:'lease-1',input:{job:{id:'j',title:'Synthetic QA',criteria:[],weights:[],knockouts:[]},candidate:{id:'c',jobId:'j'},feedback:[],outcomes:[],resume_text:'Synthetic QA Analyst. Owned manual regression testing and documented defects.',file_name:'Synthetic.txt'}};
 try{
  for(const [name,value] of Object.entries({JOB_REASSESSMENT_SECRET:'test-worker',SUPABASE_URL:'https://backend.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-service',OPENAI_API_KEY:'test-ai'}))Deno.env.set(name,value);
  globalThis.setTimeout=((callback:()=>void,ms:number)=>{
   if(ms===3500){releaseDelay=()=>callback();markDelayed();return 0;}
   return originalTimer(callback,ms);
  }) as typeof setTimeout;
  globalThis.fetch=async(url,init)=>{
   const path=new URL(String(url)).pathname;
   const json=(data:unknown)=>new Response(JSON.stringify(data));
   if(path.endsWith('/claim_account_deletions'))return json([]);
   if(path.endsWith('/claim_resume_intakes'))return json([task]);
   if(path==='/v1/responses'){
    markStarted();
    return json({output_text:JSON.stringify({name:'Synthetic QA Analyst',role:'QA Analyst',score:7,manager_score:7,primary_signal:'Testing ownership',jd_reason:'Testing evidence',manager_reason:'Ownership evidence',concerns:[],tags:['QA'],screening_questions:[],resume_evidence:[{claim:'Manual regression ownership',source_id:'resume-1'}]})});
   }
   if(path.endsWith('/finish_resume_intake')){const body=JSON.parse(String(init?.body));assert(body.p_lease==='lease-1'&&body.p_revision==='revision-1','Lease or revision changed');assert(body.p_error===null&&body.p_result.resume_evidence[0].quote===task.input.resume_text,'Grounded completion missing');finished=true;return json(true);}
   if(path.endsWith('/claim_job_reassessments')){jobClaimed=true;return json([]);}
   throw Error('Unexpected test request');
  };
  run=handleReassessment(new Request('https://worker.invalid',{method:'POST',headers:{'x-worker-secret':'test-worker'},body:'{}'}));
  await delayed;
  const immediate=await Promise.race([started.then(()=>true),new Promise<boolean>(resolve=>timer=originalTimer(()=>resolve(false),100))]);
  if(timer!==undefined)clearTimeout(timer);
  assert(immediate,'Resume model waited for the job debounce');assert(!jobClaimed,'Job debounce was removed');
  releaseDelay();const response=await run;assert(response.ok&&finished,'Intake was not completed durably');
 }finally{
  releaseDelay();if(run)await run;globalThis.fetch=originalFetch;globalThis.setTimeout=originalTimer;
  if(timer!==undefined)clearTimeout(timer);
  for(const name of names){if(previous[name]===undefined)Deno.env.delete(name);else Deno.env.set(name,previous[name]!);}
 }
});

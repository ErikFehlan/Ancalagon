import {handleAnalysis} from '../analyze-patterns-v2/analysis.ts';
import {reserveModelCall} from '../_shared/security.ts';
import {assessmentModelDefault} from '../_shared/model-routing.mjs';

const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
// Synthetic fixtures only. This temporary deployment has no applicant-data input
// and is removed before the normal production functions are updated.
export const fixtures={
 feedback:{analysis_type:'feedback',job:{title:'QA Analyst'},feedback:{text:'Strong manual tester. Their team uses Playwright, but they said they have never written or maintained automated tests themselves.'},evaluation_context:{sources:[{id:'note-1',text:'Strong manual tester. Their team uses Playwright, but they said they have never written or maintained automated tests themselves.'}]}},
 resume:{analysis_type:'resume',auto_intake:true,job:{title:'QA Analyst',criteria:['Must Have | manual regression testing','Preferred | test automation']},resume_text:'Synthetic Candidate\nQA Analyst\nOwned manual regression testing for billing systems and documented defects through remediation. Participated in a team using Playwright but did not write or maintain automated tests.',evaluation_context:{}},
 screening:{analysis_type:'screening',job:{title:'QA Analyst'},candidate:{jdScore:7,managerScore:6},screening:{notes:'Candidate confirmed ownership of manual regression testing. They explicitly said they have never written or maintained automated tests.'},evaluation_context:{}},
};
export async function handleSolCheck(request:Request){
 // Match the already deployed private worker transport. A service API key is
 // not assumed to be the exact JWT exposed inside an Edge Function isolate.
 const secret=Deno.env.get('JOB_REASSESSMENT_SECRET');
 if(!secret||request.headers.get('x-worker-secret')!==secret)return json({error:'Unauthorized'},401);
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 const body=await request.json().catch(()=>null);
 if(!body||!Object.hasOwn(fixtures,body.case)||!['sol','baseline'].includes(body.model)||! /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(body.workspace_id||''))return json({error:'Invalid synthetic check'},400);
 const fixture=fixtures[body.case as keyof typeof fixtures];
 const model=body.model==='sol'?assessmentModelDefault:'gpt-4.1-mini-2025-04-14';
 const started=performance.now();
 const result=await handleAnalysis(new Request('https://synthetic.invalid/analysis',{method:'POST',body:JSON.stringify(fixture)}),{
  modelOverride:model,beforeModel:(bytes,tokens)=>reserveModelCall(body.workspace_id,null,bytes,tokens),
 });
 return json({case:body.case,requested_model:model,duration_ms:Math.round(performance.now()-started),result:await result.json()},result.status);
}

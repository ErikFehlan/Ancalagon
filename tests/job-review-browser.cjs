const {chromium}=require('playwright'),fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict');
const dir=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(dir,req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');try{res.end(fs.readFileSync(file))}catch{res.statusCode=404;res.end()}}).listen(0,'127.0.0.1');
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**',r=>r.abort());
  await page.route('**/assets/auth.js*',r=>r.fulfill({contentType:'application/javascript',body:"document.body.classList.remove('rf-auth-pending');document.getElementById('authGate').style.display='none';"}));
  await page.route('**/assets/data.js*',r=>r.fulfill({contentType:'application/javascript',body:''}));
  let screeningCalls=0;
  await page.route('**/functions/v1/**',route=>{const p=route.request().postDataJSON();if(p.analysis_type==='screening')screeningCalls++;return route.fulfill({json:{summary:'Manual testing observation captured.',clarification_question:null}});});
  await page.addInitScript(()=>{
   const clone=x=>JSON.parse(JSON.stringify(x));
   const job=(id,title)=>({id,title,description:'Manual QA',criteria:['Must Have | manual testing'],weights:[],knockouts:[],status:'active',createdAt:1,updatedAt:1});
   const candidate=(id,jobId,name)=>({id,jobId,name,short:name,role:'QA',stage:'Sourced',resumeJDScore:7,jdScore:7,originalManagerScore:7,managerScore:7,rec:'Consider',signal:'Manual testing',strengths:['Manual regression ownership'],concerns:[],tags:[],screeningQuestions:[],createdAt:1,updatedAt:1,aiReview:null});
   window.fixture={jobs:[job('job-a','QA search'),job('job-b','Other search')],candidates:[candidate('candidate-a','job-a','Alice'),candidate('candidate-b','job-a','Bob'),candidate('candidate-other','job-b','PRIVATE OTHER JOB')],feedback:[],interviewOutcomes:[]};
   const result={manager_score:9,jd_score:8,confidence:'medium',summary:'Updated priorities reviewed',manager_reason:'Manual regression ownership supports the new priority.',jd_reason:'Qualification baseline unchanged.',evidence_ids:['profile-strength-1'],questions:['What testing did you personally own?']};
   window.reviewRows={'job-a':[{job_id:'job-a',candidate_id:'candidate-a',revision:'a1',status:'ready',reason:'Job requirements changed',result},{job_id:'job-a',candidate_id:'candidate-b',revision:'b1',status:'processing',reason:'Job requirements changed'}],'job-b':[{job_id:'job-b',candidate_id:'candidate-other',revision:'other',status:'ready',reason:'Other job',result}]};
   window.requests=[];window.testSaved=clone(window.fixture);
   window.AncalagonData={create:()=>({
    load:async()=>clone(window.fixture),schedule:(s,e,status)=>{window.testSaved=clone(s);status('saved');},flush:async s=>{window.testSaved=clone(s);},
    trackEvent:async()=>{},loadAdminAnalytics:async()=>{throw Error('not admin');},
    loadJobReassessments:async id=>clone(window.reviewRows[id]||[]),
    requestCandidateReassessment:async id=>{window.requests.push(id);const t=Object.values(window.reviewRows).flat().find(t=>t.candidate_id===id);if(t){t.status='processing';t.revision+='new';}},
    reviewJobReassessment:async(id,revision,decision,s)=>{
     if(window.failNextReview){window.failNextReview=false;throw Error('Evidence changed. Review the latest assessment.');}
     const t=Object.values(window.reviewRows).flat().find(t=>t.candidate_id===id);if(t.revision!==revision)throw Error('Stale revision');
     const c=s.candidates.find(c=>c.id===id);
     if(decision==='approve'){
      const old=c.managerScore;c.managerScore=t.result.manager_score;c.jdScore=t.result.jd_score;c.rec='Strong Consideration';
      c.aiReview={source:'hybrid_reevaluation',verdict:'Needs Adjustment',correctedScore:c.managerScore,correctedJDScore:c.jdScore,contextSignature:window.AncalagonContext.signature(window.AncalagonContext.build(s.jobs.find(j=>j.id===c.jobId),c,s.feedback,s.interviewOutcomes)),history:[{previousScore:old,newScore:c.managerScore,reasons:[t.result.manager_reason],appliedAt:Date.now()}]};
      t.status='approved';
     }else t.status=decision==='ignore'?'ignored':'queued';
     window.testSaved=clone(s);window.fixture=clone(s);return {status:t.status};
    }
   })};
   window.ancalagonAuth={session:{user:{id:'test'},access_token:'test-token'},workspace:{id:'test'}};
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  await page.locator('#page-job-picker.active').waitFor();
  await page.locator('.rf-nav [data-page="candidates"]').click();
  await page.locator('[data-candidate-id="candidate-a"]').first().click();
  await page.locator('#workspaceNote').fill('Unsaved note stays here');
  await page.locator('#submissionDraft').fill('Unsaved recruiter draft stays here');
  await page.locator('.rf-nav [data-page="job-review"]').click();
  await page.locator('#jobAssessmentUpdates [data-review-candidate="candidate-a"][data-job-review="approve"]').waitFor();
  assert.match(await page.locator('#jobReviewSummary').textContent(),/1 ready to review/);
  assert.doesNotMatch(await page.locator('#jobAssessmentUpdates').textContent(),/PRIVATE OTHER JOB/);
  assert.match(await page.locator('#jobAssessmentUpdates').textContent(),/You can close Ancalagon/);
  assert.equal(await page.evaluate(()=>window.testSaved.candidates[0].managerScore),7,'proposals must not apply themselves');
  await page.locator('#jobAssessmentUpdates [data-job-review="approve"]').click();
  await page.waitForFunction(()=>window.testSaved.candidates[0].managerScore===9);
  assert.equal(await page.inputValue('#workspaceNote'),'Unsaved note stays here');
  assert.equal(await page.inputValue('#submissionDraft'),'Unsaved recruiter draft stays here');
  assert.equal(await page.evaluate(()=>window.testSaved.candidates[2].managerScore),7);
  assert.equal(await page.evaluate(()=>window.testSaved.candidates[0].jdScore),8);
  // Simulate the worker completing another candidate independently of browser AI.
  await page.evaluate(()=>{const rows=window.reviewRows['job-a'];rows[1].status='ready';rows[1].result=rows[0].result;});
  await page.locator('.rf-nav [data-page="job-review"]').click();
  await page.locator('#jobAssessmentUpdates [data-review-candidate="candidate-b"][data-job-review="approve"]').waitFor();
  await page.evaluate(()=>{window.failNextReview=true;});
  await page.locator('#jobAssessmentUpdates [data-review-candidate="candidate-b"][data-job-review="approve"]').click();
  await page.waitForFunction(()=>document.body.textContent.includes('Evidence changed. Review the latest assessment.'));
  assert.equal(await page.evaluate(()=>window.testSaved.candidates[1].managerScore),7);
  await page.locator('#jobAssessmentUpdates [data-review-candidate="candidate-b"][data-job-review="ignore"]').click();
  await page.waitForFunction(()=>window.reviewRows['job-a'][1].status==='ignored');
  await page.locator('.rf-nav [data-page="candidates"]').click();
  await page.locator('[data-candidate-id="candidate-a"]').first().click();
  await page.locator('#workspaceNoteForm button').click();
  await page.waitForFunction(()=>window.requests.includes('candidate-a'));
  assert.equal(screeningCalls,0,'backend queue replaces browser reassessment requests');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  assert.deepEqual(errors,[]);
  console.log('Job review journey passed: scoped proposals, approve/keep, stale rejection, preserved drafts, durable delegation.');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

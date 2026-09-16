const {chromium}=require('playwright'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const name=req.url.split('?')[0],file=path.join(root,name==='/'?'index.html':name);try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}}).listen(0,'127.0.0.1');
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route('https://**',r=>r.abort());
  await page.route('**/assets/auth.js*',r=>r.fulfill({contentType:'application/javascript',body:"document.body.classList.remove('rf-auth-pending');document.getElementById('authGate').style.display='none';"}));
  await page.route('**/assets/data.js*',r=>r.fulfill({contentType:'application/javascript',body:''}));
  await page.route('**/functions/v1/**',r=>r.fulfill({json:{summary:'Manual regression ownership recorded.',clarification_question:null}}));
  await page.addInitScript(()=>{
   const clone=x=>JSON.parse(JSON.stringify(x));
   const job=(id,title)=>({id,title,description:'Manual regression testing',criteria:[],weights:[],knockouts:[],status:'active',createdAt:1,updatedAt:1});
   const fixture={jobs:[job('qa','QA Analyst'),job('security','Security Engineer')],candidates:[],feedback:[],interviewOutcomes:[]};
   window.testGuidance={enabled:true,tips:{}};window.guidanceFail=false;window.feedbackReviewFail=false;window.testState=fixture;window.testDocs={};window.testTasks={};window.failedUpload=false;window.batchReads=0;
   const api={loadGuidance:async()=>clone(window.testGuidance),saveGuidance:async(action,tip)=>{if(window.guidanceFail)throw Error('Offline');const state=window.testGuidance;if(action==='reset')window.testGuidance={enabled:true,tips:{}};else if(action==='enable'||action==='disable')state.enabled=action==='enable';else if(action==='dismiss'||!state.tips[tip])state.tips[tip]=action==='dismiss'?'dismissed':'completed';return clone(window.testGuidance);},load:async()=>clone(fixture),loadHome:async()=>null,visitHome:async()=>{},saveHome:async()=>{},loadHomeReviews:async()=>[],
    schedule:(s,e,status)=>{window.testState=clone(s);status('saved');},flush:async s=>{if(window.feedbackReviewFail&&s.feedback.some(f=>f.interpretation?.reviewStatus))throw Error('Offline');window.testState=clone(s);},trackEvent:async()=>{},loadAdminAnalytics:async()=>{throw Error('not admin')},loadJobReassessments:async()=>[],
    uploadResume:async(c,file,text)=>{if(file.name==='Retry.txt'&&!window.failedUpload){window.failedUpload=true;throw Error('Connection interrupted. Retry this file.');}window.testDocs[c.id]=text;},loadResumeText:async c=>window.testDocs[c.id]||'',
    requestResumeIntake:async id=>{
     if(window.testTasks[id])return;
     const c=window.testState.candidates.find(c=>c.id===id),job=window.testState.jobs.find(j=>j.id===c.jobId),text=window.testDocs[id];
     const neutral={...c,role:'',signal:'',tags:[],strengths:[],concerns:[],resumeJDScore:0,resumeIntake:null};
     const signature=window.AncalagonContext.signature(window.AncalagonContext.build(job,neutral,[],[]));
     window.testTasks[id]={candidate_id:id,job_id:c.jobId,status:'ready',revision:'r1',result:{name:text.split('\n')[0],role:'QA Analyst',score:8,manager_score:8.5,primary_signal:'Manual testing',jd_reason:'Testing demonstrated',manager_reason:'Ownership demonstrated',concerns:[],tags:['QA'],screening_questions:['What tests did you own?'],resume_evidence:[{claim:'Manual regression',quote:'Owned manual regression testing for billing systems'}],context_signature:signature}};
    },loadResumeIntake:async id=>window.testTasks[id]||null,
    loadResumeIntakes:async ids=>{window.batchReads++;return ids.map(id=>window.testTasks[id]).filter(Boolean).map(({result,...task})=>task)},
    reviewResumeIntake:async(id,revision,state)=>{
     const c=state.candidates.find(c=>c.id===id),t=window.testTasks[id];if(t.revision!==revision)throw Error('Wrong revision');
     c.resumeIntake.reviewedAt=Date.now();c.managerScore=t.result.manager_score;c.originalManagerScore=c.managerScore;c.jdScore=t.result.score;c.resumeJDScore=c.jdScore;c.rec='Strong Consideration';
     c.aiReview={source:'resume_intake',verdict:'Needs Adjustment',correctedScore:c.managerScore,correctedJDScore:c.jdScore,notes:t.result.manager_reason,createdAt:Date.now()};t.status='approved';window.testState=clone(state);
    }};
   window.AncalagonData={create:()=>api};window.ancalagonAuth={session:{user:{id:'tester'},access_token:'test'},workspace:{id:'workspace'}};
  });
  await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#page-home.active').waitFor();await page.locator('.rf-nav [data-page="candidates"]').click();
  const resume=(name,filename=name+'.txt')=>({name:filename,mimeType:'text/plain',buffer:Buffer.from(name+'\nQA Analyst\nOwned manual regression testing for billing systems and documented defects.')});
  await page.locator('#resumeUpload').setInputFiles([resume('Alex Example'),resume('Sam Example','Retry.txt'),resume('Alex Example','Duplicate.txt'),resume('Taylor Example')]);
  await page.waitForFunction(()=>window.testState.candidates.length===3&&Object.keys(window.testDocs).length===2);
  assert.equal(await page.locator('#page-candidates').evaluate(e=>e.classList.contains('active')),true,'bulk upload preserves current page');
  await page.locator('#resumeBatch [data-batch-retry]').waitFor();assert.match(await page.locator('#resumeBatch').textContent(),/Already attached/);
  if(process.env.CAPTURE_UI)await page.screenshot({path:process.env.CAPTURE_UI+'-retry.png',fullPage:true});
  await page.locator('#resumeBatch [data-batch-retry]').click();
  await page.waitForFunction(()=>window.testState.candidates.every(c=>c.resumeIntake.phase==='ready'));
  assert.equal(await page.evaluate(()=>Object.keys(window.testDocs).length),3);assert.equal(await page.locator('#resumeBatch [data-batch-retry]').count(),0);
  assert.match(await page.locator('#resumeIntakeStatus').textContent(),/3 ready to review/);
  if(process.env.CAPTURE_UI)await page.screenshot({path:process.env.CAPTURE_UI+'-ready.png',fullPage:true});
  await page.locator('[data-queue-open]').click();
  await page.locator('#candidateGuidance [data-guidance-open="approval"]').waitFor();
  await page.evaluate(()=>window.guidanceFail=true);
  await page.locator('#candidateGuidance [data-guidance-dismiss]').click();
  await page.locator('#candidateGuidance .rf-guidance-status').filter({hasText:'did not save'}).waitFor();
  assert.equal(await page.locator('#candidateGuidance [data-guidance-open]').getAttribute('aria-expanded'),'true');
  await page.evaluate(()=>window.guidanceFail=false);await page.locator('#candidateGuidance [data-guidance-retry]').click();
  await page.waitForFunction(()=>window.testGuidance.tips.approval==='dismissed');
  assert.equal(await page.locator('#candidateGuidance [data-guidance-open]').getAttribute('aria-expanded'),'false');
  await page.locator('#candidateGuidance [data-guidance-open]').click();
  assert.equal(await page.locator('#candidateGuidance [data-guidance-open]').getAttribute('aria-expanded'),'true');
  await page.locator('#candidateGuidance [data-guidance-dismiss]').click();
  assert.match(await page.locator('#workspaceIntake').textContent(),/What happens when I approve/);
  const names=[];
  for(let n=0;n<3;n++){
   await page.locator('#workspaceIntake [data-intake-next]').waitFor();names.push(await page.locator('#detailName').textContent());
   await page.locator('#workspaceIntake [data-intake-next]').click();
   await page.waitForFunction(n=>window.testState.candidates.filter(c=>c.aiReview).length===n,n+1);
  }
  await page.locator('#page-candidates.active').waitFor();assert.equal(new Set(names).size,3);
  // Open manager feedback directly after uploading; no reload or job switch may
  // be needed to populate the visible custom dropdown.
  await page.locator('#feedbackNav > summary').click();
  await page.locator('.rf-nav [data-page="feedback"]').click();
  const candidateSelect=page.locator('#feedbackCandidate'),candidateMenu=candidateSelect.locator('..');
  await candidateMenu.locator('.rf-select-button').click();
  assert.deepEqual(await candidateMenu.locator('.rf-select-option').allTextContents(),['Alex Example','Sam Example','Taylor Example']);
  await candidateMenu.locator('.rf-select-menu').getByRole('option',{name:'Taylor Example',exact:true}).click();
  const selectedCandidate=await candidateSelect.inputValue();
  await page.locator('#feedbackText').fill('Personally owned the regression test plan.');
  // A resume can finish saving and processing while the recruiter is writing.
  // Its new name must appear without changing the chosen candidate or note.
  await page.locator('#resumeUpload').setInputFiles(resume('Jordan Example','New resume.txt'));
  await page.waitForFunction(()=>window.testState.candidates.length===4&&window.testState.candidates.every(c=>c.resumeIntake.phase==='ready'));
  await page.waitForFunction(()=>[...document.querySelector('#feedbackCandidate').options].some(o=>o.textContent==='Jordan Example'));
  assert.equal(await page.locator('#page-feedback.active').count(),1);
  assert.equal(await candidateSelect.inputValue(),selectedCandidate);
  assert.equal(await candidateMenu.locator('.rf-select-button').textContent(),'Taylor Example');
  assert.equal(await page.locator('#feedbackText').inputValue(),'Personally owned the regression test plan.');
  await page.locator('#feedbackSubmitBtn').click();
  await page.waitForFunction(()=>window.testState.feedback[0]?.interpretation);
  const savedNote=await page.evaluate(()=>window.testState.feedback[0]);
  assert.equal(savedNote.candidateId,selectedCandidate);assert.equal(savedNote.candidate,'Taylor Example');assert.equal(savedNote.jobId,'qa');
  assert.equal(savedNote.text,'Personally owned the regression test plan.');
  assert.equal(await candidateSelect.inputValue(),selectedCandidate,'background interpretation preserves selection');
  const beforeReviewScores=await page.evaluate(()=>window.testState.candidates.map(c=>({id:c.id,jd:c.jdScore,manager:c.managerScore,stage:c.stage})));
  await page.evaluate(()=>window.feedbackReviewFail=true);
  await page.locator('#feedbackList [data-accept-interpretation]').click();
  await page.locator('#feedbackList .rf-review-status').filter({hasText:'did not save'}).waitFor();
  assert.equal(await page.evaluate(()=>window.testState.feedback[0].interpretation.reviewStatus),undefined);
  assert.equal(await page.locator('#feedbackList [data-accept-interpretation]').isDisabled(),false);
  await page.evaluate(()=>window.feedbackReviewFail=false);
  await page.locator('#feedbackList [data-accept-interpretation]').click();
  await page.waitForFunction(()=>window.testState.feedback[0].interpretation.reviewStatus==='accepted');
  assert.equal(await page.locator('#feedbackList [data-accept-interpretation]').isDisabled(),true);
  assert.deepEqual(await page.evaluate(()=>window.testState.candidates.map(c=>({id:c.id,jd:c.jdScore,manager:c.managerScore,stage:c.stage}))),beforeReviewScores);
  assert.equal(await page.evaluate(()=>window.testState.feedback[0].text),'Personally owned the regression test plan.');
  assert.equal(await page.evaluate(()=>window.testGuidance.tips.feedback),'completed');
  await page.locator('#feedbackList summary').filter({hasText:'Correct interpretation'}).click();
  await page.locator('#feedbackList textarea').fill('Owned test planning. Automation ownership still needs verification.');
  await page.locator('#feedbackList [data-correct-interpretation]').click();
  await page.waitForFunction(()=>window.testState.feedback[0].interpretation.source==='recruiter');
  assert.equal(await page.evaluate(()=>window.testState.feedback[0].text),'Personally owned the regression test plan.');
  assert.match(await page.evaluate(()=>window.testState.feedback[0].interpretation.text),/Automation ownership still needs verification/);
  assert.deepEqual(await page.evaluate(()=>window.testState.candidates.map(c=>({id:c.id,jd:c.jdScore,manager:c.managerScore,stage:c.stage}))),beforeReviewScores);
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:1000});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'guidance and interpretation controls fit '+width+'px');
  }
  await page.setViewportSize({width:1440,height:1000});
  if(process.env.CAPTURE_UI)await page.screenshot({path:process.env.CAPTURE_UI+'-guidance.png',fullPage:true});
  const jobMenu=page.locator('#globalJobSelect').locator('..');
  await jobMenu.locator('.rf-select-button').click();await jobMenu.locator('.rf-select-menu').getByRole('option',{name:'Security Engineer',exact:true}).click();
  assert.equal(await candidateMenu.locator('.rf-select-button').isDisabled(),true);
  assert.match(await candidateMenu.locator('.rf-select-button').textContent(),/No candidates in this job/);
  assert.equal(await page.locator('#feedbackSubmitBtn').isDisabled(),true);
  assert.equal(await page.locator('#feedbackList .rf-feeditem').count(),0,'another job cannot show QA feedback');
  await jobMenu.locator('.rf-select-button').click();await jobMenu.locator('.rf-select-menu').getByRole('option',{name:'QA Analyst',exact:true}).click();
  assert.equal(await page.locator('#feedbackSubmitBtn').isDisabled(),false);
  await candidateMenu.locator('.rf-select-button').click();
  await candidateMenu.locator('.rf-select-button').press('Home');await candidateMenu.locator('.rf-select-button').press('ArrowDown');await candidateMenu.locator('.rf-select-button').press('Enter');
  assert.equal(await candidateMenu.locator('.rf-select-button').textContent(),'Sam Example','keyboard selection works after switching jobs');
  const samId=await candidateSelect.inputValue();
  await page.locator('#feedbackText').fill('Explained defect triage clearly.');await page.locator('#feedbackSubmitBtn').click();
  await page.waitForFunction(()=>window.testState.feedback.length===2&&window.testState.feedback.every(f=>f.interpretation));
  assert.equal(await page.evaluate(()=>window.testState.feedback[1].candidateId),samId);
  assert.equal(await page.evaluate(()=>window.testState.feedback[1].jobId),'qa');
  await page.locator('.rf-nav [data-page="jobs"]').click();
  await page.locator('[data-close-job="qa"]').evaluate(e=>e.closest('details').open=true);await page.locator('[data-close-job="qa"]').click();
  await page.locator('#closeJobForm button[type=submit]').click();
  assert.equal(await page.locator('[data-activate-job="qa"]').count(),0,'closed search leaves active list');
  await page.locator('[data-job-filter="closed"]').click();assert.equal(await page.locator('[data-activate-job="qa"]').count(),1);
  await page.locator('#jobSearch').fill('security');assert.equal(await page.locator('[data-activate-job]').count(),0);await page.locator('#jobSearch').fill('QA');
  await page.locator('[data-reopen-job="qa"]').evaluate(e=>e.closest('details').open=true);await page.locator('[data-reopen-job="qa"]').click();
  await page.locator('[data-job-filter="active"]').click();await page.locator('#jobSearch').fill('');
  assert.equal(await page.locator('[data-activate-job]').count(),2);assert.equal(await page.evaluate(()=>window.testState.candidates.length),4);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  if(process.env.CAPTURE_UI)await page.screenshot({path:process.env.CAPTURE_UI+'-jobs-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS: bulk intake, duplicate protection, failed-file retry, three approvals, manager feedback candidate selection after upload, background updates, correct saved candidate, empty jobs, keyboard selection, job isolation, close/reopen preservation, mobile layout.');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

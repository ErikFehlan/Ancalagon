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
   window.reviewRows={'job-a':[{job_id:'job-a',candidate_id:'candidate-a',revision:'a1',status:'ready',reason:'Job requirements changed',result},{job_id:'job-a',candidate_id:'candidate-b',revision:'b1',status:'ready',reason:'Job requirements changed',result}],'job-b':[{job_id:'job-b',candidate_id:'candidate-other',revision:'other',status:'ready',reason:'Other job',result}]};
   window.requests=[];window.reviewLoads=0;window.testSaved=clone(window.fixture);
   window.AncalagonData={create:()=>({
    load:async()=>clone(window.fixture),schedule:(s,e,status)=>{window.testSaved=clone(s);status('saved');},flush:async s=>{if(window.failFlush){window.failFlush=false;throw Error('Save unavailable');}if(window.holdFlush)await new Promise(r=>window.releaseFlush=r);window.testSaved=clone(s);},
    trackEvent:async()=>{},loadAdminAnalytics:async()=>{throw Error('not admin');},
    loadJobReassessments:async id=>{window.reviewLoads++;if(window.delayReviewLoad)await new Promise(r=>setTimeout(r,400));return clone(window.reviewRows[id]||[]);},
    requestCandidateReassessment:async id=>{window.requests.push(id);const t=Object.values(window.reviewRows).flat().find(t=>t.candidate_id===id);if(t){t.status='processing';t.revision+='new';}},
    reviewJobReassessment:async(id,revision,decision,s)=>{
     if(window.holdReview)await new Promise(r=>window.releaseReview=r);
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
  await page.locator('#page-home.active').waitFor();
  await page.locator('.rf-nav [data-page="candidates"]').click();
  await page.locator('[data-candidate-id="candidate-a"]').first().click();
  await page.locator('#workspaceEvaluation [data-job-review="approve-next"]').waitFor();
  assert.equal(await page.locator('#workspaceSubmission').evaluate(e=>e.open),false);
  assert.equal(await page.locator('.rf-feedback-history').evaluate(e=>e.open),false);
  assert.equal(await page.locator('.rf-workspace-overview').isVisible(),false,'show one assessment, not duplicate overview');
  assert.equal(await page.locator('#workspaceNote').isVisible(),true);
  await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.waitForTimeout(350);
  if(process.env.CAPTURE_UI)await page.screenshot({path:process.env.CAPTURE_UI+'-desktop.png',fullPage:true});
  await page.evaluate(()=>window.failNextReview=true);
  await page.locator('#workspaceEvaluation [data-job-review="approve-next"]').click();
  await page.waitForFunction(()=>document.body.textContent.includes('Evidence changed. Review the latest assessment.'));
  assert.equal(await page.locator('#detailName').textContent(),'Alice','failed approval must not navigate');
  assert.equal(await page.evaluate(()=>window.testSaved.candidates[0].managerScore),7);
  await page.locator('#workspaceEvaluation [data-job-review="approve-next"]').click();
  await page.waitForFunction(()=>document.querySelector('#detailName').textContent==='Bob');
  assert.equal(await page.evaluate(()=>window.testSaved.candidates[0].managerScore),9);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'detailName');
  // Pauses and continuing edits update one saved note. No Save button is needed.
  await page.locator('#workspaceNote').fill('Owned regression testing.');
  await page.locator('#workspaceEvaluation [data-job-review="approve-next"]').evaluate(b=>b.click());
  await page.waitForFunction(()=>window.testSaved.feedback[0]?.text==='Owned regression testing.'&&document.querySelector('#workspaceNoteStatus').textContent.startsWith('Saved'));
  assert.equal(await page.locator('#detailName').textContent(),'Bob','new feedback prevents approving the old assessment');
  assert.equal(await page.evaluate(()=>window.testSaved.candidates[1].managerScore),7);
  const noteId=await page.evaluate(()=>window.testSaved.feedback[0].id);
  await page.locator('#workspaceNote').fill('Owned regression testing. Confirm automation scope.');
  await page.waitForFunction(()=>window.testSaved.feedback[0]?.text.includes('Confirm automation scope.'));
  assert.equal(await page.evaluate(()=>window.testSaved.feedback.length),1);
  assert.equal(await page.evaluate(()=>window.testSaved.feedback[0].id),noteId);
  assert.equal(await page.evaluate(()=>window.testSaved.feedback[0].candidateId),'candidate-b');
  assert.equal(await page.locator('#workspaceNote').inputValue(),'Owned regression testing. Confirm automation scope.');
  await page.waitForFunction(()=>!window.AncalagonWorkspace.hasPendingNotes());
  assert.equal(await page.evaluate(()=>window.AncalagonWorkspace.hasDrafts()),false,'saved note must not trigger an unload warning');
  // A save failure keeps the text and prevents approval from advancing.
  await page.evaluate(()=>window.failFlush=true);
  await page.locator('#workspaceNote').fill('Owned regression testing. Confirm automation scope and tools.');
  await page.locator('#retryQuickNote').waitFor();
  assert.match(await page.locator('#workspaceNoteStatus').textContent(),/Not saved/);
  assert.equal(await page.evaluate(()=>window.AncalagonWorkspace.hasDrafts()),true);
  assert.equal(await page.evaluate(()=>window.testSaved.feedback[0].text),'Owned regression testing. Confirm automation scope.','failed edits keep the last saved version');
  await page.locator('#retryQuickNote').click();
  await page.waitForFunction(()=>document.querySelector('#workspaceNoteStatus').textContent.startsWith('Saved'));
  await page.waitForFunction(()=>window.testSaved.feedback[0]?.interpretation);
  assert.equal(await page.evaluate(()=>window.testSaved.feedback.length),1);
  // If the recruiter changes jobs during approval, completion must not navigate back.
  await page.evaluate(()=>{window.reviewRows['job-a'][1].status='ready';window.holdReview=true;});
  await page.locator('#workspaceEvaluation [data-job-review="approve-next"]').waitFor();
  await page.locator('#workspaceEvaluation [data-job-review="approve-next"]').click();
  await page.waitForFunction(()=>!!window.releaseReview);
  await page.evaluate(()=>{const select=document.querySelector('#globalJobSelect');select.value='job-b';select.dispatchEvent(new Event('change',{bubbles:true}));window.holdReview=false;window.releaseReview();});
  await page.waitForFunction(()=>window.reviewRows['job-a'][1].status==='approved');
  assert.equal(await page.locator('#page-candidates.active').count(),1);
  assert.equal(await page.locator('#globalJobSelect').inputValue(),'job-b');
  assert.equal(await page.evaluate(()=>window.testSaved.feedback[0].jobId),'job-a');
  await page.locator('[data-candidate-id="candidate-other"]').first().click();
  await page.locator('#workspaceEvaluation [data-job-review="approve-next"]').waitFor();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  assert.equal(await page.locator('#workspaceNote').isVisible(),true);
  await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await page.waitForTimeout(350);
  if(process.env.CAPTURE_UI)await page.screenshot({path:process.env.CAPTURE_UI+'-mobile.png',fullPage:true});
  await page.locator('#workspaceEvaluation [data-job-review="approve-next"]').click();
  await page.locator('#page-candidates.active').waitFor();
  assert.equal(await page.locator('#globalJobSelect').inputValue(),'job-b','last review stays on this job');
  assert.deepEqual(errors,[]);
  console.log('Streamlined review passed: compact layout, autosave, stable note identity, save recovery, guarded approval, next candidate, job isolation, mobile, and completion.');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

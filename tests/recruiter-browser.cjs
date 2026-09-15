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
  await page.addInitScript(()=>{
   const clone=x=>JSON.parse(JSON.stringify(x));
   const job=(id,title)=>({id,title,description:'Manual regression testing',criteria:[],weights:[],knockouts:[],status:'active',createdAt:1,updatedAt:1});
   const fixture={jobs:[job('qa','QA Analyst'),job('security','Security Engineer')],candidates:[],feedback:[],interviewOutcomes:[]};
   window.testState=fixture;window.testDocs={};window.testTasks={};window.failedUpload=false;window.batchReads=0;
   const api={load:async()=>clone(fixture),loadHome:async()=>null,visitHome:async()=>{},saveHome:async()=>{},loadHomeReviews:async()=>[],
    schedule:(s,e,status)=>{window.testState=clone(s);status('saved');},flush:async s=>{window.testState=clone(s);},trackEvent:async()=>{},loadAdminAnalytics:async()=>{throw Error('not admin')},loadJobReassessments:async()=>[],
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
  const names=[];
  for(let n=0;n<3;n++){
   await page.locator('#workspaceIntake [data-intake-next]').waitFor();names.push(await page.locator('#detailName').textContent());
   await page.locator('#workspaceIntake [data-intake-next]').click();
   await page.waitForFunction(n=>window.testState.candidates.filter(c=>c.aiReview).length===n,n+1);
  }
  await page.locator('#page-candidates.active').waitFor();assert.equal(new Set(names).size,3);
  await page.locator('.rf-nav [data-page="jobs"]').click();
  await page.locator('[data-close-job="qa"]').evaluate(e=>e.closest('details').open=true);await page.locator('[data-close-job="qa"]').click();
  await page.locator('#closeJobForm button[type=submit]').click();
  assert.equal(await page.locator('[data-activate-job="qa"]').count(),0,'closed search leaves active list');
  await page.locator('[data-job-filter="closed"]').click();assert.equal(await page.locator('[data-activate-job="qa"]').count(),1);
  await page.locator('#jobSearch').fill('security');assert.equal(await page.locator('[data-activate-job]').count(),0);await page.locator('#jobSearch').fill('QA');
  await page.locator('[data-reopen-job="qa"]').evaluate(e=>e.closest('details').open=true);await page.locator('[data-reopen-job="qa"]').click();
  await page.locator('[data-job-filter="active"]').click();await page.locator('#jobSearch').fill('');
  assert.equal(await page.locator('[data-activate-job]').count(),2);assert.equal(await page.evaluate(()=>window.testState.candidates.length),3);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  if(process.env.CAPTURE_UI)await page.screenshot({path:process.env.CAPTURE_UI+'-jobs-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS: bulk intake, duplicate protection, failed-file retry, three approvals in sequence, job filters, close/reopen preservation, mobile layout.');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

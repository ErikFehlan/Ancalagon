const {chromium}=require('playwright'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const name=req.url.split('?')[0];const file=path.join(root,name==='/'?'index.html':name);try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}}).listen(0,'127.0.0.1');
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME});const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route('https://**',r=>r.abort());
  await page.route('**/assets/auth.js*',r=>r.fulfill({contentType:'application/javascript',body:"document.body.classList.remove('rf-auth-pending');document.getElementById('authGate').style.display='none';"}));
  await page.route('**/assets/data.js*',r=>r.fulfill({contentType:'application/javascript',body:''}));
  await page.addInitScript(()=>{
   const clone=x=>JSON.parse(JSON.stringify(x));
   const fixture={jobs:[{id:'job',title:'Core QA',description:'Manual regression testing',criteria:[],weights:[],knockouts:[],status:'active',createdAt:1,updatedAt:1}],candidates:[],feedback:[],interviewOutcomes:[]};
   window.coreState=fixture;window.coreDocs={};window.coreTasks={};window.coreRequests=0;
   window.AncalagonData={create:()=>({load:async()=>clone(window.coreRestore||fixture),loadHome:async()=>null,visitHome:async()=>{},saveHome:async()=>{},loadHomeReviews:async()=>[],
    schedule:(s,e,status)=>{window.coreState=clone(s);status('saved');},flush:async s=>{window.coreState=clone(s);},trackEvent:async()=>{},loadAdminAnalytics:async()=>{throw Error('not admin')},loadJobReassessments:async()=>[],
    uploadResume:async(c,file,text)=>{window.coreDocs[c.id]=text;},loadResumeText:async c=>window.coreDocs[c.id]||window.coreRestoredDocs?.[c.id]||'',
    requestResumeIntake:async id=>{window.coreRequests++;window.coreTasks[id]||={candidate_id:id,job_id:'job',revision:'r1',status:'processing'};},
    loadResumeIntake:async id=>window.coreTasks[id]||window.coreRestoredTasks?.[id]||null,
    reviewResumeIntake:async(id,revision,state)=>{
      if(window.coreFailApproval)throw Error('Simulated stale revision');
      const task=window.coreTasks[id]||window.coreRestoredTasks[id],c=state.candidates.find(c=>c.id===id);assertBrowser(task.revision===revision);
      c.resumeIntake.reviewedAt=Date.now();c.managerScore=task.result.manager_score;c.originalManagerScore=c.managerScore;c.jdScore=task.result.score;c.resumeJDScore=c.jdScore;c.rec='Strong Consideration';
      c.aiReview={source:'resume_intake',verdict:'Needs Adjustment',correctedScore:c.managerScore,correctedJDScore:c.jdScore,notes:task.result.manager_reason,createdAt:Date.now()};task.status='approved';window.coreState=clone(state);
    }
   })};
   function assertBrowser(v){if(!v)throw Error('Wrong revision');}
   window.ancalagonAuth={session:{user:{id:'test'},access_token:'test'},workspace:{id:'workspace'}};
  });
  await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#page-home.active').waitFor();await page.locator('.rf-nav [data-page="candidates"]').click();
  const text='Alex Carter\nQA Analyst\nOwned manual regression testing for billing systems and documented defects.';
  await page.locator('#resumeUpload').setInputFiles({name:'Synthetic.txt',mimeType:'text/plain',buffer:Buffer.from(text)});
  await page.locator('#page-detail.active').waitFor();await page.waitForFunction(()=>window.coreRequests>0);
  assert.equal(await page.locator('#detailManagerScore').textContent(),'—');
  // Simulate completion while the original browser is absent, then restore only
  // cloud records into a fresh page. No localStorage backup participates.
  const restore=await page.evaluate(()=>{
   const c=window.coreState.candidates[0],job=window.coreState.jobs[0];const neutral={...c,role:'',signal:'',tags:[],strengths:[],concerns:[],resumeJDScore:0,resumeIntake:null};
   const signature=window.AncalagonContext.signature(window.AncalagonContext.build(job,neutral,[],[]));
   window.coreTasks[c.id]={candidate_id:c.id,job_id:job.id,revision:'r1',status:'ready',result:{name:'Alex Carter',role:'QA Analyst',score:8,manager_score:8.5,primary_signal:'Manual testing',jd_reason:'Manual testing demonstrated',manager_reason:'Ownership demonstrated',concerns:[],tags:['QA'],screening_questions:['What tests did you own?'],resume_evidence:[{claim:'Manual regression',quote:'Owned manual regression testing for billing systems'}],context_signature:signature}};
   return {state:window.coreState,docs:window.coreDocs,tasks:window.coreTasks};
  });
  await page.addInitScript(x=>{window.coreRestore=x.state;window.coreRestoredDocs=x.docs;window.coreRestoredTasks=x.tasks;},restore);
  await page.reload();await page.locator('#page-home.active').waitFor();await page.locator('.rf-nav [data-page="candidates"]').click();await page.locator('[data-candidate-id]').first().click();
  // The request is idempotent: use the saved cloud task rather than a new one.
  await page.evaluate(()=>{window.coreTasks=window.coreRestoredTasks;});
  await page.waitForFunction(()=>window.coreState.candidates[0]?.resumeIntake.phase==='ready');
  assert.match(await page.locator('#workspaceIntake').textContent(),/Awaiting your review/);assert.equal(await page.evaluate(()=>window.coreState.candidates[0].managerScore),0);
  await page.evaluate(()=>window.coreFailApproval=true);await page.locator('#workspaceIntake [data-intake-approve]').click();
  await page.waitForFunction(()=>document.body.textContent.includes('Simulated stale revision'));assert.equal(await page.evaluate(()=>window.coreState.candidates[0].managerScore),0);
  await page.evaluate(()=>window.coreFailApproval=false);await page.locator('#workspaceIntake [data-intake-approve]').click();
  await page.waitForFunction(()=>window.coreState.candidates[0].managerScore===8.5);assert.equal(await page.locator('#workspaceIntake').isVisible(),false);assert.deepEqual(errors,[]);
  console.log('PASS: durable intake adapter, saved-source restore, provisional scores, stale approval recovery and server approval.');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

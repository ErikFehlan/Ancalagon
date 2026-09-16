const {chromium}=require('playwright'),fs=require('fs'),http=require('http'),path=require('path'),assert=require('node:assert/strict');
const dir=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(dir,req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');try{res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}}).listen(0,'127.0.0.1');
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**',r=>r.abort());
  await page.route('**/mammoth@1.8.0/mammoth.browser.min.js',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(path.dirname(require.resolve('mammoth/package.json')),'mammoth.browser.min.js'),'utf8')}));
  await page.route('**/assets/auth.js*',r=>r.fulfill({contentType:'application/javascript',body:"document.body.classList.remove('rf-auth-pending');document.getElementById('authGate').style.display='none';"}));
  await page.route('**/assets/data.js*',r=>r.fulfill({contentType:'application/javascript',body:''}));
  await page.addInitScript(()=>{
   const clone=x=>JSON.parse(JSON.stringify(x)),job=(id,title)=>({id,title,description:'Manual regression testing',criteria:['Must Have | manual testing'],knockouts:[],weights:[],status:'active',createdAt:1,updatedAt:1});
   const fixture={jobs:[job('job-a','QA Analyst'),job('job-b','Other job')],candidates:[],feedback:[{id:'preference',jobId:'job-a',candidateId:'old',candidate:'Old candidate',type:'General note',text:'Prefer ownership of manual testing',learningScope:'job',signalStatus:'approved',signalDirection:'positive',signalLabel:'Manual testing ownership',createdAt:1,updatedAt:1}],interviewOutcomes:[]};
   window.resumeDocs={};window.testSaved=clone(fixture);
   window.AncalagonData={create:()=>({
    load:async()=>clone(window.reloadFixture||fixture),schedule:(s,e,status)=>{window.testSaved=clone(s);status('saved');},flush:async s=>{window.testSaved=clone(s);},
    trackEvent:async()=>{},loadAdminAnalytics:async()=>{throw Error('not admin');},
    uploadResume:async(c,file,text)=>{if(window.failUpload){window.failUpload=false;throw Error('Simulated storage failure');}window.resumeDocs[c.id]=text;return 'private-resume';},
    loadResumeText:async c=>window.resumeDocs[c.id]||(window.restoreDocs||{})[c.id]||''
   })};
   window.ancalagonAuth={session:{user:{id:'test'},access_token:'test-token'},workspace:{id:'workspace'}};
  });
  const resume='Alex Carter\nQA Analyst\nOwned manual regression testing for billing systems and documented defects.';
  const result={name:'Alex Carter',role:'QA Analyst',score:8,manager_score:8.7,primary_signal:'Manual regression ownership is relevant to this search.',jd_reason:'Resume supports required manual testing.',manager_reason:'Hands-on ownership matches the approved preference.',strengths:['Manual regression ownership'],concerns:['Confirm automation scope.'],tags:['QA'],screening_questions:['What testing did you personally own?','How did you prioritize regression coverage?','Which defects did your testing uncover?'],resume_evidence:[{claim:'Manual regression ownership',quote:'Owned manual regression testing for billing systems'}]};
  let calls=0,release,wordCalls=0;let hold=true;
  await page.route('**/functions/v1/**',async route=>{
   const payload=route.request().postDataJSON();
   if(payload.analysis_type==='resume'&&payload.resume_text.includes('Jamie Rivera')){
    wordCalls++;
    assert.ok(payload.resume_text.includes('business\u2011aligned'),'Word nonbreaking hyphen lost');
    assert.ok(payload.resume_text.includes('Documented regression coverage'),'Word text box omitted');
    assert.ok(payload.resume_text.includes('Manual regression testing'),'Word table omitted');
    if(wordCalls===1){await route.fulfill({status:502,json:{error:'The AI could not produce a verified assessment after an automatic retry. Your saved resume is available; try the assessment again.',code:'resume_validation_failed'}});return;}
    await route.fulfill({json:{...result,name:'Jamie Rivera',primary_signal:'Documented testing controls.',resume_evidence:[{claim:'Documented testing controls',quote:'Owned risk documentation and business-aligned testing controls.'}]}});return;
   }
   if(payload.analysis_type==='resume'){
    calls++;assert.equal(payload.auto_intake,true);assert.equal(payload.job.title,'QA Analyst');assert.ok(payload.evaluation_context.sources.some(s=>s.id==='preference-preference'));
    if(hold){hold=false;await new Promise(r=>release=r);}
    await route.fulfill({json:result}).catch(()=>{});
   }else await route.fulfill({json:{summary:'Note retained',clarification_question:null}});
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  await page.locator('#page-home.active').waitFor();
  await page.locator('.rf-nav [data-page="candidates"]').click();
  assert.equal(await page.locator('#resumeUpload').isVisible(),true,'upload is available without opening a form');
  await page.locator('#resumeUpload').setInputFiles({name:'Alex.txt',mimeType:'text/plain',buffer:Buffer.from(resume)});
  await page.waitForFunction(()=>window.testSaved.candidates[0]?.resumeIntake?.phase==='processing');
  assert.equal(await page.evaluate(()=>window.testSaved.candidates.length),1,'candidate created without form submission');
  await page.locator('#page-detail.active').waitFor();
  await page.locator('#workspaceSubmission > summary').click();
  await page.locator('#submissionDraft').fill('Unsaved recruiter summary');
  assert.equal(await page.locator('#detailManagerScore').textContent(),'—','placeholder is not a rating');
  assert.equal(await page.locator('.rf-workspace-overview h3').textContent(),'Preparing the resume assessment');
  // Continue work on another job while intake completes.
  await page.locator('.rf-nav [data-page="dashboard"]').click();
  await page.evaluate(()=>{const select=document.querySelector('#globalJobSelect');select.value='job-b';select.dispatchEvent(new Event('change',{bubbles:true}));});
  release();
  await page.waitForFunction(()=>window.testSaved.candidates[0]?.resumeIntake?.phase==='ready');
  assert.equal(await page.locator('#page-dashboard.active').count(),1,'late completion must not navigate');
  assert.equal(await page.evaluate(()=>window.testSaved.candidates[0].jobId),'job-a');
  assert.equal(await page.locator('#resumeIntakeStatus').isVisible(),false);
  await page.evaluate(()=>{const select=document.querySelector('#globalJobSelect');select.value='job-a';select.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.locator('.rf-nav [data-page="candidates"]').click();
  await page.locator('[data-candidate-id]').first().click();
  assert.equal(await page.locator('#workspaceNote').inputValue(),'');
  assert.equal(await page.locator('#submissionDraft').inputValue(),'Unsaved recruiter summary');
  assert.match(await page.locator('#workspaceIntake').textContent(),/Awaiting your review/);
  assert.equal(await page.locator('#workspaceQuestions li').count(),3);
  await page.locator('#workspaceIntake details summary').filter({hasText:'Supporting resume evidence'}).click();
  assert.match(await page.locator('#workspaceIntake blockquote').textContent(),/Owned manual regression/);
  assert.equal(await page.locator('#fullRanking tr').count(),0,'unreviewed scores stay out of rankings');
  assert.match(await page.locator('#pipelineBoard').textContent(),/Awaiting assessment review/);
  assert.doesNotMatch(await page.locator('#pipelineBoard').textContent(),/0.0\/10/);
  await page.locator('#workspaceIntake [data-intake-approve]').click();
  await page.waitForFunction(()=>window.testSaved.candidates[0].managerScore===8.7);
  assert.equal(await page.locator('#fullRanking tr').count(),1);
  // Same resume, same job: no duplicate record or extra model call.
  await page.locator('.rf-nav [data-page="candidates"]').click();
  await page.locator('#resumeUpload').setInputFiles({name:'Alex copy.txt',mimeType:'text/plain',buffer:Buffer.from(resume)});
  await page.waitForFunction(()=>document.body.textContent.includes('This resume is already attached'));
  assert.equal(await page.evaluate(()=>window.testSaved.candidates.length),1);assert.equal(calls,1);
  // Reload uses the saved brief; it does not charge for another analysis.
  const snapshot=await page.evaluate(()=>({state:window.testSaved,docs:window.resumeDocs}));
  await page.addInitScript(data=>{window.reloadFixture=data.state;window.restoreDocs=data.docs;},snapshot);
  await page.locator('.rf-nav [data-page="candidates"]').click();
  // Clear unsaved UI drafts before this intentional reload.
  page.once('dialog',d=>d.accept());await page.reload();
  await page.locator('#page-home.active').waitFor();
  await page.locator('.rf-nav [data-page="candidates"]').click();
  await page.locator('[data-candidate-id]').first().click();
  assert.equal(await page.locator('#workspaceIntake').isVisible(),false);assert.match(await page.locator('#workspaceFit').textContent(),/8.7/);assert.equal(calls,1);
  // Use real Mammoth in the browser with synthetic Word text boxes, tables and glyphs.
  const wordFile={name:'Example.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:await require('./fixtures/docx-resume.cjs')()};
  await page.locator('.rf-nav [data-page="candidates"]').click();
  await page.locator('#resumeUpload').setInputFiles(wordFile);
  await page.waitForFunction(()=>window.testSaved.candidates.some(c=>c.resumeIntake?.phase==='error'));
  await page.locator('#workspaceIntake [data-intake-retry]').waitFor();
  assert.equal(await page.locator('.rf-workspace-overview h3').textContent(),'Retry the resume assessment');
  assert.doesNotMatch(await page.locator('.rf-workspace-overview').textContent(),/Preparing a screening brief/);
  await page.locator('.rf-nav [data-page="candidates"]').click();
  await page.locator('#resumeUpload').setInputFiles(wordFile);
  await page.waitForFunction(()=>window.testSaved.candidates.some(c=>c.name==='Jamie Rivera'&&c.resumeIntake?.phase==='ready'));
  assert.equal(await page.evaluate(()=>window.testSaved.candidates.length),2,'DOCX retry created a duplicate');
  assert.equal(wordCalls,2);assert.equal(await page.locator('.rf-workspace-overview h3').textContent(),'Review the screening brief');
  await page.locator('#workspaceIntake details summary').filter({hasText:'Supporting resume evidence'}).click();
  assert.match(await page.locator('#workspaceIntake blockquote').textContent(),/risk •documentation/,'display the actual Word source');
  assert.equal(await page.evaluate(()=>window.testSaved.candidates.find(c=>c.name==='Jamie Rivera').managerScore),0,'retry bypassed assessment review');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  assert.deepEqual(errors,[]);
  console.log('Resume intake journey passed: one upload, saved source, job-safe background work, cited brief, preserved drafts, explicit approval, duplicate prevention, reload, and mobile layout.');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});


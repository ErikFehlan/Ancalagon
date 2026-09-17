const {chromium}=require('playwright'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}}).listen(0,'127.0.0.1');
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME});const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message);});await page.route('https://**',r=>r.abort());
  await page.route('**/assets/auth.js*',r=>r.fulfill({contentType:'application/javascript',body:"document.body.classList.remove('rf-auth-pending');document.getElementById('authGate').style.display='none';"}));
  await page.route('**/assets/data.js*',r=>r.fulfill({contentType:'application/javascript',body:''}));
  await page.addInitScript(()=>{
   const quote='Jordan Lee | jordan@example.invalid | Security Analyst. '+('Earlier responsibilities included help desk coordination and documentation. '.repeat(12))+'Performed vulnerability scans using Nessus Professional and coordinated remediation with infrastructure teams. Supported endpoint administration.';
   const candidate=(id,short)=>({id,jobId:'job',name:short,short,role:'Security Analyst',stage:'Screened',jdScore:8,resumeJDScore:8,managerScore:8,originalManagerScore:8,rec:'Consider',signal:'Vulnerability scanning and remediation coordination.',strengths:['Performed vulnerability scans using Nessus Professional — Resume: “'+quote+'”','Coordinated remediation with infrastructure teams and third-party vendors.','Administered endpoint security using Carbon Black and Endpoint Central.','Built ServiceNow dashboards for operational reporting.','Automation ownership is unclear.'],concerns:['Confirm remediation closure ownership.'],tags:['Nessus'],screeningQuestions:['How did you verify remediation?'],createdAt:1,updatedAt:1,aiReview:{verdict:'Accurate',correctedScore:8,createdAt:1,notes:'Preserved at 8.0 because no new observations change the documented requirements (manager-calibration; profile-strength-2). '+('Supporting information is available from the candidate profile. '.repeat(10))}});
   window.fixture={jobs:[{id:'job',title:'Vulnerability Management Analyst',criteria:[],weights:[],knockouts:[],status:'active'}],candidates:[candidate('one','Jordan Lee'),{...candidate('two','Alex Morgan'),submissionDraft:{text:'Previously saved recruiter pitch.',updatedAt:1}},{...candidate('empty','New Candidate'),strengths:[]}],feedback:[{id:'f',jobId:'job',candidateId:'one',text:'PRIVATE NOTE: compensation concerns and uncertain automation ownership.',type:'General note',outcome:'Neutral / no signal',learningScope:'candidate',createdAt:1,updatedAt:1}],interviewOutcomes:[]};
   const clone=x=>JSON.parse(JSON.stringify(x));window.saved=clone(window.fixture);window.copied='';
   Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copied=text;}}});
   window.AncalagonData={create:()=>({load:async()=>window.fixture,loadHome:async()=>({}),visitHome:async()=>{},saveHome:async()=>{},loadHomeReviews:async()=>[],loadJobReassessments:async()=>[],loadAdminAnalytics:async()=>{throw Error('not admin')},trackEvent:async()=>{},schedule:(s,e,status)=>{window.saved=clone(s);status('saved');},flush:async s=>{window.saved=clone(s);}})};
   window.ancalagonAuth={session:{user:{id:'test'},access_token:'test'},workspace:{id:'test'}};
  });
  await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#page-home.active').waitFor();
  await page.locator('.rf-nav [data-page="candidates"]').click();await page.locator('[data-candidate-id="one"]').click();
  await page.locator('#workspaceSource > summary').click();
  const quote=await page.locator('#workspaceSourceQuote').textContent();assert.ok(quote.trim().split(/\s+/).length<=25);assert.match(quote,/Nessus Professional/);assert.doesNotMatch(quote,/@/);
  assert.equal(await page.locator('#detailStrengths li').count(),3);assert.ok((await page.locator('#detailStrengths').textContent()).length<900);
  assert.doesNotMatch(await page.locator('#workspaceAssessmentReasons').textContent(),/manager-calibration|profile-strength/);
  await page.locator('#workspaceSubmission > summary').click();
  const area=page.locator('#submissionDraft'),generated=await area.inputValue();assert.match(generated,/Nessus Professional/);assert.doesNotMatch(generated,/PRIVATE|unclear|Resume:|compensation|Questions to resolve|score/i);assert.ok(generated.split(/\s+/).length<=150);
  const screenshot=async name=>{if(process.env.CAPTURE_UI){await page.locator('#workspaceSubmission').screenshot({path:process.env.CAPTURE_UI+'-'+name+'.png'});}};
  for(const theme of ['tech','violet','emerald','graphite','ocean','ember','rose','light','paper','sage']){
   await page.evaluate(t=>document.querySelector('#rf-app').dataset.theme=t,theme);
   for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:1050});await page.waitForTimeout(70);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,theme+' at '+width);
    const metrics=await area.evaluate(e=>({height:e.clientHeight,scroll:e.scrollHeight,font:getComputedStyle(e).fontFamily,color:getComputedStyle(e).color}));assert.ok(metrics.scroll<=metrics.height+2,JSON.stringify(metrics));assert.doesNotMatch(metrics.font,/monospace/i);
    if(['ocean','light'].includes(theme)&&width!==320)await screenshot(theme+'-'+width);
   }
  }
  await page.setViewportSize({width:1440,height:1050});
  const edited='Jordan Lee — recruiter edit\n\n'+('• Supported documented remediation work.\n\n'.repeat(35));
  await area.fill(edited);await page.evaluate(()=>window.AncalagonWorkspace.refreshFeedback());assert.equal(await area.inputValue(),edited);
  const fit=await area.evaluate(e=>e.scrollHeight<=e.clientHeight+2);assert.equal(fit,true,'long recruiter edit grows without nested scrolling');
  await page.locator('#saveSubmissionDraft').click();assert.equal(await page.evaluate(()=>window.saved.candidates[0].submissionDraft.text),edited.trim());
  await page.locator('#workspaceCopy').click();assert.equal(await page.evaluate(()=>window.copied),edited,'copy uses exact edited text');
  page.once('dialog',d=>d.dismiss());await page.locator('#regenerateSubmission').click();assert.equal(await area.inputValue(),edited,'cancel retains draft');
  page.once('dialog',d=>d.accept());await page.locator('#regenerateSubmission').click();assert.equal(await area.inputValue(),generated);
  await page.locator('#saveSubmissionDraft').click();
  await page.locator('#backCandidates').click();await page.locator('[data-candidate-id="two"]').click();await page.locator('#workspaceSubmission > summary').click();assert.equal(await area.inputValue(),'Previously saved recruiter pitch.');
  await page.locator('#backCandidates').click();await page.locator('[data-candidate-id="one"]').click();await page.locator('#workspaceSubmission > summary').click();assert.equal(await area.inputValue(),generated);
  await page.locator('#backCandidates').click();await page.locator('[data-candidate-id="empty"]').click();await page.locator('#workspaceSubmission > summary').click();assert.equal(await area.inputValue(),'');
  const lastCopy=await page.evaluate(()=>window.copied);await page.locator('#workspaceCopy').click();assert.equal(await page.evaluate(()=>window.copied),lastCopy,'empty profile does not invent or copy a pitch');
  assert.deepEqual(errors,[]);console.log('PASS: brief evidence, positive submittal, editor autosize, copy/save/regenerate, saved draft preservation, candidate isolation, ten themes and narrow screens.');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

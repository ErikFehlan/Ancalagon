const {chromium}=require('playwright'),fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict');
const dir=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(dir,req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');try{res.end(fs.readFileSync(file))}catch{res.statusCode=404;res.end()}}).listen(0,'127.0.0.1');
 let browser;try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**',r=>r.abort());
  await page.route('**/assets/auth.js*',r=>r.fulfill({contentType:'application/javascript',body:"document.body.classList.remove('rf-auth-pending');document.getElementById('authGate').style.display='none';"}));
  await page.route('**/assets/data.js*',r=>r.fulfill({contentType:'application/javascript',body:''}));
  await page.route('**/functions/v1/**',r=>r.fulfill({json:{summary:'Specific ownership should be checked.',clarification_question:null}}));
  await page.addInitScript(()=>{
   const job=(id,title)=>({id,title,description:'Hands-on QA testing',criteria:['Must Have | manual testing'],knockouts:[],weights:[],status:'active'});
   const c=(id,jobId,name)=>({id,jobId,name,short:name,role:'QA Analyst',stage:'Sourced',score:7,jdScore:7,resumeJDScore:7,managerScore:7,originalManagerScore:7,rec:'Consider',signal:'Manual testing and release support',strengths:['Manual testing ownership — Resume: “Built regression test suites for release validation and API coverage.”'],concerns:['Confirm automation scope'],tags:['testing'],screeningQuestions:[],createdAt:1,updatedAt:1});
   window.fixture={jobs:[job('job-a','QA Analyst'),job('job-b','Application Security Engineer')],candidates:Array.from({length:24},(_,i)=>c('c'+i,'job-a','Example Candidate '+String(i).padStart(2,'0'))).concat(c('other','job-b','Other Job Candidate')),feedback:[{id:'f',jobId:'job-a',candidateId:'c0',candidate:'Example Candidate 00',text:'Clarify ownership',type:'General note',outcome:'Neutral / no signal',learningScope:'candidate',interpretation:{text:'Ask which test suites they owned.',source:'ai'},createdAt:1,updatedAt:1}],interviewOutcomes:[]};
   window.AncalagonData={create:()=>({load:async()=>window.fixture,loadHome:async()=>({}),visitHome:async()=>{},saveHome:async()=>{},loadHomeReviews:async()=>[],loadJobReassessments:async()=>[],loadAdminAnalytics:async()=>{throw Error('not admin')},trackEvent:async()=>{},schedule:(s,e,status)=>status('saved'),flush:async()=>{}})};
   window.ancalagonAuth={session:{user:{id:'test'},access_token:'test'},workspace:{id:'test'}};
  });
  const snap=async name=>{if(process.env.CAPTURE_UI){await page.waitForTimeout(250);await page.screenshot({path:process.env.CAPTURE_UI+'-'+name+'.png',fullPage:true});}};
  await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.locator('#page-home.active').waitFor();
  assert.equal(await page.locator('.rf-globaljob').isVisible(),false);assert.equal(await page.locator('.rf-bench').isVisible(),false);
  assert.equal(await page.locator('#analysisNav').evaluate(e=>e.open),false);assert.equal(await page.locator('#feedbackNav').evaluate(e=>e.open),false);
  await snap('home');
  await page.locator('.rf-nav [data-page="dashboard"]').click();await page.locator('#page-dashboard.active').waitFor();
  assert.equal(await page.locator('.rf-globaljob').isVisible(),true);assert.match(await page.locator('#workspaceBreadcrumbs').textContent(),/QA Analyst/);
  assert.equal(await page.locator('#dashboardDetails').evaluate(e=>e.open),false);assert.equal(await page.locator('#dashboardTopCandidates').isVisible(),true);assert.equal(await page.locator('#dashboardPipelineOverview').isVisible(),false);
  await snap('dashboard');
  await page.locator('.rf-nav [data-page="jobs"]').click();assert.equal(await page.locator('#jobEditor').evaluate(e=>e.open),false);await snap('jobs');
  assert.equal(await page.locator('[data-delete-job]').first().isVisible(),false);await page.locator('.rf-job-menu > summary').first().click();assert.equal(await page.locator('[data-delete-job]').first().isVisible(),true);await page.locator('.rf-job-menu > summary').first().press('Escape');assert.equal(await page.locator('[data-delete-job]').first().isVisible(),false);
  await page.locator('#newJobBtn').click();assert.equal(await page.locator('#jobEditor').evaluate(e=>e.open),true);assert.equal(await page.evaluate(()=>document.activeElement.id),'jobTitle');await page.waitForFunction(()=>!document.querySelector('#newJobBtn').classList.contains('primary'));
  await page.locator('.rf-nav [data-page="candidates"]').click();await page.locator('#candidateSearch').fill('Example');
  await page.locator('[data-candidate-id="c16"]').scrollIntoViewIfNeeded();const before=await page.evaluate(()=>scrollY);await page.locator('[data-candidate-id="c16"]').click();await page.locator('#page-detail.active').waitFor();
  await page.locator('#backCandidates').click();await page.waitForTimeout(100);assert.equal(await page.locator('#candidateSearch').inputValue(),'Example');assert.ok(Math.abs(await page.evaluate(()=>scrollY)-before)<5,'return to the same list position');
  await page.locator('#candidateSearch').fill('Candidate 00');await page.locator('[data-candidate-id="c0"]').click();await page.locator('#page-detail.active').waitFor();
  assert.equal(await page.locator('.rf-nav [data-page="candidates"]').getAttribute('aria-current'),'page');
  assert.equal(await page.locator('#detailStage').locator('..').isVisible(),true,'stage control remains accessible without opening evidence');
  assert.equal(await page.locator('#workspaceSubmission').evaluate(e=>e.open),false);
  assert.equal(await page.locator('#workspaceEvidence').textContent(),'Manual testing ownership');
  assert.equal(await page.locator('#workspaceSource').evaluate(e=>e.open),false);
  await page.locator('#workspaceSource > summary').click();
  assert.equal(await page.locator('#workspaceSourceQuote').textContent(),'Built regression test suites for release validation and API coverage.');
  await page.locator('#workspaceSource > summary').click();
  await snap('candidate');
  // Background assessment content may grow, but the focused note and caret stay put.
  await page.locator('#workspaceNote').fill('Testing ownership to clarify');
  const editor=await page.locator('#workspaceNote').evaluate(e=>{e.setSelectionRange(7,12);return {top:e.getBoundingClientRect().top,value:e.value,scroll:scrollY,height:document.documentElement.scrollHeight}});
  await page.evaluate(()=>{window.fixture.candidates[0].feedbackEvaluation={status:'error',error:'The request needs another try. '.repeat(40)};window.AncalagonWorkspace.refreshEvaluation();});
  await page.waitForTimeout(50);
  const after=await page.locator('#workspaceNote').evaluate(e=>({top:e.getBoundingClientRect().top,value:e.value,start:e.selectionStart,end:e.selectionEnd,focused:document.activeElement===e,scroll:scrollY,height:document.documentElement.scrollHeight}));
  assert.equal(after.value,editor.value);assert.equal(after.start,7);assert.equal(after.end,12);assert.equal(after.focused,true);assert.ok(Math.abs(after.top-editor.top)<5,'processing updates do not move the note editor: '+JSON.stringify({editor,after}));
  await page.evaluate(()=>{window.fixture.candidates[0].feedbackEvaluation=null;window.AncalagonWorkspace.refreshEvaluation();});
  // Correction text survives a changed interpretation arriving while the editor is focused.
  await page.evaluate(()=>window.AncalagonWorkspace.flushNotes());await page.waitForTimeout(300);if(!await page.locator('.rf-feedback-history').evaluate(e=>e.open))await page.locator('.rf-feedback-history > summary').click();await page.locator('#workspaceFeedback .rf-feedback-interpretation details > summary').last().click();
  const correction=page.locator('#workspaceFeedback textarea').last();await correction.fill('My unfinished clarification');
  await page.evaluate(()=>{window.fixture.feedback[0].interpretation.text='A new interpretation arrived';window.AncalagonWorkspace.refreshFeedback();});
  assert.equal(await correction.inputValue(),'My unfinished clarification');assert.equal(await correction.evaluate(e=>document.activeElement===e),true);
  await page.locator('#workspaceNote').focus();await page.waitForTimeout(30);assert.equal(await correction.inputValue(),'My unfinished clarification','unsaved correction survives a refresh after focus leaves');
  // Job filters are independent and remembered during this session.
  await page.evaluate(()=>{const s=document.querySelector('#globalJobSelect');s.value='job-b';s.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.locator('#page-candidates.active').waitFor();assert.equal(await page.locator('#candidateSearch').inputValue(),'');assert.equal(await page.locator('[data-candidate-id]').count(),1);
  await page.evaluate(()=>{const s=document.querySelector('#globalJobSelect');s.value='job-a';s.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal(await page.locator('#candidateSearch').inputValue(),'Candidate 00');assert.equal(await page.locator('[data-candidate-id]').count(),1);
  await page.locator('[data-candidate-id="c0"]').click();await page.locator('#recordCandidateOutcome').click();assert.equal(await page.locator('#outcomeCandidate').inputValue(),'c0');assert.equal(await page.locator('#feedbackNav').evaluate(e=>e.open),true);
  await page.locator('.rf-nav [data-page="pipeline"]').click();await page.locator('[data-goto="outcomes"]').filter({hasText:'Record interview outcome'}).click();await page.locator('#page-outcomes.active').waitFor();
  await page.locator('#analysisNav > summary').click();await page.locator('.rf-nav [data-page="insights"]').click();assert.equal(await page.locator('#insightDetails').evaluate(e=>e.open),false);assert.equal(await page.locator('#runHybridAnalysis').isVisible(),true);
  await page.locator('.rf-nav [data-page="candidates"]').click();await page.locator('[data-candidate-id="c0"]').click();
  for(const theme of ['tech','violet','emerald','light']){
   await page.evaluate(t=>document.querySelector('#rf-app').dataset.theme=t,theme);await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,theme+' mobile overflow');
  }
  await snap('mobile-light');await page.evaluate(()=>document.querySelector('#rf-app').dataset.theme='violet');await snap('mobile-violet');
  await page.locator('#mobileNavToggle').click();await page.locator('.rf-nav [data-page="home"]').click();assert.equal(await page.locator('#page-home.active').count(),1);assert.equal(await page.locator('.rf-globaljob').isVisible(),false);
  // Use the actual Settings controls: palette, native controls, and tutorial must agree.
  await page.setViewportSize({width:1440,height:1000});
  const palettes=['tech','violet','emerald','graphite','ocean','ember','rose','light','paper','sage'];
  const contrast=async selectors=>page.evaluate(selectors=>{
   const rgb=value=>value.match(/[\d.]+/g).map(Number);
   const luminance=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
   return selectors.flatMap(selector=>[...document.querySelectorAll(selector)].filter(e=>e.getClientRects().length&&!e.disabled).map(e=>{
    let bg=[255,255,255],chain=[];
    for(let p=e;p;p=p.parentElement)chain.unshift(p);
    for(const p of chain){const c=rgb(getComputedStyle(p).backgroundColor),alpha=c[3]??1;bg=bg.map((v,i)=>c[i]*alpha+v*(1-alpha));}
    const fg=rgb(getComputedStyle(e).color),a=luminance(fg),b=luminance(bg);
    return {theme:document.querySelector('#rf-app').dataset.theme,selector,foreground:fg,background:bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
   }));
  },selectors);
  const readable=async selectors=>{const results=await contrast(selectors);assert.ok(results.length);for(const result of results)assert.ok(result.ratio>=4.5,JSON.stringify(result));};
  for(const theme of palettes){
   await page.locator('[data-goto="backend"]').first().click();
   await page.locator('[data-theme-choice="'+theme+'"]').click();
   assert.equal(await page.locator('#rf-app').getAttribute('data-theme'),theme);
   assert.equal(await page.locator('#themePicker [aria-checked="true"]').count(),1);
   assert.equal(await page.locator('#themePicker [tabindex="0"]').count(),1);
   assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#rf-app')).colorScheme),['light','paper','sage'].includes(theme)?'light':'dark');
   await readable(['#appearanceHeading','#themeHelp','.rf-theme-title strong','.rf-theme-option small','#activeThemeLabel','#passwordForm label','#passwordSubmit','#newPassword']);
   await page.setViewportSize({width:320,height:850});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,theme+' settings at 320px');
   assert.equal(await page.locator('#themePicker').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,theme+' picker overflow');
   if(['graphite','ocean','paper','sage'].includes(theme))await snap('settings-mobile-'+theme);
   await page.setViewportSize({width:1440,height:1000});
   await page.locator('.rf-nav [data-page="learn"]').click();
   await readable(['#ancalagon-tutorial h1','#ancalagon-tutorial .at-muted','#ancalagon-tutorial .at-primary']);
   assert.equal(await page.locator('#ancalagon-tutorial').evaluate(e=>getComputedStyle(e).colorScheme),['light','paper','sage'].includes(theme)?'light':'dark');
   await page.locator('.rf-nav [data-page="candidates"]').click();
   await page.locator('[data-candidate-id="c0"]').click();
   await readable(['#detailName','#workspaceNote','.rf-select-button']);
   const stage=page.locator('#detailStage').locator('..').locator('.rf-select-button');
   await stage.click();await readable(['.rf-select.open .rf-select-option']);await stage.press('Escape');
  }
  await page.locator('[data-goto="backend"]').first().click();
  await snap('settings-desktop');
  await page.locator('[data-theme-choice="sage"]').press('ArrowRight');
  assert.equal(await page.locator('#rf-app').getAttribute('data-theme'),'tech');
  await page.locator('[data-theme-choice="tech"]').press('End');
  assert.equal(await page.locator('[data-theme-choice="sage"]').evaluate(e=>document.activeElement===e),true);
  await page.locator('[data-theme-choice="sage"]').press('Home');
  await page.locator('[data-theme-choice="paper"]').click();
  await page.reload();await page.locator('#page-home.active').waitFor();
  assert.equal(await page.locator('#rf-app').getAttribute('data-theme'),'paper','chosen theme survives reload');
  await page.evaluate(()=>localStorage.setItem('ancalagon-theme-v1','__proto__'));
  await page.reload();await page.locator('#page-home.active').waitFor();
  assert.equal(await page.locator('#rf-app').getAttribute('data-theme'),'tech','unknown saved themes recover to the default');
  assert.deepEqual(errors,[]);console.log('Focused UI passed: recruiting workflows, ten theme controls, keyboard selection, reload persistence, mobile layout, and readable settings, candidate controls, menus, and tutorial.');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

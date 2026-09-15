const {chromium}=require('playwright'),fs=require('fs'),http=require('http'),path=require('path'),assert=require('node:assert/strict');
const dir=path.resolve(__dirname,'..'),copy=x=>JSON.parse(JSON.stringify(x));
const empty=()=>({jobs:[],candidates:[],feedback:[],interviewOutcomes:[]});
(async()=>{
 const accounts={alpha:{state:empty(),home:null,tutorial:null,revision:0},beta:{state:empty(),home:null,tutorial:null,revision:0}};
 let failTutorial=false,liveWrites=0,engineCalls=0;const errors=[];
 const server=http.createServer(async(req,res)=>{
  if(req.url.startsWith('/test/')){
   const [,,user,operation]=req.url.split('/'),account=accounts[user];let body='';for await(const part of req)body+=part;const input=body?JSON.parse(body):null;res.setHeader('Content-Type','application/json');
   if(operation==='load')res.end(JSON.stringify(account.state));
   else if(operation==='home')res.end(JSON.stringify(account.home));
   else if(operation==='visit'){account.home??={first_visited_at:new Date().toISOString()};res.end('{}');}
   else if(operation==='bookmark'){Object.assign(account.home,input);res.end('{}');}
   else if(operation==='tutorial')res.end(JSON.stringify({state:account.tutorial,revision:account.revision}));
   else if(operation==='save-tutorial'){
    if(failTutorial){res.statusCode=503;res.end('{}');return;}
    if(input.revision!==account.revision){res.statusCode=409;res.end('{}');return;}
    account.tutorial=input.state;account.revision++;res.end(JSON.stringify({revision:account.revision}));
   }else if(operation==='save-live'){liveWrites++;account.state=input;res.end('{}');}
   else {res.statusCode=404;res.end('{}');}return;
  }
  const file=path.join(dir,req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');try{res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}
 }).listen(0,'127.0.0.1');
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME});fs.mkdirSync('test-results',{recursive:true});
  async function open(user){
   const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/functions/v1/'))engineCalls++;});
   await page.route('https://**',r=>r.abort());
   await page.route('**/assets/auth.js*',r=>r.fulfill({contentType:'application/javascript',body:"document.body.classList.remove('rf-auth-pending');document.getElementById('authGate').style.display='none';"}));
   await page.route('**/assets/data.js*',r=>r.fulfill({contentType:'application/javascript',body:''}));
   await page.addInitScript(user=>{
    const rpc=async(operation,input)=>{const response=await fetch('/test/'+user+'/'+operation,{method:input?'POST':'GET',body:input?JSON.stringify(input):undefined});if(!response.ok)throw Object.assign(Error('Test network unavailable'),{code:response.status===409?'TUTORIAL_CONFLICT':'NETWORK'});return response.json();};
    window.AncalagonData={create:()=>({load:()=>rpc('load'),loadHome:()=>rpc('home'),visitHome:()=>rpc('visit'),saveHome:location=>rpc('bookmark',location),loadHomeReviews:async()=>[],loadJobReassessments:async()=>[],loadTutorial:()=>rpc('tutorial'),saveTutorial:(state,revision)=>rpc('save-tutorial',{state,revision}),trackEvent:async()=>{},loadAdminAnalytics:async()=>{throw Error('not admin');},schedule:(state,onError,status)=>rpc('save-live',state).then(()=>status('saved')),flush:state=>state.jobs.length?rpc('save-live',state):Promise.resolve()})};
    window.ancalagonAuth={session:{user:{id:user,user_metadata:{display_name:user}}},workspace:{id:'workspace-'+user}};
   },user);
   await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.locator('#page-home.active').waitFor();return {page,context};
  }
  async function synced(page){await page.waitForFunction(()=>document.getElementById('at-sync-status').textContent==='Practice progress synced to your account');}
  async function fits(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.equal(await page.locator('#ancalagon-tutorial').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);}
  let {page,context}=await open('alpha');
  await page.locator('#workspaceHome [data-home-action="learn"]').click();await page.locator('#ancalagon-tutorial [data-action="start"]').waitFor();
  await page.screenshot({path:'test-results/tutorial-learning-center.png',fullPage:true});
  await page.locator('#at-quick-answers details').first().locator('summary').click();assert.match(await page.locator('#at-quick-answers').textContent(),/JD Fit/);
  await page.locator('.rf-nav [data-page="home"]').click();await page.locator('[data-home-action="practice"]').click();
  await page.locator('[data-stage="1"]:visible').waitFor();await page.setViewportSize({width:320,height:850});await fits(page);
  await page.locator('#at-job-title-input').fill('Practice QA search');await page.locator('#at-job-form button[type="submit"]').click();
  await page.locator('[data-action="upload"]').click();assert.match(await page.locator('#at-upload-count').textContent(),/2 ready/);
  await page.locator('[data-action="retry"]').click();assert.match(await page.locator('#at-upload-count').textContent(),/3 ready/);await fits(page);
  await page.locator('[data-action="to-review"]').click();assert.equal(await page.locator('[data-action="approve-assessment"]').isEnabled(),false);assert.equal(await page.locator('#at-jd-score').textContent(),'7.8');
  await fits(page);await page.screenshot({path:'test-results/tutorial-evidence-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'test-results/tutorial-evidence-desktop.png',fullPage:true});
  await page.evaluate(()=>document.getElementById('rf-app').dataset.theme='light');await page.screenshot({path:'test-results/tutorial-evidence-light.png',fullPage:true});
  await page.evaluate(()=>document.getElementById('rf-app').dataset.theme='tech');
  await page.locator('#at-source summary').click();await page.locator('[data-action="approve-assessment"]').click();assert.equal(await page.locator('#at-candidate-name').textContent(),'Alex Rivera');
  await page.locator('[data-action="leave"]').click();await synced(page);assert.equal(accounts.alpha.tutorial.reviewIndex,1);await context.close();
  // A fresh browser context has no local storage or cookies. Progress comes from the account.
  ({page,context}=await open('alpha'));await page.locator('[data-home-action="practice"]').click();assert.equal(await page.locator('#at-candidate-name').textContent(),'Alex Rivera');assert.equal(await page.locator('#at-job-title-input').inputValue(),'Practice QA search');
  for(let i=0;i<2;i++){await page.locator('#at-source summary').click();await page.locator('[data-action="approve-assessment"]').click();}
  await page.locator('[data-action="to-feedback"]').click();failTutorial=true;
  await page.locator('#at-note-form button[type="submit"]').click();await page.locator('#at-sync-error:visible').waitFor();assert.match(await page.locator('#at-sync-problem').textContent(),/not synced/);
  failTutorial=false;await page.locator('[data-action="sync-retry"]').click();await page.locator('#at-interpretation:visible').waitFor();assert.equal(accounts.alpha.tutorial.notePhase,1);
  assert.match(await page.locator('#at-original-note').textContent(),/maintained it for two releases/);
  await page.locator('[data-action="accept-interpretation"]').click();assert.equal(await page.locator('#at-manager-change').textContent(),'6.2 → 7.9');
  await page.locator('[data-action="approve-update"]').click();await page.locator('[data-action="to-shortlist"]').click();
  await page.locator('#at-draft').fill('Edited practice summary. Ask which tests Jordan owned.');await page.locator('#at-draft-form button[type="submit"]').click();
  await page.locator('[data-view="complete"]:visible').waitFor();assert.equal(accounts.alpha.tutorial.complete,true);assert.equal(accounts.alpha.tutorial.draft,'Edited practice summary. Ask which tests Jordan owned.');
  await page.screenshot({path:'test-results/tutorial-complete.png',fullPage:true});
  // Practice never changes live jobs, candidates, feedback, or the last real job bookmark.
  assert.equal(liveWrites,0);assert.equal(engineCalls,0);assert.deepEqual(accounts.alpha.state,empty());assert.equal(accounts.alpha.home.last_job_id,undefined);
  await page.locator('[data-view="complete"] [data-action="new-job"]').click();await page.locator('#page-jobs.active').waitFor();assert.equal(await page.locator('#jobTitle').inputValue(),'');assert.equal(await page.evaluate(()=>document.activeElement.id),'jobTitle');
  await context.close();({page,context}=await open('alpha'));await page.locator('#workspaceHome [data-home-action="learn"]').click();await page.locator('[data-action="start"]').click();assert.equal(await page.locator('#at-draft').inputValue(),'Edited practice summary. Ask which tests Jordan owned.');
  for(const width of [320,390]){await page.setViewportSize({width,height:850});for(const step of [1,2,3,4,5]){await page.locator('[data-step="'+step+'"]').click();await fits(page);}}
  await synced(page);await context.close();
  ({page,context}=await open('beta'));await page.locator('[data-home-action="practice"]').click();assert.equal(await page.locator('#at-job-title-input').inputValue(),'QA Engineer');assert.equal(await page.locator('[data-stage="1"]').isVisible(),true);assert.equal(accounts.beta.tutorial?.complete||false,false);await synced(page);await context.close();
  assert.deepEqual(errors,[]);console.log('Tutorial journey passed: isolated practice, source review, retry, remote resume, account separation, save recovery, draft handoff, 320px/mobile and light/dark layouts.');
 }finally{if(browser)await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

const {chromium}=require('playwright'),fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict');
const dir=path.resolve(__dirname,'..'),copy=x=>JSON.parse(JSON.stringify(x));
const job=(id,title)=>({id,title,client:'Example company',description:'Manual QA testing and release verification',criteria:['Must Have | manual testing'],knockouts:[],weights:[],status:'active',createdAt:1,updatedAt:1});
const candidate=(id,jobId,name)=>({id,jobId,name,short:name,role:'QA Analyst',stage:'Sourced',resumeJDScore:7,jdScore:7,originalManagerScore:7,managerScore:7,rec:'Consider',signal:'Manual testing',strengths:['Manual regression ownership'],concerns:[],tags:[],screeningQuestions:[],createdAt:1,updatedAt:1});
(async()=>{
 const empty=()=>({jobs:[],candidates:[],feedback:[],interviewOutcomes:[]});
 const accounts={new:{state:empty(),home:null},returning:{state:{...empty(),jobs:[job('job-a','QA Analyst'),job('job-b','Application Security Engineer')],candidates:[candidate('a','job-a','Alex Example'),candidate('b','job-b','Jamie Example')]},home:null}};
 let failHome=false;
 const server=http.createServer(async(req,res)=>{
  if(req.url.startsWith('/test/')){
   const [, ,user,operation]=req.url.split('/'),account=accounts[user];let body='';for await(const chunk of req)body+=chunk;
   res.setHeader('Content-Type','application/json');if(failHome&&operation.includes('home')){res.statusCode=503;res.end('{}');return;}
   if(operation==='load')res.end(JSON.stringify(account.state));
   else if(operation==='home')res.end(JSON.stringify(account.home));
   else if(operation==='visit-home'){account.home??={first_visited_at:new Date().toISOString()};res.end('{}');}
   else if(operation==='save-home'){account.home={...account.home,...JSON.parse(body)};res.end('{}');}
   else if(operation==='save'){account.state=JSON.parse(body);res.end('{}');}return;
  }
  const file=path.join(dir,req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');try{res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}
 }).listen(0,'127.0.0.1');
 let browser;const errors=[];
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME});
  async function open(user){
   const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://**',r=>r.abort());
   await page.route('**/assets/auth.js*',r=>r.fulfill({contentType:'application/javascript',body:"document.body.classList.remove('rf-auth-pending');document.getElementById('authGate').style.display='none';"}));
   await page.route('**/assets/data.js*',r=>r.fulfill({contentType:'application/javascript',body:''}));
   await page.addInitScript(user=>{
    const rpc=async(op,data)=>{const r=await fetch('/test/'+user+'/'+op,{method:data?'POST':'GET',body:data?JSON.stringify(data):undefined});if(!r.ok)throw Error('Network unavailable');return r.json();};
    window.AncalagonData={create:()=>({load:()=>rpc('load'),loadHome:()=>rpc('home'),visitHome:()=>rpc('visit-home'),saveHome:x=>rpc('save-home',x),loadHomeReviews:async()=>user==='returning'?[{candidate_id:'a',job_id:'job-a',status:'ready'}]:[],
     loadJobReassessments:async()=>[],trackEvent:async()=>{},loadAdminAnalytics:async()=>{throw Error('not admin')},schedule:(s,e,status)=>rpc('save',s).then(()=>status('saved')),flush:s=>rpc('save',s)})};
    window.ancalagonAuth={session:{user:{id:user,user_metadata:{display_name:user==='new'?'Taylor':'Erik'}}},workspace:{id:user}};
   },user);
   await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.locator('#page-home.active').waitFor();return {page,context};
  }
  let {page,context}=await open('new');
  await page.getByRole('heading',{name:'Get started here',exact:true}).waitFor();
  assert.equal(await page.locator('#searchFlow').isVisible(),false,'the separate job banner is hidden on Home');
  assert.equal(await page.locator('#workspaceHome [data-home-action="new"]').count(),1);
  await page.waitForTimeout(350);if(process.env.CAPTURE_UI)await page.screenshot({path:process.env.CAPTURE_UI+'-new-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(350);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.waitForTimeout(350);if(process.env.CAPTURE_UI)await page.screenshot({path:process.env.CAPTURE_UI+'-new-mobile.png',fullPage:true});
  // Navigation is never a mandatory wizard and creating a job focuses the actual form.
  await page.locator('#workspaceHome [data-home-action="new"]').first().click();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'jobTitle');
  await page.locator('#jobTitle').fill('My first search');await page.locator('#jobDescription').fill('Manual testing and release verification');await page.locator('#jobForm button[type=submit]').click();
  await page.locator('#page-candidates.active').waitFor();await page.evaluate(()=>window.ancalagonFlush());
  assert.equal(await page.evaluate(()=>document.activeElement.id),'resumeUpload');assert.match(await page.locator('#searchFlow').textContent(),/Upload resumes/);assert.equal(accounts.new.state.jobs.length,1);assert.equal(accounts.new.home.last_page,'candidates');
  await context.close();
  // Fresh browser context has no browser storage; returning experience comes from the account.
  ({page,context}=await open('new'));await page.getByRole('heading',{name:'Pick up where you left off',exact:true}).waitFor();
  await page.locator('#homeSearchFlow').waitFor();assert.match(await page.locator('#homeSearchFlow').textContent(),/My first search/);
  assert.equal(await page.locator('#homeSearchFlow ol li').count(),4);
  assert.match(await page.locator('#homeSearchFlow [data-search-action="next"]').textContent(),/Upload resumes/);
  await page.locator('#workspaceHome [data-home-action="new"]').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'jobTitle');assert.equal(accounts.new.state.jobs.length,1,'starting another job preserves the existing search');
  await context.close();
  ({page,context}=await open('returning'));await page.getByRole('heading',{name:'Pick up where you left off',exact:true}).waitFor();
  assert.equal(await page.locator('[data-home-action="continue"]').count(),0,'existing user gets useful jobs without an invented last visit');
  assert.doesNotMatch(await page.locator('#workspaceHome').textContent(),/My first search/,'accounts never share home content');
  assert.match(await page.locator('#homeSearchFlow').textContent(),/QA Analyst/);
  await page.locator('#homeSearchFlow [data-search-action="next"]').click();await page.locator('#page-detail.active').waitFor();assert.equal(await page.locator('#detailName').textContent(),'Alex Example');await page.locator('.rf-nav [data-page="home"]').click();
  await page.locator('[data-home-action="job"][data-job="job-b"]').click();await page.locator('.rf-nav [data-page="candidates"]').click();await page.locator('[data-candidate-id="b"]').first().click();
  await page.locator('#page-detail.active').waitFor();await page.evaluate(()=>window.ancalagonFlush());
  assert.equal(accounts.returning.home.last_job_id,'job-b');assert.equal(accounts.returning.home.last_candidate_id,'b');
  await page.locator('.rf-nav [data-page="home"]').click();await page.locator('#homeSearchFlow').waitFor();
  assert.match(await page.locator('#homeSearchFlow').textContent(),/Application Security Engineer/);
  assert.match(await page.locator('[data-home-action="job"][data-job="job-a"]').textContent(),/1 candidate.*1 to review/);
  assert.equal(await page.locator('[data-home-action="job"][data-job="job-b"]').count(),0,'last job is not duplicated in the list');
  assert.equal(await page.locator('#workspaceHome .rf-btn.primary').count(),1,'the next workflow step is the one primary action');
  assert.equal(await page.locator('#searchFlow').isVisible(),false);
  await page.locator('[data-home-action="job"][data-job="job-a"]').focus();await page.keyboard.press('Enter');await page.locator('#page-dashboard.active').waitFor();
  assert.equal(await page.locator('#searchFlow').isVisible(),true,'guidance remains inside the job');
  await page.locator('.rf-nav [data-page="home"]').click();await page.locator('[data-home-action="job"][data-job="job-b"]').click();await page.locator('.rf-nav [data-page="candidates"]').click();await page.locator('[data-candidate-id="b"]').first().click();await page.locator('.rf-nav [data-page="home"]').click();await page.evaluate(()=>window.ancalagonFlush());
  await context.close();
  // Home follows the bookmark even when another job is active in the saved workspace.
  accounts.returning.state.activeJobId='job-a';
  ({page,context}=await open('returning'));
  await page.locator('#homeSearchFlow [data-search-action="next"]').click();
  await page.locator('#page-detail.active').waitFor();assert.equal(await page.locator('#detailName').textContent(),'Jamie Example');
  await page.evaluate(()=>window.ancalagonFlush());await context.close();
  accounts.returning.state.candidates.find(c=>c.id==='b').aiReview={verdict:'Accurate'};
  ({page,context}=await open('returning'));await page.getByRole('button',{name:'Prepare submittal →',exact:true}).waitFor();
  assert.equal(await page.locator('#homeSearchFlow li[aria-current="step"]').textContent(),'4Prepare submittal');
  assert.equal(await page.locator('.rf-home-continue').count(),0,'workflow replaces the duplicate Continue card');
  await page.waitForTimeout(350);if(process.env.CAPTURE_UI)await page.screenshot({path:process.env.CAPTURE_UI+'-return-desktop.png',fullPage:true});
  await page.evaluate(()=>document.getElementById('rf-app').dataset.theme='light');
  if(process.env.CAPTURE_UI)await page.screenshot({path:process.env.CAPTURE_UI+'-return-light.png',fullPage:true});
  await page.evaluate(()=>document.getElementById('rf-app').dataset.theme='tech');
  for(const width of [390,320]){await page.setViewportSize({width,height:844});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}
  if(process.env.CAPTURE_UI)await page.screenshot({path:process.env.CAPTURE_UI+'-return-mobile.png',fullPage:true});
  await context.close();({page,context}=await open('returning'));await page.locator('#homeSearchFlow [data-search-action="next"]').click();
  await page.locator('#page-detail.active').waitFor();assert.equal(await page.locator('#detailName').textContent(),'Jamie Example');
  await page.waitForFunction(()=>document.activeElement.id==='submissionDraft');
  await context.close();accounts.returning.state.candidates=accounts.returning.state.candidates.filter(c=>c.id!=='b');
  ({page,context}=await open('returning'));await page.locator('#homeSearchFlow [data-search-action="next"]').click();await page.locator('#page-candidates.active').waitFor();await context.close();
  accounts.returning.state.jobs=accounts.returning.state.jobs.filter(j=>j.id!=='job-b');
  ({page,context}=await open('returning'));await page.getByRole('heading',{name:'Pick up where you left off',exact:true}).waitFor();assert.match(await page.locator('#homeSearchFlow').textContent(),/QA Analyst/);await context.close();
  failHome=true;({page,context}=await open('returning'));await page.locator('.rf-home-notice').waitFor();assert.equal(await page.locator('#homeSearchFlow [data-search-action="next"]').count(),1,'bookmark failure does not block access');
  failHome=false;await page.locator('[data-home-action="retry"]').click();await page.locator('.rf-home-notice').waitFor({state:'detached'});await context.close();
  accounts.returning.state.jobs.push({...job('closed','Finished search'),status:'closed'});
  accounts.returning.home={last_job_id:'closed',last_page:'dashboard'};
  ({page,context}=await open('returning'));assert.match(await page.locator('#homeSearchFlow').textContent(),/QA Analyst/);
  await page.locator('[data-home-action="continue"]').click();await page.locator('#page-dashboard.active').waitFor();await context.close();
  assert.deepEqual(errors,[]);console.log('Home journey passed: first visit, direct setup, cross-device resume, account separation, deleted records, sync recovery, desktop and mobile.');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

const {chromium}=require('playwright');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const server=http.createServer((req,res)=>{const file=path.join(root,req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');try{res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}}).listen(0,'127.0.0.1');
 let browser;
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME});const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**',r=>r.abort());
  await page.route('**/assets/auth.js*',r=>r.fulfill({contentType:'application/javascript',body:"document.body.classList.remove('rf-auth-pending');document.getElementById('authGate').style.display='none';"}));
  await page.route('**/assets/data.js*',r=>r.fulfill({contentType:'application/javascript',body:''}));
  await page.addInitScript(()=>{window.AncalagonData={create:()=>({load:async()=>({jobs:[],candidates:[],feedback:[],interviewOutcomes:[]}),schedule:(_s,_e,status)=>status('saved'),flush:async()=>{},trackEvent:async()=>{},isAppAdmin:async()=>false})};window.ancalagonAuth={session:{user:{id:'synthetic'}},workspace:{id:'synthetic'}};});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.locator('#page-home.active').waitFor();
  const probe='<img data-security-probe src=x onerror="window.injected=true">';
  await page.locator('.rf-nav [data-page="jobs"]').click();
  await page.locator('#jobTitle').fill('Synthetic '+probe);await page.locator('#jobDescription').fill('QA testing '+probe);
  await page.locator('#jobForm button[type=submit]').click();await page.locator('#page-dashboard.active').waitFor();
  await page.locator('#addCandidateBtn').click();await page.locator('#manualCandidateEntry > summary').click();
  await page.locator('#candidateName').fill('Pat '+probe);await page.locator('#candidateRole').fill('QA');await page.locator('#candidateScore').fill('8');await page.locator('#candidateSignal').fill(probe);await page.locator('#candidateStrengths').fill(probe);
  await page.locator('#candidateForm button[type=submit]').click();await page.locator('#page-detail.active').waitFor();
  for(const screen of ['dashboard','candidates','pipeline']){
   await page.locator(`.rf-nav [data-page="${screen}"]`).click();
   assert.equal(await page.locator('#rf-app [data-security-probe]').count(),0,'User text became markup on '+screen);
  }
  assert.equal(await page.evaluate(()=>window.injected),undefined);
  // Verify the policy itself independently of escaping.
  await page.evaluate(()=>{const div=document.createElement('div');div.innerHTML='<img src="/missing-probe" onerror="window.cspBypassed=true">';document.body.append(div);});
  await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.cspBypassed),undefined,'Inline script escaped the CSP');
  assert.deepEqual(errors,[]);console.log('PASS: candidate/job text stays text across views; inline script execution is blocked.');
 }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

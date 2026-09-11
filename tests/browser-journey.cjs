const {chromium}=require('playwright');
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict');
const dir=path.resolve(__dirname,'..');
(async()=>{const server=http.createServer((req,res)=>{const file=path.join(dir,req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');try{res.end(fs.readFileSync(file))}catch{res.statusCode=404;res.end()}}).listen(0,'127.0.0.1');
let browser;try{
browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/assets/auth.js*',r=>r.fulfill({contentType:'application/javascript',body:"document.body.classList.remove('rf-auth-pending');document.getElementById('authGate').style.display='none';"}));
await page.route('https://**',r=>r.abort());
await page.addInitScript(()=>{window.testSaved=null;window.AncalagonData={create:()=>({load:async()=>({jobs:[],candidates:[],feedback:[],interviewOutcomes:[]}),schedule:(s,e,status)=>{window.testSaved=JSON.parse(JSON.stringify(s));status('saved')},flush:async s=>{window.testSaved=s},trackEvent:async()=>{},loadAdminAnalytics:async()=>{throw Error('not admin')}})};window.ancalagonAuth={session:{user:{id:'test'}},workspace:{id:'test'}}});
await page.route('**/assets/data.js*',r=>r.fulfill({contentType:'application/javascript',body:''}));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.locator('#jobTitle').fill('Reliability test');await page.locator('#jobDescription').fill('Build and maintain Kubernetes infrastructure');await page.locator('#jobForm button[type=submit]').click();
await page.locator('#page-dashboard.active').waitFor();assert.equal(await page.evaluate(()=>window.testSaved.jobs[0].title),'Reliability test');
await page.locator('#addCandidateBtn').click();await page.locator('#candidateName').fill('Test Candidate');await page.locator('#candidateRole').fill('Engineer');await page.locator('#candidateScore').fill('8.5');await page.locator('#candidateSignal').fill('Infrastructure engineer');await page.locator('#candidateStrengths').fill('Built production Kubernetes clusters');await page.locator('#candidateForm button[type=submit]').click();
await page.locator('#page-detail.active').waitFor();assert.equal(await page.locator('#detailName').textContent(),'Test Candidate');assert.equal(await page.evaluate(()=>window.testSaved.candidates.length),1);assert.deepEqual(errors,[]);console.log('Browser journey passed: empty workspace, create job, add candidate, open score and evidence detail.');
}finally{if(browser)await browser.close();server.close()}})().catch(e=>{console.error(e);process.exitCode=1});

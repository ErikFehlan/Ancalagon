const {chromium}=require('playwright'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const dir=path.resolve(__dirname,'..');
const sql=fs.readFileSync(path.join(dir,'supabase/migrations/20260915150000_admin_tools.sql'),'utf8');
const resources=Object.fromEntries([...sql.matchAll(/\('([a-z]+)', \$resource\$([\s\S]*?)\$resource\$\)/g)].map(m=>[m[1],m[2]]));
const names={server:'server.ts',schema:'schema.sql',prompt:'evaluation-prompt.txt',pkg:'package.json',env:'.env.example'};
(async()=>{
 let revoked=false,failTools=false,holdTools=false,held=null,downloads=0;
 const server=http.createServer(async(req,res)=>{
  if(req.url.startsWith('/rpc/')){
   let raw='';for await(const chunk of req)raw+=chunk;
   const input=raw?JSON.parse(raw):{},op=req.url.slice(5),admin=req.headers['x-test-account']==='admin'&&!revoked;
   res.setHeader('Content-Type','application/json');
   if(op==='is-admin'){res.end(JSON.stringify(admin));return;}
   if(!admin){res.statusCode=403;res.end(JSON.stringify({code:'42501',message:'Admin access required'}));return;}
   if(op==='usage'){res.end(JSON.stringify({totals:{accounts:2},users:[{email:'admin@example.test'}]}));return;}
   if(op==='tools'){
    if(failTools){res.statusCode=503;res.end(JSON.stringify({message:'Try again'}));return;}
    if(holdTools){held=()=>res.end(JSON.stringify({html:resources.panel}));return;}
    res.end(JSON.stringify({html:resources.panel}));return;
   }
   if(op==='download'){downloads++;res.end(JSON.stringify({name:names[input.file],type:'text/plain',content:resources[input.file].replaceAll('__ANCALAGON_MODEL__',input.model).replaceAll('__ANCALAGON_PROJECT__',input.project)}));return;}
  }
  const requestPath=req.url.split('?')[0];
  if(requestPath!=='/'&&requestPath!=='/index.html'&&!requestPath.startsWith('/assets/')){res.statusCode=404;res.end();return;}
  const file=path.join(dir,requestPath==='/'?'index.html':requestPath);
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');
  try{res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}
 }).listen(0,'127.0.0.1');
 let browser;const errors=[];
 try{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROME});
  async function open(user){
   const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await context.newPage();
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://**',route=>route.abort());
   await page.route('**/assets/auth.js*',route=>route.fulfill({contentType:'application/javascript',body:"document.body.classList.remove('rf-auth-pending');document.getElementById('authGate').style.display='none';"}));
   await page.route('**/assets/data.js*',route=>route.fulfill({contentType:'application/javascript',body:''}));
   await page.addInitScript(user=>{
    const rpc=async(op,input)=>{const response=await fetch('/rpc/'+op,{method:'POST',headers:{'X-Test-Account':user},body:JSON.stringify(input||{})});const result=await response.json();if(!response.ok)throw Object.assign(Error(result.message),{code:result.code});return result;};
    window.AncalagonData={create:()=>({load:async()=>({jobs:[],candidates:[],feedback:[],interviewOutcomes:[]}),loadHome:async()=>null,visitHome:async()=>{},loadHomeReviews:async()=>[],loadJobReassessments:async()=>[],trackEvent:async()=>{},schedule:()=>{},flush:async()=>{},loadAdminAnalytics:()=>rpc('usage'),isAppAdmin:()=>rpc('is-admin'),loadAdminTools:()=>rpc('tools'),loadAdminStarterFile:(file,model,project)=>rpc('download',{file,model,project})})};
    // Owning a workspace or setting user metadata never grants application-admin rights.
    window.ancalagonAuth={session:{user:{id:user,user_metadata:{role:'admin',admin:true}}},workspace:{id:user,role:'owner'}};
   },user);
   await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.locator('#page-home.active').waitFor();return {page,context};
  }
  let {page,context}=await open('regular');
  await page.locator('[data-goto="backend"]').first().click();
  assert.equal(await page.locator('#appearanceSettings').isVisible(),true);assert.equal(await page.locator('#passwordForm').isVisible(),true);
  assert.equal(await page.locator('#adminToolsNav').isVisible(),false);assert.equal(await page.locator('#patternFunctionUrl,#downloadServer').count(),0);
  // A user who forces the hidden navigation button visible still cannot enter or load it.
  await page.evaluate(()=>{const button=document.getElementById('adminToolsNav');button.hidden=false;button.classList.remove('rf-hidden');button.click();});
  assert.equal(await page.locator('#page-backend.active').count(),1);assert.equal(await page.locator('#adminToolsContent').textContent(),'');
  const denial=await page.evaluate(async()=>{try{await window.AncalagonData.create().loadAdminTools();return 'allowed';}catch(error){return error.code;}});assert.equal(denial,'42501');
  assert.equal(downloads,0);await context.close();
  ({page,context}=await open('admin'));
  await page.locator('#adminToolsNav').waitFor({state:'visible'});await page.locator('#adminToolsNav').click();
  await page.locator('#downloadServer').waitFor();assert.equal(await page.locator('#adminToolsContent h3').count(),5);assert.equal(await page.locator('.rf-globaljob').isVisible(),false);
  await page.locator('[data-goto="backend"]').first().click();assert.equal(await page.locator('#page-backend #downloadServer').count(),0);
  await page.locator('#adminToolsNav').click();await page.locator('#backendProject').fill('example-project');await page.locator('#backendModel').fill('example-model');
  for(const id of ['downloadServer','downloadSchema','downloadPrompt','downloadPackage','downloadEnv']){
   const [file]=await Promise.all([page.waitForEvent('download'),page.locator('#'+id).click()]);
   const contents=fs.readFileSync(await file.path(),'utf8');assert.ok(contents.length>30);
   if(file.suggestedFilename()==='package.json')assert.equal(JSON.parse(contents).name,'example-project');
   if(file.suggestedFilename()==='.env.example')assert.match(contents,/OPENAI_MODEL=example-model/);
  }
  assert.equal(downloads,5);
  await page.setViewportSize({width:390,height:844});await page.locator('#patternFunctionUrl').scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Admin tools fit mobile');
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('#saveHybridSettings').click();await page.getByText('Connection updated for this session.',{exact:true}).waitFor();
  revoked=true;await page.locator('#downloadServer').click();await page.locator('#page-backend.active').waitFor();
  assert.equal(await page.locator('#patternFunctionUrl,#downloadServer').count(),0);assert.equal(await page.locator('#adminToolsNav').isVisible(),false);assert.equal(downloads,5);
  revoked=false;await page.reload();await page.locator('#adminToolsNav').waitFor({state:'visible'});
  failTools=true;await page.locator('#adminToolsNav').click();await page.getByRole('button',{name:'Retry',exact:true}).waitFor();
  assert.equal(await page.locator('#patternFunctionUrl').count(),0);
  failTools=false;await page.getByRole('button',{name:'Retry',exact:true}).click();await page.locator('#downloadServer').waitFor();
  revoked=true;await page.locator('#saveHybridSettings').click();await page.locator('#page-backend.active').waitFor();assert.equal(await page.locator('#adminToolsNav').isVisible(),false);
  revoked=false;await page.reload();await page.locator('#adminToolsNav').waitFor({state:'visible'});
  holdTools=true;await page.locator('#adminToolsNav').click();
  const deadline=Date.now()+2000;while(!held&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(held);
  await page.evaluate(()=>{window.ancalagonAuth.session=null;window.dispatchEvent(new CustomEvent('ancalagon:auth-cleared'));});held();holdTools=false;
  await page.waitForTimeout(100);assert.equal(await page.locator('#adminToolsContent').textContent(),'');assert.equal(await page.locator('#adminToolsNav').isVisible(),false);
  assert.deepEqual(errors,[]);await context.close();
  console.log('Admin tools passed: regular-user exclusion, guarded navigation, admin-only sections and downloads, role revocation, retry, stale-response clearing, and mobile layout.');
 }finally{if(browser)await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1});

import {readFile} from 'node:fs/promises';
const token=process.env.SUPABASE_ACCESS_TOKEN?.trim(),ref=process.env.SUPABASE_PROJECT_REF?.trim();
if(!token||!/^[a-z0-9]{20}$/.test(ref||''))throw Error('Configure the existing criteria-backend environment.');
const response=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{
 method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
 body:JSON.stringify({query:(await Promise.all(['20260914210000_workspace_home.sql','20260915110000_guided_tutorial.sql','20260915150000_admin_tools.sql'].map(name=>readFile('supabase/migrations/'+name,'utf8')))).join('\n')}),signal:AbortSignal.timeout(60000)});
if(!response.ok)throw Error('Workspace Home migration failed ('+response.status+'). No query result was logged.');
console.log('Personal workspace starting points, tutorial progress, and admin-only tools are ready.');

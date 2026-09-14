import {readFile} from 'node:fs/promises';
const token=process.env.SUPABASE_ACCESS_TOKEN?.trim(),ref=process.env.SUPABASE_PROJECT_REF?.trim();
if(!token||!/^[a-z0-9]{20}$/.test(ref||''))throw Error('Configure the existing criteria-backend environment.');
const response=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{
 method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
 body:JSON.stringify({query:await readFile('supabase/migrations/20260914210000_workspace_home.sql','utf8')}),signal:AbortSignal.timeout(60000)});
if(!response.ok)throw Error('Workspace Home migration failed ('+response.status+'). No query result was logged.');
console.log('Personal workspace starting points are ready.');

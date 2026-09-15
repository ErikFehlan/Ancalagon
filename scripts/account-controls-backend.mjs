import {readFile} from 'node:fs/promises';
const token=process.env.SUPABASE_ACCESS_TOKEN?.trim(),ref=process.env.SUPABASE_PROJECT_REF?.trim();
if(!token||!/^[a-z0-9]{20}$/.test(ref||''))throw Error('Configure the existing criteria-backend environment.');
const files=['20260915170000_personal_settings.sql','20260915171000_account_controls.sql'];
const response=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query:(await Promise.all(files.map(f=>readFile('supabase/migrations/'+f,'utf8')))).join('\n')}),signal:AbortSignal.timeout(60000)});
if(!response.ok)throw Error('Personal settings migration failed ('+response.status+'). No query result was logged.');
console.log('Personal settings, notifications, support, export, and durable account deletion are ready.');

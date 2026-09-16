import {readFile} from 'node:fs/promises';
const token=process.env.SUPABASE_ACCESS_TOKEN?.trim(),ref=process.env.SUPABASE_PROJECT_REF?.trim();
if(!token||!/^[a-z0-9]{20}$/.test(ref||''))throw Error('Configure the existing criteria-backend environment.');
const migrations=['20260915090000_core_intake.sql','20260916190000_review_conflicts.sql'];
const query=(await Promise.all(migrations.map(name=>readFile('supabase/migrations/'+name,'utf8')))).join('\n');
const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',
 headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
 body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});
if(!response.ok)throw Error(`Core migration failed (${response.status}). No query result was logged.`);
console.log('Durable intake, atomic review with non-retryable evidence conflicts, and document scope controls installed.');

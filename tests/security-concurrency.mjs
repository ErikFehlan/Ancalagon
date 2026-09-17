import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
function sql(query){return new Promise((resolve,reject)=>{const p=spawn('psql',['-h','localhost','-U','postgres','-d','beta_security','-v','ON_ERROR_STOP=1','-At','-c',query],{env:process.env});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('exit',code=>code?reject(Error(err)):resolve(out.trim()));});}
await sql('truncate public.ai_budget_counters;update public.security_limits set global_day=3,workspace_minute=20;');
const query="select public.reserve_ai_budget((select workspace_id from test_ids where user_id='00000000-0000-0000-0000-000000000001'),null,100,100)->>'allowed';";
const results=await Promise.all(Array.from({length:12},()=>sql(query)));
assert.equal(results.filter(v=>v==='true').length,3,'Concurrent calls exceeded the global budget');
assert.equal(await sql("select calls from public.ai_budget_counters where scope='global' and period='day'"),'3');
console.log('PASS: 12 concurrent transactions cannot consume more than 3 available AI calls.');

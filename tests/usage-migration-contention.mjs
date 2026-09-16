import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
const exec=promisify(execFile);
const args=['-X','-h','localhost','-U','postgres','-d','usage_analytics','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
const sql=async(query)=>(await exec('psql',[...args,'-Atc',query],{timeout:10000})).stdout.trim();
const before=await sql('select count(*) from public.product_usage_events');
const holder=spawn('psql',args,{stdio:['pipe','pipe','pipe']});
const closed=once(holder,'close');
try{
 await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error('Lock fixture did not start')),10000);
  holder.on('error',reject);
  holder.stdout.on('data',chunk=>{if(chunk.toString().includes('LOCK_READY')){clearTimeout(timeout);resolve();}});
  holder.stdin.write('begin; lock table public.app_events in access share mode;\n\\echo LOCK_READY\n');
 });
 await assert.rejects(exec('psql',[...args,'-f','supabase/migrations/20260916120000_accurate_usage.sql'],{timeout:5000}),error=>{
  assert.match(error.stderr,/55P03/);assert.match(error.stderr,/could not obtain lock/);return true;
 });
 // The migration acquired jobs before hitting the held app_events lock. Those
 // partial locks must be released even while the competing transaction remains.
 await sql('begin; lock table public.jobs in access exclusive mode nowait; rollback;');
 assert.equal(await sql('select count(*) from public.product_usage_events'),before);
}finally{
 holder.stdin.end('rollback;\n\\q\n');
 await closed;
}
await exec('psql',[...args,'-f','supabase/migrations/20260916120000_accurate_usage.sql'],{timeout:10000});
assert.equal(await sql('select count(*) from public.product_usage_events'),before);
console.log('Migration yields to active transactions, releases partial locks, and reruns without duplicate history.');

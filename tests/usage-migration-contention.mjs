import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
const exec=promisify(execFile);
const args=['-X','-h','localhost','-U','postgres','-d','usage_analytics','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
const sql=async(query)=>(await exec('psql',[...args,'-Atc',query],{timeout:10000})).stdout.trim();
const before=await sql('select count(*) from public.product_usage_events');
async function withLock(table,work){
 const holder=spawn('psql',args,{stdio:['pipe','pipe','pipe']});
 const closed=once(holder,'close');
 try{
  await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('Lock fixture did not start')),10000);
   holder.on('error',reject);
   holder.stdout.on('data',chunk=>{if(chunk.toString().includes('LOCK_READY')){clearTimeout(timeout);resolve();}});
   holder.stdin.write(`begin; lock table public.${table} in access share mode;\n\\echo LOCK_READY\n`);
  });
  await work();
 }finally{
  holder.stdin.end('rollback;\n\\q\n');
  await closed;
 }
}
await withLock('app_events',async()=>{
 await assert.rejects(exec('psql',[...args,'-f','supabase/migrations/20260916120000_accurate_usage.sql'],{timeout:5000}),error=>{
  assert.match(error.stderr,/55P03/);assert.match(error.stderr,/could not obtain lock/);return true;
 });
 // Even though jobs was locked first, it must be released after the abort.
 await sql('begin; lock table public.jobs in access exclusive mode nowait; rollback;');
 assert.equal(await sql('select count(*) from public.product_usage_events'),before);
});
// Ordinary reads of jobs do not need to stop for trigger installation. This
// exercises both CREATE OR REPLACE TRIGGER and the weaker upfront table lock.
await withLock('jobs',async()=>{
 await exec('psql',[...args,'-f','supabase/migrations/20260916120000_accurate_usage.sql'],{timeout:10000});
 assert.equal(await sql('select count(*) from public.product_usage_events'),before);
});
console.log('Migration coexists with job reads, yields to conflicting schema locks, and preserves history.');

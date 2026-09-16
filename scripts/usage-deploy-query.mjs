import {setTimeout as delay} from 'node:timers/promises';

// Only retry database errors that guarantee this transaction was aborted.
// Network failures and unknown errors may have committed, so fail for review.
export async function runUsageQuery(query,{token,ref,mode,fetchImpl=fetch,wait=delay,log=console.error}){
 for(let attempt=1;attempt<=5;attempt++){
  const response=await fetchImpl(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',
   headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
   body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});
  if(response.ok)return response;
  const body=await response.json().catch(()=>({}));
  const message=String(body.message||body.error||'');
  const first=message.split(/\r?\n/)[0];
  const state=first.match(/ERROR:\s*([0-9A-Z]{5}):/)?.[1]||'unknown';
  const retryable=mode==='prepare'&&['40P01','55P03'].includes(state);
  const category=['deadlock detected','could not obtain lock','lock timeout','does not exist','already exists','permission denied','not-null constraint','foreign key constraint','check constraint','ambiguous','cannot change','invalid input','syntax error','duplicate key'].find(x=>first.toLowerCase().includes(x))||'unclassified';
  const objects=[...first.matchAll(/(?:relation|column|constraint|function|sequence|index|table) "([a-z_][a-z0-9_.]*)"/gi)].map(m=>m[1]);
  log('Usage deployment diagnostic:',JSON.stringify({mode,attempt,http_status:response.status,sqlstate:state,category,objects}));
  if(!retryable||attempt===5)throw Error('Usage deployment stopped. Customer data and raw database errors were not logged.');
  await wait(1000*attempt+Math.floor(Math.random()*500));
 }
}

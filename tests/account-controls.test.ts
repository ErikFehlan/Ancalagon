import {handleAccountControls} from '../supabase/functions/account-controls/handler.ts';
import {processAccountDeletions} from '../supabase/functions/account-controls/cleanup.ts';
const assert=(value:unknown,message='Assertion failed')=>{if(!value)throw Error(message);};
Deno.test('account endpoint authenticates and rechecks password before queuing a verified user',async()=>{
 const originalFetch=globalThis.fetch,names=['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY'],previous=names.map(n=>Deno.env.get(n));let queued:any=null,passwordOK=false;
 names.forEach((n,i)=>Deno.env.set(n,['https://account.invalid','public-test','private-test'][i]));
 globalThis.fetch=async(input,init)=>{const url=String(input);if(url.endsWith('/auth/v1/user'))return Response.json({id:'user-a',email:'a@example.test'});if(url.includes('grant_type=password'))return passwordOK?Response.json({user:{id:'user-a'},access_token:'verification-token'}):Response.json({error:'invalid'}, {status:400});if(url.includes('/logout'))return new Response(null,{status:204});if(url.endsWith('/begin_account_deletion')){queued=JSON.parse(String(init?.body));return Response.json(null);}if(url.endsWith('/claim_account_deletions'))return Response.json([]);throw Error('Unexpected request '+url);};
 const request=(body:unknown,token=true)=>new Request('https://account.invalid/functions/v1/account-controls',{method:'POST',headers:{...(token?{Authorization:'Bearer test-token'}:{}),'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  assert((await handleAccountControls(request({action:'delete_account',password:'x',confirmation:'DELETE'},false))).status===401);assert(queued===null);
  assert((await handleAccountControls(request({action:'delete_account',password:'x',confirmation:'DELETE',user_id:'someone-else'}))).status===400);assert(queued===null);
  assert((await handleAccountControls(request({action:'delete_account',password:'wrong',confirmation:'DELETE'}))).status===403);assert(queued===null);
  passwordOK=true;const response=await handleAccountControls(request({action:'delete_account',password:'correct',confirmation:'DELETE'}));assert(response.status===202);assert(queued.p_user==='user-a');
  const denied=await handleAccountControls(new Request('https://account.invalid',{method:'POST',headers:{Origin:'https://foreign.invalid'}}));assert(denied.status===403);
 }finally{globalThis.fetch=originalFetch;names.forEach((n,i)=>previous[i]===undefined?Deno.env.delete(n):Deno.env.set(n,previous[i]!));}
});
Deno.test('storage cleanup must succeed before auth removal and failed cleanup remains retryable',async()=>{let storageFailure=true,removed=0,deleted=0,finished=0,remaining=true;
 const io={rpc:async(name:string)=>{if(name==='claim_account_deletions')return [{user_id:'a',lease_id:'lease'}];if(name==='account_deletion_files')return remaining?[{bucket:'resumes',name:'workspace/job/candidate/source.pdf'}]:[];if(name==='finish_account_deletion'){finished++;return null;}throw Error('Unexpected');},remove:async()=>{if(storageFailure)throw Error('Storage unavailable');remaining=false;removed++;},deleteUser:async()=>{deleted++;}};
 assert((await processAccountDeletions(io)).length===0);assert(deleted===0&&finished===0);storageFailure=false;assert((await processAccountDeletions(io))[0]==='a');assert(removed===1&&deleted===1&&finished===1);
});
Deno.test('lost auth deletion response can retry without deleting any other user',async()=>{let attempts=0,finished=0;const io={rpc:async(name:string)=>name==='claim_account_deletions'?[{user_id:'only-this-user',lease_id:'lease'}]:name==='account_deletion_files'?[]:(finished++,null),remove:async()=>{throw Error('Unexpected');},deleteUser:async(id:string)=>{assert(id==='only-this-user');if(++attempts===1)throw Error('Lost response');}};await processAccountDeletions(io);assert(finished===0);await processAccountDeletions(io);assert(finished===1);});

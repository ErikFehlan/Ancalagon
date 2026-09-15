import {accountIO,processAccountDeletions} from './cleanup.ts';
const origins=new Set(['https://erikfehlan.github.io']);
export async function handleAccountControls(request:Request){
 const origin=request.headers.get('origin')||'';
 const headers={'Content-Type':'application/json','Vary':'Origin',...(origins.has(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'}:{})};
 const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!origins.has(origin))return json({error:'Origin not allowed'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 const base=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!base||!anon||!key)return json({error:'Account controls are unavailable'},503);
 const authorization=request.headers.get('authorization')||'';
 if(!/^Bearer \S+$/i.test(authorization))return json({error:'Sign in required'},401);
 try{
  const check=await fetch(base+'/auth/v1/user',{headers:{apikey:anon,Authorization:authorization},signal:AbortSignal.timeout(15000)});
  if(!check.ok)return json({error:'Sign in again before deleting your account'},401);
  const user=await check.json();if(!user?.id||!user.email)return json({error:'Sign in required'},401);
  const raw=await request.text();if(raw.length>5000)return json({error:'Invalid request'},400);
  const body=JSON.parse(raw);
  if(body?.action!=='delete_account'||body.confirmation!=='DELETE'||typeof body.password!=='string'||!body.password||body.password.length>1024||Object.keys(body).some(k=>!['action','confirmation','password'].includes(k)))return json({error:'Confirm your password and type DELETE'},400);
  const reauth=await fetch(base+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:anon,'Content-Type':'application/json'},body:JSON.stringify({email:user.email,password:body.password}),signal:AbortSignal.timeout(15000)});
  if(!reauth.ok)return json({error:reauth.status===429?'Too many attempts. Wait before trying again.':'Your current password could not be verified'},reauth.status===429?429:403);
  const verified=await reauth.json();
  if(verified.user?.id!==user.id)return json({error:'Account verification failed'},403);
  // Revoke the short-lived verification session, without changing the caller's session.
  await fetch(base+'/auth/v1/logout?scope=local',{method:'POST',headers:{apikey:anon,Authorization:'Bearer '+verified.access_token},signal:AbortSignal.timeout(10000)});
  const enqueue=await fetch(base+'/rest/v1/rpc/begin_account_deletion',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({p_user:user.id}),signal:AbortSignal.timeout(15000)});
  if(!enqueue.ok){const error=await enqueue.json().catch(()=>({}));return json({error:error.code==='PT409'?error.message:'Deletion could not be requested. Please try again.'},error.code==='PT409'?409:503);}
  const completed=await processAccountDeletions(accountIO(base,key),user.id).catch(()=>[]);
  return json({status:completed.includes(user.id)?'complete':'pending'},completed.includes(user.id)?200:202);
 }catch{return json({error:'Account controls could not finish. Please try again.'},503);}
}

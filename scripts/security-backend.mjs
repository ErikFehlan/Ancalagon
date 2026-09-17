import {readFile} from 'node:fs/promises';
const token=process.env.SUPABASE_ACCESS_TOKEN?.trim(),ref=process.env.SUPABASE_PROJECT_REF?.trim();
if(!token||!/^[a-z0-9]{20}$/.test(ref||''))throw Error('Configure the existing deployment environment.');
async function api(path,method='GET',body){
 const r=await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error(`Security configuration failed (${r.status}) at ${path}. No credentials or account data were logged.`);
 return r.json().catch(()=>null);
}
const mode=process.argv[2]||'prepare';
if(mode==='prepare'){
 await api('/database/query','POST',{query:await readFile('supabase/migrations/20260917200000_beta_security.sql','utf8')});
 // Never overwrite unrelated Auth settings or provider secrets.
 await api('/config/auth','PATCH',{
  mailer_autoconfirm:false,mailer_allow_unverified_email_sign_ins:false,
  mailer_secure_email_change_enabled:true,password_min_length:12,
  hook_before_user_created_enabled:true,
  hook_before_user_created_uri:'pg-functions://postgres/public/before_beta_signup',
 });
 console.log('Approved beta access, email verification, identity-bound administration, storage quotas and atomic AI budgets installed. Existing accounts preserved.');
}else if(mode==='verify'){
 const config=await api('/config/auth');
 console.log('Custom confirmation-email delivery configured: '+Boolean(config.smtp_host)+'. CAPTCHA is not enabled by this closed-beta migration; signup requires prior approval.');
 if(config.mailer_autoconfirm!==false||config.hook_before_user_created_enabled!==true||config.hook_before_user_created_uri!=='pg-functions://postgres/public/before_beta_signup')throw Error('Required signup safeguards are not active.');
 const rows=await api('/database/query','POST',{query:`select
  not has_function_privilege('authenticated','public.reserve_ai_budget(uuid,uuid,integer,integer)','execute') as budget_private,
  not has_table_privilege('authenticated','public.beta_access','update') as approval_private,
  exists(select from pg_trigger where tgname='enforce_beta_signup' and tgenabled<>'D') as signup_gate,
  exists(select from pg_trigger where tgname='resume_storage_budget' and tgenabled<>'D') as storage_gate;`});
 if(!rows?.[0]||Object.values(rows[0]).some(v=>v!==true))throw Error('Security permission verification failed.');
 console.log('PASS: live Auth verification, private budget permissions, approval gate and storage enforcement.');
}else throw Error('Use prepare or verify');

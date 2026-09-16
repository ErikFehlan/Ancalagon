const token=process.env.SUPABASE_ACCESS_TOKEN?.trim(),ref=process.env.SUPABASE_PROJECT_REF?.trim();
if(!token||!/^[a-z0-9]{20}$/.test(ref||''))throw Error('Missing deployment environment');
const kr=await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`,{headers:{Authorization:`Bearer ${token}`}});if(!kr.ok)throw Error('Credential access failed');
const keys=await kr.json(),service=keys.find(x=>x.name==='service_role')?.api_key;if(!service)throw Error('Missing service credential');
async function req(path,method='GET',body){const r=await fetch(`https://${ref}.supabase.co`+path,{method,headers:{apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});return {ok:r.ok,status:r.status,body:await r.json().catch(()=>null)};}
for(const id of ["810ad8af-b404-4849-a23b-31f5ac4a7be6"]){
const u=await req('/auth/v1/admin/users/'+id);if(u.status===404){console.log('Disposable fixture already removed.');continue;}
if(!u.ok||!/^ancalagon-core-test-[0-9a-f-]+@example.invalid$/.test(u.body?.email||'')||u.body?.user_metadata?.display_name!=='Disposable core test'||!(u.body.created_at>='2026-09-16T14:32:00Z'&&u.body.created_at<'2026-09-16T14:35:00Z'))throw Error('Fixture identity guard failed');
const m=await req('/rest/v1/workspace_members?select=workspace_id&user_id=eq.'+id);if(!m.ok)throw Error('Fixture membership lookup failed');
for(const row of m.body){
const w=row.workspace_id;if(!/^[0-9a-f-]{36}$/.test(w))throw Error('Invalid fixture workspace');
const members=await req('/rest/v1/workspace_members?select=user_id&workspace_id=eq.'+w);if(!members.ok||members.body.some(x=>x.user_id!==id))throw Error('Fixture workspace is shared; cleanup stopped');
const sql=`select name from storage.objects where bucket_id='resumes' and name like '${w}/%';`;
const q=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql,read_only:true}),signal:AbortSignal.timeout(20000)});
if(!q.ok)throw Error('Fixture document lookup failed');
const paths=(await q.json()).map(x=>x.name);if(paths.some(x=>!x.endsWith('/synthetic.txt')))throw Error('Unexpected document in disposable fixture');
if(paths.length){const s=await req('/storage/v1/object/resumes','DELETE',{prefixes:paths});console.log('Disposable document cleanup:',s.status);if(!s.ok)throw Error('Disposable storage cleanup failed');}
}
const d=await req('/auth/v1/admin/users/'+id,'DELETE');
console.log('Disposable account cleanup:',JSON.stringify({status:d.status,code:typeof d.body?.code==='string'&&/^[a-z_]{1,60}$/.test(d.body.code)?d.body.code:null}));
if(!d.ok)throw Error('Disposable account deletion failed');
}

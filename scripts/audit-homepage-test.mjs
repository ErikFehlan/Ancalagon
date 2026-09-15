// Read-only inspection of the exact disposable homepage test account.
const token=process.env.SUPABASE_ACCESS_TOKEN?.trim(),ref=process.env.SUPABASE_PROJECT_REF?.trim();
if(!token||!/^[a-z0-9]{20}$/.test(ref||''))throw Error('Existing deployment environment required.');
const query=`with target as (select id from auth.users where email='demo@example.com' and raw_user_meta_data->>'display_name'='Demo Recruiter' and created_at>='2026-09-15T21:29:17Z'::timestamptz and created_at<='2026-09-15T21:29:22Z'::timestamptz), owned as (select id from public.workspaces where owner_id in(select id from target))
select (select count(*)::int from target) as matched_accounts,
(select count(*)::int from owned) as private_workspaces,
(select count(*)::int from public.workspace_members where workspace_id in(select id from owned) and user_id not in(select id from target)) as other_members,
(select count(*)::int from public.workspace_members where user_id in(select id from target) and workspace_id not in(select id from owned)) as other_memberships,
(select count(*)::int from public.jobs where workspace_id in(select id from owned)) as jobs,
(select count(*)::int from public.candidates where workspace_id in(select id from owned)) as candidates,
(select count(*)::int from public.support_requests where user_id in(select id from target)) as support_requests,
(select count(*)::int from storage.objects where coalesce(owner_id,owner::text) in(select id::text from target) or split_part(name,'/',1) in(select id::text from owned)) as stored_files`;
const r=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(20000)});
if(!r.ok)throw Error('Read-only verification failed ('+r.status+').');
const rows=await r.json();console.log('Disposable homepage account audit: '+JSON.stringify(rows[0]));

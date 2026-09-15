\set ON_ERROR_STOP on
do $$begin
 if not exists(select from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select from pg_roles where rolname='authenticated') then create role authenticated;end if;
end$$;
create schema auth;
create table auth.users(id uuid primary key,email text,created_at timestamptz,last_sign_in_at timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select current_setting('test.claims',true)::jsonb$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
create table public.workspaces(id uuid primary key);
create table public.jobs(id uuid primary key,workspace_id uuid references public.workspaces);
create function public.is_workspace_member(w uuid) returns boolean language sql stable as $$select true$$;
grant usage on schema auth to authenticated;
grant execute on function auth.jwt(),auth.uid() to authenticated;
\ir ../supabase/migrations/20260910160000_admin_usage_analytics.sql
\ir ../supabase/migrations/20260915150000_admin_tools.sql
\ir ../supabase/migrations/20260915150000_admin_tools.sql
set role authenticated;
set test.claims='{"sub":"00000000-0000-0000-0000-000000000002","email":"recruiter@example.test","role":"authenticated","user_metadata":{"admin":true,"role":"admin"}}';
do $$begin
 begin perform public.get_admin_tools();raise exception 'Regular account loaded technical content';exception when insufficient_privilege then null;end;
 begin perform public.get_admin_starter_file('server');raise exception 'Regular account downloaded a starter';exception when insufficient_privilege then null;end;
 begin perform public.get_admin_starter_file('../../migration');raise exception 'Authorization did not run first';exception when insufficient_privilege then null;end;
 begin perform body from public.admin_tool_resources;raise exception 'Direct resource read allowed';exception when insufficient_privilege then null;end;
 begin insert into public.admin_tool_resources values('injected','<script>bad</script>');raise exception 'Direct resource write allowed';exception when insufficient_privilege then null;end;
end$$;
set test.claims='{"sub":"00000000-0000-0000-0000-000000000001","email":"efehlan@gmail.com","role":"authenticated"}';
do $$declare panel text;file text;result jsonb;begin
 panel:=public.get_admin_tools()->>'html';
 if panel not like '%1. Hybrid Engine Connection%' or panel not like '%2. Starter Files%' or panel not like '%3. What the backend will do%' or panel not like '%4. MCP Tools%' or panel not like '%5. Deployment Checklist%' then raise exception 'Admin sections missing';end if;
 foreach file in array array['server','schema','prompt','pkg','env'] loop
  result:=public.get_admin_starter_file(file,'example-model','example-project');
  if length(result->>'content')<30 or result->>'name' is null then raise exception 'Missing starter %',file;end if;
 end loop;
 if (public.get_admin_starter_file('pkg','example-model','example-project')->>'content')::jsonb->>'name'<>'example-project' then raise exception 'Project substitution failed';end if;
 if public.get_admin_starter_file('env','example-model')->>'content' not like '%OPENAI_MODEL=example-model%' then raise exception 'Model substitution failed';end if;
 begin perform public.get_admin_starter_file('../server');raise exception 'Path traversal accepted';exception when invalid_parameter_value then null;end;
 begin perform public.get_admin_starter_file('server',E'model\nINJECT=bad');raise exception 'Model injection accepted';exception when invalid_parameter_value then null;end;
 begin perform public.get_admin_starter_file('pkg','example-model','../../bad');raise exception 'Project injection accepted';exception when invalid_parameter_value then null;end;
end$$;
set test.claims='{"email":"efehlan@gmail.com"}';
do $$begin
 begin perform public.get_admin_tools();raise exception 'Missing identity accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
delete from public.app_admins where email='efehlan@gmail.com';
set role authenticated;
set test.claims='{"sub":"00000000-0000-0000-0000-000000000001","email":"efehlan@gmail.com","role":"authenticated"}';
do $$begin
 begin perform public.get_admin_tools();raise exception 'Revoked administrator retained access';exception when insufficient_privilege then null;end;
 begin perform public.get_admin_starter_file('server');raise exception 'Revoked administrator downloaded a file';exception when insufficient_privilege then null;end;
end$$;
reset role;
do $$begin
 if has_function_privilege('anon','public.get_admin_tools()','EXECUTE') or has_function_privilege('anon','public.get_admin_starter_file(text,text,text)','EXECUTE') then raise exception 'Anonymous RPC permission';end if;
 if has_table_privilege('authenticated','public.admin_tool_resources','SELECT') or has_table_privilege('anon','public.admin_tool_resources','SELECT') then raise exception 'Direct resource permission';end if;
end$$;
select 'Admin tools: role checks, protected downloads, direct-access denial, revocation, and input validation passed' as result;

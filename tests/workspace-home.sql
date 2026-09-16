\set ON_ERROR_STOP on
-- Minimal isolated roles and membership fixture; production policies run unchanged.
do $$begin
 if not exists(select from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select from pg_roles where rolname='authenticated') then create role authenticated;end if;
end$$;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select current_setting('test.actor')::uuid$$;
create table public.workspaces(id uuid primary key);
create function public.is_workspace_member(w uuid) returns boolean language sql stable as $$select w::text=current_setting('test.workspace')$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
\ir ../supabase/migrations/20260914210000_workspace_home.sql
-- Reapplying on the next deployment is safe.
\ir ../supabase/migrations/20260914210000_workspace_home.sql
\ir ../supabase/migrations/20260915110000_guided_tutorial.sql
\ir ../supabase/migrations/20260915110000_guided_tutorial.sql
\ir ../supabase/migrations/20260916180000_contextual_guidance.sql
\ir ../supabase/migrations/20260916180000_contextual_guidance.sql
insert into auth.users values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into workspaces values('00000000-0000-0000-0000-000000000011'),('00000000-0000-0000-0000-000000000012');
set role authenticated;
set test.actor='00000000-0000-0000-0000-000000000001';set test.workspace='00000000-0000-0000-0000-000000000011';
insert into workspace_home(user_id,workspace_id,last_page) values(auth.uid(),current_setting('test.workspace')::uuid,'candidates');
update workspace_home set last_page='detail',last_candidate_id='00000000-0000-0000-0000-000000000021' where user_id=auth.uid();
update workspace_home set tutorial_progress='{"version":1,"step":3}',tutorial_revision=1 where user_id=auth.uid();
select public.update_contextual_guidance(current_setting('test.workspace')::uuid,'dismiss','assessment');
select public.update_contextual_guidance(current_setting('test.workspace')::uuid,'complete','feedback');
select public.update_contextual_guidance(current_setting('test.workspace')::uuid,'disable');
select public.update_contextual_guidance(current_setting('test.workspace')::uuid,'complete','assessment');
do $$begin
 if(select guidance_state from workspace_home)<>'{"enabled":false,"tips":{"assessment":"dismissed","feedback":"completed"}}'::jsonb then raise exception 'Guidance actions overwrote independent state';end if;
 begin
  perform public.update_contextual_guidance('00000000-0000-0000-0000-000000000012','reset');
  raise exception 'Changed foreign workspace guidance';
 exception when insufficient_privilege then null;end;
 begin
  perform public.update_contextual_guidance(current_setting('test.workspace')::uuid,'dismiss','unknown');
  raise exception 'Accepted unknown tip';
 exception when invalid_parameter_value then null;end;
 begin
  perform public.update_contextual_guidance(current_setting('test.workspace')::uuid,'unknown');
  raise exception 'Accepted unknown action';
 exception when invalid_parameter_value then null;end;
 if(select tutorial_progress->>'step' from workspace_home)<>'3' then raise exception 'Tutorial progress did not save';end if;
 if(select last_page from workspace_home)<>'detail' then raise exception 'Tutorial overwrote real bookmark';end if;
 if(select count(*) from workspace_home)<>1 then raise exception 'Own bookmark missing';end if;
 begin
  insert into workspace_home(user_id,workspace_id) values('00000000-0000-0000-0000-000000000002',current_setting('test.workspace')::uuid);
  raise exception 'Wrote another user bookmark';
 exception when insufficient_privilege then null;end;
 begin
  insert into workspace_home(user_id,workspace_id) values(auth.uid(),'00000000-0000-0000-0000-000000000012');
  raise exception 'Wrote a foreign workspace bookmark';
 exception when insufficient_privilege then null;end;
 begin
  update workspace_home set tutorial_progress='[]';
  raise exception 'Non-object tutorial allowed';
 exception when check_violation then null;end;
 begin
  update workspace_home set tutorial_progress=jsonb_build_object('draft',repeat('x',33000));
  raise exception 'Oversized tutorial allowed';
 exception when check_violation then null;end;
 begin
  update workspace_home set last_page='javascript:alert(1)';
  raise exception 'Invalid destination allowed';
 exception when check_violation then null;end;
end$$;
select public.update_contextual_guidance(current_setting('test.workspace')::uuid,'enable');
do $$begin
 if(select guidance_state#>>'{tips,assessment}' from workspace_home)<>'dismissed' then raise exception 'Enabling guidance reset dismissals';end if;
end$$;
set test.actor='00000000-0000-0000-0000-000000000002';
do $$begin
 if exists(select from workspace_home) then raise exception 'Another user in the same workspace can see the bookmark';end if;
 update workspace_home set tutorial_progress='{"version":1,"step":1}';if found then raise exception 'Changed another user tutorial';end if;
 update workspace_home set last_page='pipeline';if found then raise exception 'Changed another user bookmark';end if;
end$$;
select public.update_contextual_guidance(current_setting('test.workspace')::uuid,'reset');
do $$begin
 if(select guidance_state from workspace_home)<>'{"enabled":true,"tips":{}}'::jsonb then raise exception 'New user inherited guidance';end if;
end$$;
reset role;
do $$begin
 if(select guidance_state#>>'{tips,assessment}' from workspace_home where user_id='00000000-0000-0000-0000-000000000001')<>'dismissed' then raise exception 'Another user reset guidance';end if;
 if has_function_privilege('anon','public.update_contextual_guidance(uuid,text,text)','EXECUTE') then raise exception 'Anonymous guidance action';end if;
 if has_table_privilege('anon','public.workspace_home','SELECT') then raise exception 'Anonymous access';end if;
 if(select last_page from workspace_home where user_id='00000000-0000-0000-0000-000000000001')<>'detail' then raise exception 'Bookmark changed';end if;
end$$;
select 'Home and tutorial permissions passed' as result;

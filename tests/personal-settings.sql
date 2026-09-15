\set ON_ERROR_STOP on
do $$begin
 if not exists(select from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;
end$$;
create schema auth;create schema storage;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',created_at timestamptz default now(),last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('sub',auth.uid(),'email',current_setting('test.email',true))$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text);
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
grant usage on schema auth,storage to authenticated,service_role;
grant execute on function auth.uid(),auth.jwt(),storage.foldername(text) to authenticated,service_role;
\ir ../supabase/migrations/20260909160000_multi_user_foundation.sql
\ir ../supabase/migrations/20260910160000_admin_usage_analytics.sql
\ir ../supabase/migrations/20260914210000_workspace_home.sql
\ir ../supabase/migrations/20260915110000_guided_tutorial.sql
-- Task fixtures expose the exact fields used by notification triggers. Their
-- processing/approval semantics have separate full production migration tests.
create table public.job_criteria_tasks(workspace_id uuid references workspaces(id) on delete cascade,job_id uuid references jobs(id) on delete cascade,revision text,status text);
create table public.job_reassessment_tasks(workspace_id uuid references workspaces(id) on delete cascade,job_id uuid references jobs(id) on delete cascade,candidate_id uuid references candidates(id) on delete cascade,revision text,status text);
create table public.resume_intake_tasks(workspace_id uuid references workspaces(id) on delete cascade,job_id uuid references jobs(id) on delete cascade,candidate_id uuid references candidates(id) on delete cascade,revision text,status text);
\ir ../supabase/migrations/20260915170000_personal_settings.sql
\ir ../supabase/migrations/20260915171000_account_controls.sql
\ir ../supabase/migrations/20260915170000_personal_settings.sql
\ir ../supabase/migrations/20260915171000_account_controls.sql
insert into auth.users(id,email) values('00000000-0000-0000-0000-000000000001','a@example.test'),('00000000-0000-0000-0000-000000000002','b@example.test');
-- Capture the private workspaces created by the real account trigger.
create temp table ids as select owner_id as user_id,id as workspace_id from workspaces;
insert into jobs(id,workspace_id,title) select case when user_id='00000000-0000-0000-0000-000000000001' then '00000000-0000-0000-0000-000000000021'::uuid else '00000000-0000-0000-0000-000000000022'::uuid end,workspace_id,'Synthetic job' from ids;
insert into candidates(id,workspace_id,job_id,name) select '00000000-0000-0000-0000-000000000031',workspace_id,id,'Synthetic A' from jobs where id='00000000-0000-0000-0000-000000000021';
set test.actor='00000000-0000-0000-0000-000000000001';set test.email='a@example.test';set role authenticated;
select get_user_settings();
select save_user_settings('{"display_name":"Recruiter A","company":"Example","time_zone":"America/New_York","candidate_sort":"name","text_size":"larger","start_page":"jobs","show_closed":true}',0);
do $$declare exported jsonb;begin
 if (get_user_settings()->>'revision')::integer<>1 then raise exception 'Settings revision failed';end if;
 begin perform save_user_settings('{"company":"Stale tab"}',0);raise exception 'Stale save accepted';exception when sqlstate 'PT409' then null;end;
 begin perform save_user_settings('{"user_id":"00000000-0000-0000-0000-000000000002"}',1);raise exception 'Identity override accepted';exception when invalid_parameter_value then null;end;
 begin perform save_user_settings('{"start_page":"admin-tools"}',1);raise exception 'Admin navigation default accepted';exception when check_violation then null;end;
 begin perform save_user_settings('{"time_zone":"Invalid/Zone"}',1);raise exception 'Invalid timezone accepted';exception when invalid_parameter_value then null;end;
 begin update user_settings set display_name='forged';raise exception 'Direct write accepted';exception when insufficient_privilege then null;end;
 exported:=get_account_export();if jsonb_array_length(exported->'workspaces')<>1 or jsonb_array_length(exported->'jobs')<>1 then raise exception 'Export crossed workspaces';end if;
 if exported->'account'->>'email'<>'a@example.test' then raise exception 'Wrong export identity';end if;
 begin perform begin_account_deletion(auth.uid());raise exception 'Client invoked service deletion';exception when insufficient_privilege then null;end;
 perform submit_support_request('00000000-0000-0000-0000-000000000041','Example issue','A synthetic problem for validation.');
 begin perform get_admin_support_requests();raise exception 'Member read support inbox';exception when insufficient_privilege then null;end;
end$$;
reset role;
insert into resume_intake_tasks select workspace_id,id,'00000000-0000-0000-0000-000000000031','rev-a','queued' from jobs where id='00000000-0000-0000-0000-000000000021';
update resume_intake_tasks set status='ready';update resume_intake_tasks set status='ready';
set role authenticated;
do $$begin if(select count(*) from user_notifications)<>1 then raise exception 'Notification dedup failed';end if;perform mark_notifications_read(array(select id from user_notifications));if exists(select from user_notifications where read_at is null)then raise exception 'Read state failed';end if;end$$;
select save_user_settings('{"notify_uploads":false}',1);
reset role;update resume_intake_tasks set revision='rev-b',status='failed';
set role authenticated;
do $$begin if(select count(*) from user_notifications)<>1 then raise exception 'Muted notification inserted';end if;end$$;
set test.actor='00000000-0000-0000-0000-000000000002';set test.email='b@example.test';
do $$begin if exists(select from user_settings) or exists(select from user_notifications) or exists(select from support_requests) then raise exception 'Private data exposed to second account';end if;end$$;
reset role;
insert into app_admins(email) values('b@example.test');
set role authenticated;
do $$begin if jsonb_array_length(get_admin_support_requests())<>1 then raise exception 'Admin inbox unavailable';end if;perform review_support_request('00000000-0000-0000-0000-000000000041','resolved');end$$;
reset role;
-- Shared workspace guard runs before marking or removing anything.
insert into workspace_members(workspace_id,user_id) select workspace_id,'00000000-0000-0000-0000-000000000002' from ids where user_id='00000000-0000-0000-0000-000000000001';
do $$begin begin perform begin_account_deletion('00000000-0000-0000-0000-000000000001');raise exception 'Shared workspace deletion accepted';exception when sqlstate 'PT409' then null;end;if exists(select from account_deletions) then raise exception 'Failed request left destructive work';end if;end$$;
delete from workspace_members where user_id='00000000-0000-0000-0000-000000000002' and workspace_id=(select workspace_id from ids where user_id='00000000-0000-0000-0000-000000000001');
insert into storage.objects(bucket_id,name,owner_id) select 'resumes',workspace_id||'/job/candidate/source.pdf',user_id::text from ids;
select begin_account_deletion('00000000-0000-0000-0000-000000000001');
select begin_account_deletion('00000000-0000-0000-0000-000000000001');
do $$declare task record;files jsonb;begin
 if(select count(*) from account_deletions)<>1 then raise exception 'Duplicate deletion request';end if;
 select * into task from claim_account_deletions();if task.user_id<>'00000000-0000-0000-0000-000000000001' then raise exception 'Wrong deletion identity';end if;
 files:=account_deletion_files(task.user_id,task.lease_id);if jsonb_array_length(files)<>1 then raise exception 'Deletion files crossed workspace';end if;
 if exists(select from claim_account_deletions()) then raise exception 'Double claimed deletion';end if;
 begin insert into workspace_members(workspace_id,user_id) select workspace_id,'00000000-0000-0000-0000-000000000002' from ids where user_id=task.user_id;raise exception 'Added a member during deletion';exception when insufficient_privilege then null;end;
 begin perform finish_account_deletion(task.user_id,task.lease_id);raise exception 'Finished before deleting auth account';exception when raise_exception then if sqlerrm<>'Account still exists' then raise;end if;end;
end$$;
set test.actor='00000000-0000-0000-0000-000000000001';set role authenticated;
-- Verify the predicate using the public export instead of a private queue read.
do $$begin if jsonb_array_length(get_account_export()->'jobs')<>0 then raise exception 'Pending account exported locked records';end if;end$$;
reset role;
delete from auth.users where id='00000000-0000-0000-0000-000000000001';
select finish_account_deletion(user_id,lease_id) from account_deletions;
do $$begin if exists(select from account_deletions) then raise exception 'Deletion queue retained completed account';end if;if(select count(*) from auth.users)<>1 or(select count(*) from jobs)<>1 then raise exception 'Deletion crossed account boundary';end if;if has_function_privilege('anon','public.get_account_export()','EXECUTE') or has_table_privilege('authenticated','public.account_deletions','SELECT') then raise exception 'Account control privileges leaked';end if;end$$;
select 'Personal settings, notifications, support, export, and deletion isolation passed' as result;

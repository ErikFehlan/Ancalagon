begin;
-- Requests survive partial Storage/Auth failures and are retried by the existing worker.
create table if not exists public.account_deletions (
 user_id uuid primary key,workspace_ids uuid[] not null,requested_at timestamptz not null default now(),
 lease_id uuid,lease_until timestamptz,attempts integer not null default 0,last_attempt_at timestamptz
);
alter table public.account_deletions enable row level security;
revoke all on public.account_deletions from public,anon,authenticated;
grant all on public.account_deletions to service_role;

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select from public.workspace_members m where m.workspace_id=target_workspace_id and m.user_id=auth.uid())
 and not exists(select from public.account_deletions d where d.user_id=auth.uid() or target_workspace_id=any(d.workspace_ids));
$$;
create or replace function public.can_manage_workspace(target_workspace_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public.is_workspace_member(target_workspace_id) and exists(select from public.workspace_members m
 where m.workspace_id=target_workspace_id and m.user_id=auth.uid() and m.role in ('owner','admin'));
$$;
-- Serialize ownership/membership changes with the deletion snapshot. This also
-- prevents a shared workspace from being added after its owner confirms deletion.
create or replace function public.guard_deleting_workspace() returns trigger
language plpgsql security definer set search_path='' as $$
declare w uuid;u uuid;
begin
 if tg_table_name='workspace_members' then
  w:=new.workspace_id;u:=new.user_id;
  perform 1 from public.workspaces where id=w for update;
 else w:=new.id;u:=new.owner_id;end if;
 if exists(select from public.account_deletions where user_id=u or w=any(workspace_ids)) then raise exception 'Account deletion is in progress' using errcode='42501';end if;
 return new;
end$$;
drop trigger if exists prevent_deleting_membership on public.workspace_members;
create trigger prevent_deleting_membership before insert or update on public.workspace_members for each row execute function public.guard_deleting_workspace();
drop trigger if exists prevent_deleting_workspace on public.workspaces;
create trigger prevent_deleting_workspace before insert or update on public.workspaces for each row execute function public.guard_deleting_workspace();

-- Only the authenticated account endpoint can enqueue this, after checking the
-- user's actual password. No browser can submit a user ID or call this function.
create or replace function public.begin_account_deletion(p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare ids uuid[];
begin
 perform 1 from auth.users where id=p_user for update;
 if not found then raise exception 'Account unavailable' using errcode='42501';end if;
 if exists(select from public.account_deletions where user_id=p_user) then return;end if;
 perform 1 from public.workspaces where owner_id=p_user order by id for update;
 select coalesce(array_agg(id),'{}'::uuid[]) into ids from public.workspaces where owner_id=p_user;
 if exists(select from public.workspace_members where workspace_id=any(ids) and user_id<>p_user) then
  raise exception 'Your account owns a shared workspace. Resolve its ownership with the administrator before deleting your account.' using errcode='PT409';end if;
 -- Do not remove another workspace's files, even when this account uploaded them.
 if exists(select from storage.objects where coalesce(owner_id,owner::text)=p_user::text
   and not(bucket_id='resumes' and split_part(name,'/',1)=any(ids::text[]))) then
  raise exception 'Your account owns files outside a private workspace. Contact the administrator before deleting your account.' using errcode='PT409';end if;
 insert into public.account_deletions(user_id,workspace_ids) values(p_user,ids);
end$$;
create or replace function public.claim_account_deletions(p_user uuid default null) returns setof public.account_deletions
language sql security definer set search_path='' as $$
 update public.account_deletions d set lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes',attempts=attempts+1,last_attempt_at=now()
 where user_id in(select user_id from public.account_deletions where (p_user is null or user_id=p_user)
 and (lease_until is null or lease_until<now()) order by requested_at for update skip locked limit 3) returning d.*;
$$;
create or replace function public.account_deletion_files(p_user uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ids uuid[];files jsonb;
begin
 select workspace_ids into ids from public.account_deletions where user_id=p_user and lease_id=p_lease and lease_until>now();
 if ids is null then raise exception 'Deletion lease expired' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('bucket',o.bucket_id,'name',o.name)),'[]') into files
 from (select bucket_id,name from storage.objects where bucket_id='resumes' and split_part(name,'/',1)=any(ids::text[]) order by name limit 500) o;
 return files;
end$$;
create or replace function public.finish_account_deletion(p_user uuid,p_lease uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if exists(select from auth.users where id=p_user) then raise exception 'Account still exists';end if;
 delete from public.account_deletions where user_id=p_user and lease_id=p_lease;
end$$;

create or replace function public.get_account_deletion_status() returns boolean
language sql security definer set search_path='' as $$select exists(select from public.account_deletions where user_id=auth.uid());$$;
create or replace function public.get_account_export() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ids uuid[];result jsonb;t text;rows jsonb;
begin
 if auth.uid() is null or not exists(select from auth.users where id=auth.uid()) then raise exception 'Sign in required' using errcode='42501';end if;
 select coalesce(array_agg(id),'{}'::uuid[]) into ids from public.workspaces where public.is_workspace_member(id);
 result:=jsonb_build_object('format','ancalagon-account-export','version',1,'exported_at',now(),
  'account',(select jsonb_build_object('id',id,'email',email,'created_at',created_at) from auth.users where id=auth.uid()),
  'profile',(select to_jsonb(p) from public.profiles p where id=auth.uid()),
  'settings',(select to_jsonb(s) from public.user_settings s where user_id=auth.uid()),
  'workspaces',coalesce((select jsonb_agg(to_jsonb(w)) from public.workspaces w where id=any(ids)),'[]'),
  'personal_home',coalesce((select jsonb_agg(to_jsonb(h)) from public.workspace_home h where user_id=auth.uid() and workspace_id=any(ids)),'[]'),
  'notifications',coalesce((select jsonb_agg(to_jsonb(n)) from public.user_notifications n where user_id=auth.uid() and workspace_id=any(ids)),'[]'),
  'support_requests',coalesce((select jsonb_agg(to_jsonb(r)) from public.support_requests r where user_id=auth.uid()),'[]'),
  'usage_events',coalesce((select jsonb_agg(to_jsonb(e)) from public.ai_usage_events e where user_id=auth.uid() and workspace_id=any(ids)),'[]'),
  'activity_events',coalesce((select jsonb_agg(to_jsonb(e)) from public.app_events e where user_id=auth.uid() and workspace_id=any(ids)),'[]'));
 foreach t in array array['jobs','candidates','candidate_documents','candidate_assessments','candidate_benchmarks','manager_feedback','interview_outcomes','screening_insights','job_criteria_tasks','job_reassessment_tasks','resume_intake_tasks'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) from public.%I r where workspace_id=any($1)',t) into rows using ids;
  result:=result||jsonb_build_object(case when t='candidate_documents' then 'documents' else t end,rows);
 end loop;
 return result;
end$$;
create or replace function public.get_personal_usage() returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object(
 'jobs',(select count(*) from public.jobs where created_by=auth.uid() and created_at>now()-interval '30 days' and public.is_workspace_member(workspace_id)),
 'candidates',(select count(*) from public.candidates where created_by=auth.uid() and created_at>now()-interval '30 days' and public.is_workspace_member(workspace_id)),
 'ai_completed',(select count(*) from public.ai_usage_events where user_id=auth.uid() and status='succeeded' and created_at>now()-interval '30 days' and public.is_workspace_member(workspace_id)));
$$;
do $$declare f text;begin
 foreach f in array array['begin_account_deletion(uuid)','claim_account_deletions(uuid)','account_deletion_files(uuid,uuid)','finish_account_deletion(uuid,uuid)'] loop
  execute 'revoke all on function public.'||f||' from public,anon,authenticated';execute 'grant execute on function public.'||f||' to service_role';
 end loop;
 foreach f in array array['get_account_deletion_status()','get_account_export()','get_personal_usage()'] loop
  execute 'revoke all on function public.'||f||' from public,anon';execute 'grant execute on function public.'||f||' to authenticated';
 end loop;
end$$;
revoke all on function public.guard_deleting_workspace() from public,anon,authenticated;
commit;

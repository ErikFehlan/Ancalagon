-- Closed beta access and resource budgets. Re-running never restores revoked access.
begin;
update storage.buckets set public=false,file_size_limit=10485760 where id='resumes';
create table if not exists public.beta_access (
 email text primary key check (email=lower(trim(email))),
 user_id uuid unique references auth.users(id) on delete set null,
 approved boolean not null default true,
 approved_by uuid references auth.users(id) on delete set null,
 updated_at timestamptz not null default now()
);
create table if not exists public.security_installations (name text primary key);
create table if not exists public.security_limits (
 id boolean primary key default true check(id),
 ai_paused boolean not null default false,
 workspace_minute integer not null default 20 check(workspace_minute between 1 and 100),
 workspace_day integer not null default 200 check(workspace_day between 1 and 2000),
 global_day integer not null default 1000 check(global_day between 1 and 10000),
 global_month integer not null default 10000 check(global_month between 1 and 100000),
 global_input_bytes_day bigint not null default 20000000 check(global_input_bytes_day between 1 and 100000000),
 global_output_tokens_day bigint not null default 2000000 check(global_output_tokens_day between 1 and 10000000)
);
insert into public.security_limits(id) values(true) on conflict do nothing;
create table if not exists public.ai_budget_counters (
 scope text not null, period text not null, window_start timestamptz not null,
 calls bigint not null default 0, input_bytes bigint not null default 0, output_tokens bigint not null default 0,
 primary key(scope,period,window_start)
);
alter table public.beta_access enable row level security;
alter table public.security_installations enable row level security;
alter table public.security_limits enable row level security;
alter table public.ai_budget_counters enable row level security;
revoke all on public.beta_access,public.security_installations,public.security_limits,public.ai_budget_counters from public,anon,authenticated;
grant all on public.beta_access,public.security_limits,public.ai_budget_counters to service_role;

-- Preserve accounts present at first installation, without treating future accounts
-- or a client-supplied email/metadata claim as approved.
do $$begin
 if not exists(select from public.security_installations where name='beta-security-v1') then
  insert into public.beta_access(email,user_id)
   select lower(trim(email)),id from auth.users where email is not null on conflict do nothing;
  insert into public.security_installations values('beta-security-v1');
 end if;
end$$;

-- Bind app administrators to the existing Auth identity, not an email in a JWT.
alter table public.app_admins add column if not exists user_id uuid references auth.users(id) on delete cascade;
update public.app_admins a set user_id=u.id from auth.users u where a.user_id is null and a.email=lower(u.email);
revoke all on public.app_admins from anon,authenticated;
create or replace function public.has_beta_access(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select from public.beta_access b join auth.users u on u.id=b.user_id
 where b.user_id=p_user and b.approved and u.email_confirmed_at is not null
 and (u.banned_until is null or u.banned_until<=now())
 and not exists(select from public.account_deletions d where d.user_id=u.id));
$$;
create or replace function public.is_app_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select public.has_beta_access(auth.uid()) and exists(select from public.app_admins where user_id=auth.uid());
$$;
create or replace function public.is_workspace_member(target_workspace_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.has_beta_access(auth.uid()) and exists(select from public.workspace_members
 where workspace_id=target_workspace_id and user_id=auth.uid())
 and not exists(select from public.account_deletions where target_workspace_id=any(workspace_ids));
$$;
create or replace function public.can_manage_workspace(target_workspace_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.is_workspace_member(target_workspace_id) and exists(select from public.workspace_members
 where workspace_id=target_workspace_id and user_id=auth.uid() and role in ('owner','admin'));
$$;

create or replace function public.before_beta_signup(event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select from public.beta_access where email=lower(trim(event#>>'{user,email}')) and approved and user_id is null) then
  return '{"error":{"http_code":403,"message":"Beta access requires approval for this email address."}}'::jsonb;
 end if;
 return '{}'::jsonb;
end$$;
-- This database gate also covers alternate Auth routes and remains effective if
-- the optional before-signup Auth hook is accidentally disabled.
create or replace function public.enforce_beta_signup() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.beta_access set user_id=new.id,updated_at=now()
 where email=lower(trim(new.email)) and approved and user_id is null;
 if not found then raise exception 'Beta access requires approval' using errcode='42501';end if;
 return new;
end$$;
-- AFTER INSERT is necessary for the user_id foreign key. Any rejection rolls
-- back account creation and its private workspace in the same transaction.
drop trigger if exists enforce_beta_signup on auth.users;
create trigger enforce_beta_signup after insert on auth.users for each row execute function public.enforce_beta_signup();

create or replace function public.manage_beta_access(p_email text,p_approved boolean) returns void
language plpgsql security definer set search_path='' as $$
declare target uuid;clean text:=lower(trim(p_email));
begin
 if not public.is_app_admin() then raise exception 'Admin access required' using errcode='42501';end if;
 if clean is null or length(clean)>254 or clean!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_approved is null then
  raise exception 'Enter a valid email address' using errcode='22023';end if;
 select id into target from auth.users where lower(email)=clean;
 if target=auth.uid() and not p_approved then raise exception 'You cannot revoke your own administrator access' using errcode='22023';end if;
 insert into public.beta_access(email,user_id,approved,approved_by) values(clean,target,p_approved,auth.uid())
 on conflict(email) do update set approved=excluded.approved,approved_by=auth.uid(),updated_at=now();
end$$;
create or replace function public.set_ai_paused(p_paused boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_app_admin() then raise exception 'Admin access required' using errcode='42501';end if;
 if p_paused is null then raise exception 'Choose pause or resume' using errcode='22023';end if;
 update public.security_limits set ai_paused=p_paused where id;
end$$;
create or replace function public.get_beta_security() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_app_admin() then raise exception 'Admin access required' using errcode='42501';end if;
 return jsonb_build_object('accounts',coalesce((select jsonb_agg(jsonb_build_object('email',email,'registered',user_id is not null,'approved',approved) order by email) from public.beta_access),'[]'::jsonb),
 'limits',(select to_jsonb(l) from public.security_limits l where id),
 'today',coalesce((select to_jsonb(c) from public.ai_budget_counters c where scope='global' and period='day' and window_start=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),'{}'::jsonb));
end$$;

-- Every provider call reserves its own budget BEFORE network work. A failed or
-- ambiguous call keeps its reservation. Retries and fallback models pay again.
create or replace function public.reserve_ai_budget(p_workspace uuid,p_actor uuid,p_input_bytes integer,p_output_tokens integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.security_limits;owner_id uuid;row record;b public.ai_budget_counters;
 minute_start timestamptz:=date_trunc('minute',now());
 day_start timestamptz:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 month_start timestamptz:=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
begin
 if p_input_bytes is null or p_input_bytes not between 1 and 800000 or p_output_tokens is null or p_output_tokens not between 1 and 8000 then
  return '{"allowed":false,"code":"input_too_large"}'::jsonb;end if;
 select w.owner_id into owner_id from public.workspaces w where w.id=p_workspace;
 if owner_id is null or not public.has_beta_access(owner_id) or
 (p_actor is not null and (not public.has_beta_access(p_actor) or not exists(select from public.workspace_members where workspace_id=p_workspace and user_id=p_actor))) then
  return '{"allowed":false,"code":"beta_access_required"}'::jsonb;end if;
 -- One short transaction serializes all scopes. Concurrent requests cannot
 -- each observe the last available credit, including across different workers.
 perform pg_advisory_xact_lock(17200001);
 select * into strict l from public.security_limits where id;
 if l.ai_paused then return '{"allowed":false,"code":"ai_paused"}'::jsonb;end if;
 for row in select * from (values
  ('workspace:'||p_workspace::text,'minute',minute_start,l.workspace_minute),
  ('workspace:'||p_workspace::text,'day',day_start,l.workspace_day),
  ('user:'||coalesce(p_actor,owner_id)::text,'minute',minute_start,l.workspace_minute),
  ('user:'||coalesce(p_actor,owner_id)::text,'day',day_start,l.workspace_day),
  ('global','day',day_start,l.global_day),('global','month',month_start,l.global_month)
 ) as buckets(scope,period,starts,max_calls) loop
  select * into b from public.ai_budget_counters where scope=row.scope and period=row.period and window_start=row.starts;
  if coalesce(b.calls,0)>=row.max_calls or (row.scope='global' and row.period='day' and
   (coalesce(b.input_bytes,0)+p_input_bytes>l.global_input_bytes_day or coalesce(b.output_tokens,0)+p_output_tokens>l.global_output_tokens_day)) then
   return jsonb_build_object('allowed',false,'code','usage_limit','retry_after',case row.period when 'minute' then 60 when 'day' then 86400 else 2678400 end);
  end if;
 end loop;
 for row in select * from (values
  ('workspace:'||p_workspace::text,'minute',minute_start),('workspace:'||p_workspace::text,'day',day_start),
  ('user:'||coalesce(p_actor,owner_id)::text,'minute',minute_start),('user:'||coalesce(p_actor,owner_id)::text,'day',day_start),
  ('global','day',day_start),('global','month',month_start)
 ) as buckets(scope,period,starts) loop
  insert into public.ai_budget_counters(scope,period,window_start,calls,input_bytes,output_tokens)
   values(row.scope,row.period,row.starts,1,p_input_bytes,p_output_tokens)
  on conflict(scope,period,window_start) do update set calls=public.ai_budget_counters.calls+1,
   input_bytes=public.ai_budget_counters.input_bytes+excluded.input_bytes,output_tokens=public.ai_budget_counters.output_tokens+excluded.output_tokens;
 end loop;
 delete from public.ai_budget_counters where (period='minute' and window_start<now()-interval '2 hours')
 or (period='day' and window_start<now()-interval '35 days') or (period='month' and window_start<now()-interval '400 days');
 return '{"allowed":true}'::jsonb;
end$$;

-- Storage reserves the full per-file allowance even if size metadata is absent.
-- 100 objects per workspace => at most 1,000 MiB; 1,000 globally => at most 10,000 MiB.
create or replace function public.enforce_resume_storage_budget() returns trigger
language plpgsql security definer set search_path='' as $$
declare w text;old_id uuid;workspace_count bigint;global_count bigint;
begin
 if new.bucket_id<>'resumes' then return new;end if;
 if tg_op='UPDATE' and new.bucket_id=old.bucket_id and new.name=old.name then return new;end if;
 w:=split_part(new.name,'/',1);
 if tg_op='UPDATE' then old_id:=old.id;end if;
 perform pg_advisory_xact_lock(17200002);
 select count(*),count(*) filter(where split_part(name,'/',1)=w) into global_count,workspace_count
 from storage.objects where bucket_id='resumes' and (old_id is null or id<>old_id);
 if workspace_count>=100 or global_count>=1000 then raise exception 'Resume storage limit reached. Remove unused resumes or contact the administrator.' using errcode='PT429';end if;
 return new;
end$$;
drop trigger if exists resume_storage_budget on storage.objects;
create trigger resume_storage_budget before insert or update on storage.objects for each row execute function public.enforce_resume_storage_budget();

-- Direct REST writes must observe admission and resource limits too. Updates
-- and deletes remain available at capacity; existing records are never removed.
create or replace function public.enforce_beta_record_budget() returns trigger
language plpgsql security definer set search_path='' as $$
declare maximum integer;total bigint;row_data jsonb:=to_jsonb(new);
begin
 if pg_column_size(new)>1000000 then raise exception 'Record is too large' using errcode='PT413';end if;
 if tg_op<>'INSERT' then return new;end if;
 maximum:=case tg_table_name when 'jobs' then 100 when 'candidates' then 1000 when 'candidate_documents' then 100
 when 'candidate_assessments' then 5000 when 'manager_feedback' then 5000 when 'interview_outcomes' then 5000 when 'screening_insights' then 5000 else 1000 end;
 perform pg_advisory_xact_lock(hashtextextended('record-budget:'||new.workspace_id::text,0));
 execute format('select count(*) from public.%I where workspace_id=$1',tg_table_name) into total using new.workspace_id;
 if total>=maximum then raise exception 'Workspace record limit reached. Contact the administrator.' using errcode='PT429';end if;
 return new;
end$$;
do $$declare t text;begin
 foreach t in array array['jobs','candidates','candidate_documents','candidate_assessments','manager_feedback','interview_outcomes','screening_insights'] loop
  execute format('drop trigger if exists beta_record_budget on public.%I',t);
  execute format('create trigger beta_record_budget before insert or update on public.%I for each row execute function public.enforce_beta_record_budget()',t);
 end loop;
end$$;
-- New memberships must not grant application access to unapproved accounts.
create or replace function public.require_approved_member() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select from public.beta_access where user_id=new.user_id and approved) then
  raise exception 'Beta access requires approval' using errcode='42501';end if;
 return new;
end$$;
-- The account-creation workspace trigger may run before the beta binding trigger;
-- check at transaction end, after all Auth triggers have completed.
drop trigger if exists approved_workspace_member on public.workspace_members;
create constraint trigger approved_workspace_member after insert or update on public.workspace_members
 deferrable initially deferred for each row execute function public.require_approved_member();

revoke all on function public.has_beta_access(uuid),public.before_beta_signup(jsonb),public.enforce_beta_signup(),public.manage_beta_access(text,boolean),
 public.set_ai_paused(boolean),public.get_beta_security(),public.reserve_ai_budget(uuid,uuid,integer,integer),
 public.enforce_resume_storage_budget(),public.enforce_beta_record_budget(),public.require_approved_member() from public,anon,authenticated;
grant execute on function public.manage_beta_access(text,boolean),public.set_ai_paused(boolean),public.get_beta_security() to authenticated;
grant execute on function public.reserve_ai_budget(uuid,uuid,integer,integer) to service_role;
grant execute on function public.before_beta_signup(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
commit;

begin;
create table if not exists public.user_settings (
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '' check(char_length(display_name)<=100),
 company text not null default '' check(char_length(company)<=120),
 job_title text not null default '' check(char_length(job_title)<=120),
 time_zone text not null default 'UTC' check(char_length(time_zone)<=80),
 start_page text not null default 'home' check(start_page in ('home','job-picker','jobs','learn')),
 candidate_sort text not null default 'manager' check(candidate_sort in ('manager','jd','newest','name')),
 show_closed boolean not null default false,
 text_size text not null default 'standard' check(text_size in ('standard','large','larger')),
 density text not null default 'comfortable' check(density in ('comfortable','compact')),
 reduce_motion boolean not null default false,
 notify_assessments boolean not null default true,
 notify_uploads boolean not null default true,
 notify_automation boolean not null default true,
 revision bigint not null default 0 check(revision>=0),
 updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
revoke all on public.user_settings from public,anon,authenticated;
grant select on public.user_settings to authenticated;
drop policy if exists settings_read_own on public.user_settings;
create policy settings_read_own on public.user_settings for select to authenticated using(user_id=auth.uid());

create or replace function public.get_user_settings() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 insert into public.user_settings(user_id,display_name)
 select id,left(coalesce(display_name,''),100) from public.profiles where id=auth.uid()
 on conflict(user_id) do nothing;
 select to_jsonb(s) into result from public.user_settings s where user_id=auth.uid();
 if result is null then raise exception 'Account unavailable' using errcode='42501';end if;
 return result;
end$$;
create or replace function public.save_user_settings(p_settings jsonb,p_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_settings public.user_settings; next_settings public.user_settings;
begin
 perform public.get_user_settings();
 select * into current_settings from public.user_settings where user_id=auth.uid() for update;
 if jsonb_typeof(p_settings)<>'object' or p_settings is null or octet_length(p_settings::text)>4000
 or p_settings - array['display_name','company','job_title','time_zone','start_page','candidate_sort','show_closed','text_size','density','reduce_motion','notify_assessments','notify_uploads','notify_automation'] <> '{}'::jsonb
 then raise exception 'Invalid settings' using errcode='22023';end if;
 next_settings:=jsonb_populate_record(current_settings,p_settings);
 if not exists(select from pg_catalog.pg_timezone_names where name=next_settings.time_zone) then raise exception 'Choose a valid time zone' using errcode='22023';end if;
 -- A retry after a lost response is safe; a stale tab cannot overwrite newer choices.
 if (to_jsonb(next_settings)-array['revision','updated_at'])=(to_jsonb(current_settings)-array['revision','updated_at']) then return to_jsonb(current_settings);end if;
 if p_revision is distinct from current_settings.revision then raise exception 'Settings changed in another tab. Reload saved settings before saving.' using errcode='PT409';end if;
 update public.user_settings set display_name=trim(next_settings.display_name),company=trim(next_settings.company),job_title=trim(next_settings.job_title),time_zone=next_settings.time_zone,
 start_page=next_settings.start_page,candidate_sort=next_settings.candidate_sort,show_closed=next_settings.show_closed,text_size=next_settings.text_size,density=next_settings.density,reduce_motion=next_settings.reduce_motion,
 notify_assessments=next_settings.notify_assessments,notify_uploads=next_settings.notify_uploads,notify_automation=next_settings.notify_automation,revision=revision+1,updated_at=now()
 where user_id=auth.uid() returning * into next_settings;
 update public.profiles set display_name=next_settings.display_name where id=auth.uid();
 return to_jsonb(next_settings);
end$$;

create table if not exists public.user_notifications (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 kind text not null check(kind in ('assessments','uploads','automation')),message text not null,
 job_id uuid references public.jobs(id) on delete cascade,candidate_id uuid references public.candidates(id) on delete cascade,
 event_key text not null,created_at timestamptz not null default now(),read_at timestamptz,
 unique(user_id,event_key)
);
create index if not exists notifications_user_time on public.user_notifications(user_id,created_at desc);
alter table public.user_notifications enable row level security;
revoke all on public.user_notifications from public,anon,authenticated;
grant select on public.user_notifications to authenticated;
drop policy if exists notifications_own on public.user_notifications;
create policy notifications_own on public.user_notifications for select to authenticated using(user_id=auth.uid() and public.is_workspace_member(workspace_id));
create or replace function public.mark_notifications_read(p_ids uuid[]) returns void
language sql security definer set search_path='' as $$
 update public.user_notifications set read_at=now() where user_id=auth.uid() and id=any(p_ids) and public.is_workspace_member(workspace_id) and read_at is null;
$$;
create or replace function public.notify_processing_result() returns trigger
language plpgsql security definer set search_path='' as $$
declare row_data jsonb:=to_jsonb(new); old_data jsonb; category text; label text; job_name text;
begin
 if row_data->>'status' not in ('ready','failed') then return new;end if;
 if tg_op='UPDATE' then
  old_data:=to_jsonb(old);
  if row_data->>'status'=old_data->>'status' and row_data->>'revision'=old_data->>'revision' then return new;end if;
 end if;
 if tg_table_name='job_criteria_tasks' then
  if row_data->>'status'<>'failed' then return new;end if;
  category:='automation';label:='Criteria processing needs attention';
 elsif row_data->>'status'='ready' then category:='assessments';label:='An assessment is ready to review';
 elsif tg_table_name='resume_intake_tasks' then category:='uploads';label:='A resume assessment needs attention';
 else category:='automation';label:='An assessment update needs attention';end if;
 select title into job_name from public.jobs where id=(row_data->>'job_id')::uuid;
 insert into public.user_notifications(user_id,workspace_id,kind,message,job_id,candidate_id,event_key)
 select m.user_id,m.workspace_id,category,label||' · '||coalesce(job_name,'Job'),(row_data->>'job_id')::uuid,(row_data->>'candidate_id')::uuid,
 tg_table_name||':'||coalesce(row_data->>'candidate_id',row_data->>'job_id')||':'||(row_data->>'revision')||':'||(row_data->>'status')
 from public.workspace_members m left join public.user_settings s on s.user_id=m.user_id
 where m.workspace_id=(row_data->>'workspace_id')::uuid
 and case category when 'assessments' then coalesce(s.notify_assessments,true) when 'uploads' then coalesce(s.notify_uploads,true) else coalesce(s.notify_automation,true) end
 on conflict(user_id,event_key) do nothing;
 return new;
end$$;
do $$declare t text;begin
 foreach t in array array['job_criteria_tasks','job_reassessment_tasks','resume_intake_tasks'] loop
  execute format('drop trigger if exists notify_result on public.%I',t);
  execute format('create trigger notify_result after insert or update on public.%I for each row execute function public.notify_processing_result()',t);
 end loop;
end$$;

create table if not exists public.support_requests (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 subject text not null check(char_length(subject) between 3 and 160),description text not null check(char_length(description) between 10 and 6000),
 reply_email text not null, status text not null default 'open' check(status in ('open','reviewed','resolved')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.support_requests enable row level security;
revoke all on public.support_requests from public,anon,authenticated;
grant select on public.support_requests to authenticated;
drop policy if exists support_read on public.support_requests;
create policy support_read on public.support_requests for select to authenticated using(user_id=auth.uid() or public.is_app_admin());
create or replace function public.submit_support_request(p_id uuid,p_subject text,p_description text) returns uuid
language plpgsql security definer set search_path='' as $$
declare email text;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501';end if;
 select u.email into email from auth.users u where u.id=auth.uid();
 if email is null then raise exception 'Account unavailable' using errcode='42501';end if;
 if exists(select from public.support_requests where id=p_id and user_id=auth.uid()) then return p_id;end if;
 if(select count(*) from public.support_requests where user_id=auth.uid() and created_at>now()-interval '1 hour')>=10 then raise exception 'Please wait before sending another report.' using errcode='PT429';end if;
 insert into public.support_requests(id,user_id,subject,description,reply_email) values(p_id,auth.uid(),trim(p_subject),trim(p_description),email);
 return p_id;
end$$;
create or replace function public.review_support_request(p_id uuid,p_status text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_app_admin() then raise exception 'Admin access required' using errcode='42501';end if;
 update public.support_requests set status=p_status,updated_at=now() where id=p_id;
end$$;
create or replace function public.get_admin_support_requests() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.is_app_admin() then raise exception 'Admin access required' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from (select * from public.support_requests order by (status='resolved'),created_at desc limit 100) r;
 return result;
end$$;
do $$declare f text;begin
 foreach f in array array['get_admin_support_requests()','get_user_settings()','save_user_settings(jsonb,bigint)','mark_notifications_read(uuid[])','submit_support_request(uuid,text,text)','review_support_request(uuid,text)'] loop
  execute 'revoke all on function public.'||f||' from public,anon';
  execute 'grant execute on function public.'||f||' to authenticated';
 end loop;
end$$;
revoke all on function public.notify_processing_result() from public,anon,authenticated;
commit;

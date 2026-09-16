-- Private per-user guidance. Atomic single-action updates avoid one tab
-- replacing a different tip dismissed in another tab. Existing RLS applies.
begin;
alter table public.workspace_home add column if not exists guidance_state jsonb not null default '{"enabled":true,"tips":{}}'::jsonb;
do $$begin
 if not exists(select from pg_constraint where conrelid='public.workspace_home'::regclass and conname='workspace_home_guidance_valid') then
  alter table public.workspace_home add constraint workspace_home_guidance_valid check (
   jsonb_typeof(guidance_state)='object' and coalesce(jsonb_typeof(guidance_state->'enabled')='boolean',false)
   and coalesce(jsonb_typeof(guidance_state->'tips')='object',false) and octet_length(guidance_state::text)<=2048
  );
 end if;
end$$;
create or replace function public.update_contextual_guidance(p_workspace uuid,p_action text,p_tip text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare current_state jsonb;
begin
 if auth.uid() is null or not public.is_workspace_member(p_workspace) then raise exception 'Workspace unavailable' using errcode='42501';end if;
 if p_action is null or p_action not in ('dismiss','complete','enable','disable','reset') then raise exception 'Invalid guidance action' using errcode='22023';end if;
 if p_action in ('dismiss','complete') and (p_tip is null or p_tip not in ('assessment','feedback','approval','submission')) then raise exception 'Invalid guidance tip' using errcode='22023';end if;
 insert into public.workspace_home(user_id,workspace_id) values(auth.uid(),p_workspace) on conflict(user_id,workspace_id) do nothing;
 select guidance_state into strict current_state from public.workspace_home where user_id=auth.uid() and workspace_id=p_workspace for update;
 if p_action='reset' then current_state='{"enabled":true,"tips":{}}'::jsonb;
 elsif p_action in ('enable','disable') then current_state=jsonb_set(current_state,'{enabled}',to_jsonb(p_action='enable'));
 elsif p_action='dismiss' or not (current_state->'tips' ? p_tip) then
  current_state=jsonb_set(current_state,array['tips',p_tip],to_jsonb(case when p_action='dismiss' then 'dismissed' else 'completed' end));
 end if;
 update public.workspace_home set guidance_state=current_state where user_id=auth.uid() and workspace_id=p_workspace;
 return current_state;
end$$;
revoke all on function public.update_contextual_guidance(uuid,text,text) from public,anon;
grant execute on function public.update_contextual_guidance(uuid,text,text) to authenticated;
commit;

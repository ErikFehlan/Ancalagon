begin;
-- Training candidates are private records. An interpretation review is not a
-- training authorization, and never directly changes a deployed model.
create table if not exists public.learning_permissions (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 enabled boolean not null default false, authorization_record text not null,
 authorized_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now()
);
create table if not exists public.learning_examples (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 job_id uuid not null, candidate_id uuid not null, feedback_id uuid not null references public.manager_feedback(id) on delete cascade,
 revision text not null, task_version text not null check(task_version='feedback-v1'),
 input jsonb not null, original_output jsonb not null, reviewed_text text not null,
 review_kind text not null check(review_kind in ('accepted','corrected')), source_model text,
 reviewed_by uuid references auth.users(id) on delete set null, captured_at timestamptz not null default now(),
 foreign key(candidate_id,job_id,workspace_id) references public.candidates(id,job_id,workspace_id) on delete cascade,
 unique(feedback_id,revision), check(jsonb_typeof(input)='object' and pg_column_size(input)<=200000),
 check(char_length(reviewed_text) between 1 and 2000)
);
create index if not exists learning_examples_workspace on public.learning_examples(workspace_id,captured_at);
create table if not exists public.learning_model_releases (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
 model text not null check(model like 'ft:gpt-4.1-mini-2025-04-14:%'), baseline_model text not null,
 run_hash text not null check(run_hash ~ '^[a-f0-9]{64}$'), example_ids uuid[] not null,
 metrics jsonb not null, active boolean not null default false, invalidated boolean not null default false,
 created_at timestamptz not null default now(), unique(workspace_id,run_hash)
);
create unique index if not exists learning_one_active_model on public.learning_model_releases(workspace_id) where active;

alter table public.learning_permissions enable row level security;
alter table public.learning_examples enable row level security;
alter table public.learning_model_releases enable row level security;
revoke all on public.learning_permissions,public.learning_examples,public.learning_model_releases from public,anon,authenticated;
grant select on public.learning_permissions,public.learning_examples,public.learning_model_releases to authenticated;
grant all on public.learning_permissions,public.learning_examples,public.learning_model_releases to service_role;
drop policy if exists learning_permission_read on public.learning_permissions;
create policy learning_permission_read on public.learning_permissions for select to authenticated using(public.is_workspace_member(workspace_id));
drop policy if exists learning_example_read on public.learning_examples;
create policy learning_example_read on public.learning_examples for select to authenticated using(public.is_workspace_member(workspace_id));
drop policy if exists learning_model_read on public.learning_model_releases;
create policy learning_model_read on public.learning_model_releases for select to authenticated using(public.is_workspace_member(workspace_id));

create or replace function public.set_learning_permission(p_workspace uuid,p_enabled boolean,p_record text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select from public.workspaces where id=p_workspace and owner_id=auth.uid() and public.is_workspace_member(id)) then
  raise exception 'Workspace owner authorization required' using errcode='42501';end if;
 if p_enabled is null or char_length(trim(coalesce(p_record,''))) not between 10 and 2000 then raise exception 'Record the authorization or withdrawal' using errcode='22023';end if;
 insert into public.learning_permissions(workspace_id,enabled,authorization_record,authorized_by) values(p_workspace,p_enabled,p_record,auth.uid())
 on conflict(workspace_id) do update set enabled=excluded.enabled,authorization_record=excluded.authorization_record,authorized_by=excluded.authorized_by,updated_at=now();
 if not p_enabled then update public.learning_model_releases set active=false,invalidated=true where workspace_id=p_workspace;end if;
end$$;

create or replace function public.capture_feedback_learning() returns trigger
language plpgsql security definer set search_path='' as $$
declare f public.manager_feedback; interpretation jsonb; snapshot jsonb; fingerprint text;
begin
 if new.assessment_type<>'manager_feedback' then return new;end if;
 interpretation:=new.evidence->'interpretation';snapshot:=interpretation->'learning';
 if coalesce(interpretation->>'reviewStatus','') not in ('accepted','corrected') or snapshot->>'version' is distinct from 'feedback-v1'
  or jsonb_typeof(snapshot->'input') is distinct from 'object' or pg_column_size(snapshot)>200000
  or jsonb_typeof(snapshot->'output') is distinct from 'object' or nullif(interpretation->>'text','') is null
  or char_length(interpretation->>'text')>2000 then return new;end if;
 select * into f from public.manager_feedback where id::text=new.evidence->>'feedback_id'
  and workspace_id=new.workspace_id and job_id=new.job_id and candidate_id=new.candidate_id;
 if not found or snapshot#>>'{input,feedback,text}' is distinct from f.feedback_text
  or snapshot#>>'{input,candidate_ref}' is distinct from f.candidate_id::text
  or snapshot#>>'{input,feedback,type}' is distinct from coalesce(nullif(f.feedback_type,''),'General note')
  or snapshot#>>'{input,feedback,outcome}' is distinct from coalesce(nullif(f.outcome,''),'Neutral / no signal') then return new;end if;
 fingerprint:=md5(jsonb_build_array(snapshot,interpretation->>'text',interpretation->>'reviewStatus')::text);
 -- Only the current review is eligible. Replacing/deleting a source invalidates
 -- releases that trained on it, even when the client replaces assessment rows.
 delete from public.learning_examples where feedback_id=f.id and revision<>fingerprint;
 insert into public.learning_examples(workspace_id,job_id,candidate_id,feedback_id,revision,task_version,input,original_output,reviewed_text,review_kind,source_model,reviewed_by)
 values(f.workspace_id,f.job_id,f.candidate_id,f.id,fingerprint,'feedback-v1',snapshot->'input',snapshot->'output',interpretation->>'text',interpretation->>'reviewStatus',interpretation->>'model',auth.uid())
 on conflict(feedback_id,revision) do nothing;
 return new;
end$$;
drop trigger if exists capture_feedback_learning on public.candidate_assessments;
create trigger capture_feedback_learning after insert or update on public.candidate_assessments for each row execute function public.capture_feedback_learning();

create or replace function public.invalidate_changed_learning() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if (new.feedback_text,new.feedback_type,new.outcome) is distinct from (old.feedback_text,old.feedback_type,old.outcome) then delete from public.learning_examples where feedback_id=new.id;end if;
 return new;
end$$;
drop trigger if exists invalidate_changed_learning on public.manager_feedback;
create trigger invalidate_changed_learning after update on public.manager_feedback for each row execute function public.invalidate_changed_learning();
create or replace function public.invalidate_learning_models() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.learning_model_releases set active=false,invalidated=true where old.id=any(example_ids);
 return old;
end$$;
drop trigger if exists invalidate_learning_models on public.learning_examples;
create trigger invalidate_learning_models before delete on public.learning_examples for each row execute function public.invalidate_learning_models();

create or replace function public.get_feedback_learning_model(p_workspace uuid) returns text
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_workspace_member(p_workspace) then raise exception 'Workspace access required' using errcode='42501';end if;
 return (select r.model from public.learning_model_releases r join public.learning_permissions p using(workspace_id)
  where r.workspace_id=p_workspace and r.active and not r.invalidated and p.enabled);
end$$;

-- Operator-only promotion: compare-and-swap, current source checks and measured
-- improvement. The UI cannot register models or manufacture an evaluation gate.
create or replace function public.promote_feedback_model(p_workspace uuid,p_model text,p_baseline text,p_examples uuid[],p_metrics jsonb,p_hash text,p_expected uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare current_id uuid; new_id uuid; total integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text,6321));
 perform 1 from public.learning_permissions where workspace_id=p_workspace and enabled for update;
 if not found then raise exception 'Training authorization required' using errcode='42501';end if;
 -- Lock sources before releases, matching source-deletion invalidation order.
 perform 1 from public.learning_examples where workspace_id=p_workspace and id=any(p_examples) order by id for share;
 select count(*) into total from public.learning_examples where workspace_id=p_workspace and id=any(p_examples);
 if total<>cardinality(p_examples) then raise exception 'Training sources changed or cross workspaces' using errcode='PT409';end if;
 select id into current_id from public.learning_model_releases where workspace_id=p_workspace and active for update;
 if current_id is distinct from p_expected then raise exception 'Active model changed; evaluate again' using errcode='PT409';end if;
 if current_id is null and p_baseline is distinct from 'gpt-4.1-mini-2025-04-14' then raise exception 'Wrong base model' using errcode='22023';end if;
 if current_id is not null and p_baseline is distinct from (select model from public.learning_model_releases where id=current_id) then raise exception 'Wrong comparison baseline' using errcode='22023';end if;
 if p_examples is null or cardinality(p_examples)<60 or p_metrics->>'human_reviewed' is distinct from 'true'
  or coalesce((p_metrics->>'train_count')::int,0)<50 or coalesce((p_metrics->>'test_count')::int,0)<10
  or coalesce((p_metrics->>'train_count')::int,0)+coalesce((p_metrics->>'test_count')::int,0)<>cardinality(p_examples)
  or coalesce((p_metrics->>'candidate_mean')::numeric,0) not between 4 and 5
  or coalesce((p_metrics->>'baseline_mean')::numeric,0) not between 1 and 5
  or coalesce((p_metrics->>'candidate_mean')::numeric,0)<coalesce((p_metrics->>'baseline_mean')::numeric,5)+0.1
  or coalesce((p_metrics->>'unsupported_claims')::int,1)<>0
  or p_metrics->>'all_schema_valid' is distinct from 'true' or p_metrics->>'all_scope_safe' is distinct from 'true' then
  raise exception 'Evaluation gate not met' using errcode='22023';end if;
 update public.learning_model_releases set active=false where workspace_id=p_workspace and active;
 insert into public.learning_model_releases(workspace_id,model,baseline_model,run_hash,example_ids,metrics,active)
 values(p_workspace,p_model,p_baseline,p_hash,p_examples,p_metrics,true) returning id into new_id;
 return new_id;
end$$;
create or replace function public.rollback_feedback_model(p_workspace uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text,6321));
 update public.learning_model_releases set active=false where workspace_id=p_workspace and active;
end$$;
revoke all on function public.capture_feedback_learning(),public.invalidate_changed_learning(),public.invalidate_learning_models(),
 public.promote_feedback_model(uuid,text,text,uuid[],jsonb,text,uuid),public.rollback_feedback_model(uuid) from public,anon,authenticated;
grant execute on function public.promote_feedback_model(uuid,text,text,uuid[],jsonb,text,uuid),public.rollback_feedback_model(uuid) to service_role;
revoke all on function public.set_learning_permission(uuid,boolean,text),public.get_feedback_learning_model(uuid) from public,anon;
grant execute on function public.set_learning_permission(uuid,boolean,text),public.get_feedback_learning_model(uuid) to authenticated;
commit;

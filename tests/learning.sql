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
\ir ../supabase/migrations/20260916210000_feedback_learning.sql
\ir ../supabase/migrations/20260916210000_feedback_learning.sql
insert into auth.users(id,email) values('00000000-0000-0000-0000-000000000001','a@example.test'),('00000000-0000-0000-0000-000000000002','b@example.test');
create temp table ids as select owner_id as user_id,id as workspace_id from workspaces;
grant select on public.workspaces,public.workspace_members,public.jobs,public.candidates,public.manager_feedback to authenticated;
grant insert,select,update,delete on public.candidate_assessments to authenticated;
insert into jobs(id,workspace_id,title) select '00000000-0000-0000-0000-000000000021',workspace_id,'Synthetic job' from ids where user_id='00000000-0000-0000-0000-000000000001';
insert into candidates(id,workspace_id,job_id,name) select '00000000-0000-0000-0000-000000000031',workspace_id,id,'Synthetic candidate' from jobs;
insert into manager_feedback(workspace_id,job_id,candidate_id,feedback_type,outcome,feedback_text)
 select workspace_id,job_id,id,'General note',null,'Synthetic ownership evidence '||n from candidates cross join generate_series(1,75) n;
set test.actor='00000000-0000-0000-0000-000000000001';set role authenticated;
insert into candidate_assessments(workspace_id,job_id,candidate_id,assessment_type,evidence)
 select workspace_id,job_id,candidate_id,'manager_feedback',jsonb_build_object('feedback_id',id,'interpretation',jsonb_build_object('text','Reviewed ownership.','reviewStatus','accepted','model','base','learning',jsonb_build_object('version','feedback-v1','input',jsonb_build_object('candidate_ref',candidate_id,'feedback',jsonb_build_object('text',feedback_text,'type',feedback_type,'outcome','Neutral / no signal')),'output',jsonb_build_object('summary','Original interpretation.','clarification_question',null)))) from manager_feedback;
do $$begin
 if(select count(*) from learning_examples)<>75 then raise exception 'Reviewed examples were not captured';end if;
 if exists(select from learning_permissions) then raise exception 'Review silently granted training permission';end if;
 if get_feedback_learning_model((select id from workspaces limit 1)) is not null then raise exception 'Untrained model was activated';end if;
 begin update learning_examples set reviewed_text='forged';raise exception 'Client changed curated data';exception when insufficient_privilege then null;end;
 begin insert into learning_permissions select id,true,'Forged permission',auth.uid(),now() from workspaces;raise exception 'Direct permission write succeeded';exception when insufficient_privilege then null;end;
end$$;
-- Replacing assessment rows during ordinary saves must retain example identities.
reset role;
create temp table before_examples as select id from learning_examples;
create temp table saved_assessments as select * from candidate_assessments;
delete from candidate_assessments;
insert into candidate_assessments select * from saved_assessments;
do $$begin if(select count(*) from learning_examples where id in(select id from before_examples))<>75 then raise exception 'Ordinary save duplicated or replaced examples';end if;end$$;
-- Missing review status, mismatched note, and wrong candidate must never qualify.
delete from learning_examples;
update candidate_assessments set evidence=evidence #- '{interpretation,reviewStatus}';
do $$begin if exists(select from learning_examples) then raise exception 'Unreviewed interpretation captured';end if;end$$;
update candidate_assessments set evidence=jsonb_set(jsonb_set(evidence,'{interpretation,reviewStatus}','"accepted"'),'{interpretation,learning,input,feedback,text}','"Changed note"');
do $$begin if exists(select from learning_examples) then raise exception 'Stale input captured';end if;end$$;
update candidate_assessments a set evidence=jsonb_set(s.evidence,'{interpretation,learning,input,candidate_ref}','"00000000-0000-0000-0000-000000000099"') from saved_assessments s where a.id=s.id;
do $$begin if exists(select from learning_examples) then raise exception 'Wrong candidate captured';end if;end$$;
update candidate_assessments a set evidence=s.evidence from saved_assessments s where a.id=s.id;
set role authenticated;
select set_learning_permission(id,true,'Owner authorized this synthetic training pilot.') from workspaces;
reset role;
create temp table evaluation as select '{"human_reviewed":true,"train_count":60,"test_count":15,"baseline_mean":3,"candidate_mean":4,"unsupported_claims":0,"all_schema_valid":true,"all_scope_safe":true}'::jsonb metrics;
do $$declare w uuid;examples uuid[];metrics jsonb;release uuid;begin
 select workspace_id into w from ids where user_id='00000000-0000-0000-0000-000000000001';select array_agg(id) into examples from learning_examples;select e.metrics into metrics from evaluation e;
 begin perform promote_feedback_model(w,'ft:gpt-4.1-mini-2025-04-14:test:run:one','gpt-4.1-mini-2025-04-14',examples,jsonb_set(metrics,'{unsupported_claims}','1'),repeat('a',64));raise exception 'Unsafe model promoted';exception when invalid_parameter_value then null;end;
 begin perform promote_feedback_model(w,'ft:gpt-4.1-mini-2025-04-14:test:run:one','wrong-baseline',examples,metrics,repeat('a',64));raise exception 'Wrong baseline promoted';exception when invalid_parameter_value then null;end;
 begin perform promote_feedback_model(w,'ft:gpt-4.1-mini-2025-04-14:test:run:one','gpt-4.1-mini-2025-04-14',examples||array['00000000-0000-0000-0000-000000000099'::uuid],metrics,repeat('a',64));raise exception 'Missing source promoted';exception when sqlstate 'PT409' then null;end;
 release:=promote_feedback_model(w,'ft:gpt-4.1-mini-2025-04-14:test:run:one','gpt-4.1-mini-2025-04-14',examples,metrics,repeat('a',64));
 if release is null then raise exception 'Release missing';end if;
 begin perform promote_feedback_model(w,'ft:gpt-4.1-mini-2025-04-14:test:run:two','gpt-4.1-mini-2025-04-14',examples,metrics,repeat('b',64));raise exception 'Stale promotion replaced active model';exception when sqlstate 'PT409' then null;end;
end$$;
set role authenticated;
do $$begin if get_feedback_learning_model((select id from workspaces limit 1))<>'ft:gpt-4.1-mini-2025-04-14:test:run:one' then raise exception 'Approved model not routed';end if;end$$;
set test.actor='00000000-0000-0000-0000-000000000002';
do $$begin
 if exists(select from learning_examples) or exists(select from learning_permissions) or exists(select from learning_model_releases) then raise exception 'Learning data crossed workspaces';end if;
end$$;
reset role;
-- Knowing another workspace ID does not grant authorization or model access.
do $$declare w uuid;begin
 select workspace_id into w from ids where user_id='00000000-0000-0000-0000-000000000001';
 begin perform get_feedback_learning_model(w);raise exception 'Other account resolved a private model';exception when insufficient_privilege then null;end;
 begin perform set_learning_permission(w,true,'Forged authorization by another account.');raise exception 'Other owner authorized data';exception when insufficient_privilege then null;end;
end$$;
set test.actor='00000000-0000-0000-0000-000000000001';
-- A correction invalidates the model that used the old source.
update candidate_assessments set evidence=jsonb_set(jsonb_set(evidence,'{interpretation,text}','"Corrected ownership scope."'),'{interpretation,reviewStatus}','"corrected"') where id=(select id from candidate_assessments limit 1);
do $$begin if exists(select from learning_model_releases where active or not invalidated) then raise exception 'Corrected source kept old model active';end if;if(select count(*) from learning_examples)<>75 then raise exception 'Correction lost or duplicated source';end if;end$$;
-- Repromote with current sources, then editing a note invalidates it immediately.
select promote_feedback_model((select workspace_id from ids where user_id='00000000-0000-0000-0000-000000000001'),'ft:gpt-4.1-mini-2025-04-14:test:run:two','gpt-4.1-mini-2025-04-14',(select array_agg(id) from learning_examples),(select metrics from evaluation),repeat('b',64));
update manager_feedback set feedback_text='Changed underlying evidence' where id=(select id from manager_feedback limit 1);
do $$begin if exists(select from learning_model_releases where active) or(select count(*) from learning_examples)<>74 then raise exception 'Changed feedback did not invalidate learning';end if;end$$;
set role authenticated;
select set_learning_permission(id,false,'Owner withdrew the pilot training authorization.') from workspaces;
do $$begin if get_feedback_learning_model((select id from workspaces limit 1)) is not null then raise exception 'Withdrawn model still used';end if;end$$;
reset role;
do $$begin
 if has_function_privilege('anon','public.get_feedback_learning_model(uuid)','EXECUTE') or has_function_privilege('authenticated','public.promote_feedback_model(uuid,text,text,uuid[],jsonb,text,uuid)','EXECUTE') or has_function_privilege('authenticated','public.rollback_feedback_model(uuid)','EXECUTE') then raise exception 'Operator privileges exposed';end if;
end$$;
delete from auth.users where id='00000000-0000-0000-0000-000000000001';
do $$begin if exists(select from learning_examples) or exists(select from learning_model_releases) or exists(select from learning_permissions) then raise exception 'Deleted account retained local learning data';end if;if(select count(*) from auth.users)<>1 then raise exception 'Deletion crossed accounts';end if;end$$;
select 'Learning capture, permissions, held-out gates, source invalidation and account isolation passed' as result;

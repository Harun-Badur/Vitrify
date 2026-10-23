do $$ begin
  perform style_test.ok((select not rolsuper and rolbypassrls from pg_roles where rolname='style_schema_owner')
    and (select pg_get_userbyid(proowner)='style_schema_owner' from pg_proc where oid='public.recompute_profile(uuid)'::regprocedure),'STAGING_LIKE_NONSUPER_DEFINER_OWNER');
  perform style_test.ok((select profiles=(select jsonb_agg(to_jsonb(p) order by user_id) from public.user_style_profiles p) and events=(select jsonb_agg(to_jsonb(e) order by event_id) from public.user_events e) from style_test.install_baseline),'INSTALL_NO_PROFILE_OR_EVENT_MUTATION');
  perform style_test.ok(not exists(select 1 from public.recs_config where key in ('style_preference_writer_v2','style_profile_v2')),'INSTALL_NO_ACTIVATION_CONFIG');
  perform style_test.ok((select count(*)=0 from public.style_preference_actions),'INSTALL_EMPTY_LEDGER');
  perform style_test.ok(has_table_privilege('authenticated','public.style_preference_actions','SELECT') and not has_table_privilege('authenticated','public.style_preference_actions','INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER'),'LEDGER_CLIENT_SELECT_ONLY');
  perform style_test.ok(not has_table_privilege('anon','public.style_preference_actions','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER'),'LEDGER_ANON_NO_ACCESS');
  perform style_test.ok(has_function_privilege('authenticated','public.style_apply_preference_v2(uuid,text,text,uuid,uuid[],jsonb)','EXECUTE') and not has_function_privilege('anon','public.style_apply_preference_v2(uuid,text,text,uuid,uuid[],jsonb)','EXECUTE'),'RPC_INTENDED_EXECUTE_WITH_CLOSED_GATE');
  perform style_test.ok(not has_function_privilege('authenticated','public.recompute_profile_v1(uuid)','EXECUTE') and not has_function_privilege('authenticated','public.recompute_profile_v2(uuid,text)','EXECUTE'),'PROFILE_HELPERS_PRIVATE');
  perform style_test.ok(not has_table_privilege('service_role','public.liked_products','SELECT,INSERT,UPDATE,DELETE'),'INSTALL_PRESERVES_SERVICE_ROLE_DIFFERENCE');
end $$;
begin;
set local role authenticated;
do $$ declare ref jsonb; got jsonb; begin
  perform style_test.claim('A');
  perform style_test.denied($q$select public.style_apply_preference_v2(gen_random_uuid(),'favorite','fixture-1',gen_random_uuid(),null,'{"id":"fixture-1"}')$q$,'WRITER_DISABLED','INSTALL_WRITER_CLOSED');
  perform style_test.reference_v1(auth.uid());select to_jsonb(p) into ref from public.user_style_profiles p where user_id=auth.uid();
  perform public.recompute_profile(auth.uid());select to_jsonb(p) into got from public.user_style_profiles p where user_id=auth.uid();
  perform style_test.ok(ref=got,'WRITER_CLOSED_V1_COMPLETE_LEGACY_ROW_EQUAL');
  perform style_test.ok((select count(*)=4 from public.user_events),'WRITER_CLOSED_LEGACY_ACTION_METADATA_NOT_FILTERED');
end $$;
reset role;
update deletion_private.owner_gates set fenced=true where subject='00000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
  perform style_test.claim('A');perform style_test.denied($q$select public.recompute_profile(auth.uid())$q$,'fenced','RECOMPUTE_RESPECTS_LIVE_FENCE');
end $$;
rollback;
-- Test-only activation for isolated race assertions; never app/staging activation.
insert into public.recs_config(key,value) values
 ('style_preference_writer_v2','{"enabled":true}'),
 ('style_profile_v2','{"algorithm":"style-preference-v2","legacy_policy":"exclude_with_approval"}');
begin;
set local role authenticated;
do $$ begin
  perform style_test.claim('A');perform public.style_apply_preference_v2('80000000-0000-4000-8000-000000000010','favorite','fixture-4',gen_random_uuid(),null,'{"id":"fixture-4"}');
end $$;
reset role;
update deletion_private.owner_gates set fenced=true where subject='00000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
  perform style_test.denied($q$select public.style_apply_preference_v2('80000000-0000-4000-8000-000000000011','favorite','fixture-5',gen_random_uuid(),null,'{"id":"fixture-5"}')$q$,'fenced','FENCED_FAVORITE_REJECTED');
  perform style_test.denied($q$select public.style_apply_preference_v2('80000000-0000-4000-8000-000000000012','unlike','fixture-4',gen_random_uuid(),array['80000000-0000-4000-8000-000000000010']::uuid[])$q$,'fenced','FENCED_UNLIKE_REJECTED');
  perform style_test.ok((select count(*)=1 from public.liked_products where product_id='fixture-4') and (select count(*)=1 from public.style_preference_actions),'FENCED_CANCEL_FULL_TRANSACTION_ROLLBACK');
end $$;
reset role;
delete from auth.users where id='00000000-0000-4000-8000-000000000001';
do $$ begin
  perform style_test.ok((select count(*)=0 from public.style_preference_actions),'AUTH_CASCADE_REMOVES_LEDGER');
  perform style_test.ok((select fenced from deletion_private.owner_gates where subject='00000000-0000-4000-8000-000000000001'),'AUTH_CASCADE_PRESERVES_GATE');
end $$;
set local role authenticated;
do $$ begin perform style_test.claim('A');perform style_test.denied($q$select public.style_apply_preference_v2(gen_random_uuid(),'unlike','fixture-1',gen_random_uuid(),'{}'::uuid[])$q$,'foreign key','DELETED_OWNER_CANNOT_RECREATE_CANCEL_LEDGER');end $$;
rollback;
-- Turning the writer off after V2 use does not disable the registered-mirror
-- filter. Demonstrate this intentional difference from raw V1, without changing legacy rows.
begin;
set local role authenticated;
do $$ begin
  perform style_test.claim('A');
  perform public.style_apply_preference_v2('80000000-0000-4000-8000-000000000020','favorite','fixture-5',gen_random_uuid(),null,'{"id":"fixture-5"}');
  insert into public.user_events(event_id,user_id,session_id,event_type,product_id,payload) values
    (gen_random_uuid(),auth.uid(),gen_random_uuid(),'like','fixture-5','{"action_id":"80000000-0000-4000-8000-000000000020"}');
end $$;
reset role;
update public.recs_config set value='{"enabled":false}' where key='style_preference_writer_v2';
delete from public.recs_config where key='style_profile_v2';
set local role authenticated;
do $$ declare raw_count integer; filtered_count integer; begin
  perform style_test.claim('A');perform style_test.reference_v1(auth.uid());
  select event_count into raw_count from public.user_style_profiles where user_id=auth.uid();
  perform public.recompute_profile(auth.uid());select event_count into filtered_count from public.user_style_profiles where user_id=auth.uid();
  perform style_test.ok(raw_count=7 and filtered_count=6,'WRITER_OFF_EXISTING_LEDGER_MIRROR_FILTER_PERSISTS');
  perform style_test.ok((select count(*)=2 from public.user_events where payload->>'action_id'='90000000-0000-4000-8000-000000000099'),'REGISTERED_FILTER_PRESERVES_UNRELATED_LEGACY_PAIR');
  perform style_test.claim(null);
  perform style_test.denied($q$select public.recompute_profile('00000000-0000-4000-8000-000000000001')$q$,'AUTH_REQUIRED','WRAPPER_NULL_SUBJECT_NON_NULL_OWNER_REJECTED');
end $$;
rollback;
create function style_test.fence_c() returns void language plpgsql security definer set search_path=pg_catalog as $$
begin update deletion_private.owner_gates set fenced=true where subject='00000000-0000-4000-8000-000000000003';end $$;
grant execute on function style_test.fence_c() to authenticated;
set role authenticated;
do $$ begin perform style_test.claim('C');perform public.style_apply_preference_v2('80000000-0000-4000-8000-000000000001','favorite','fixture-1','20000000-0000-4000-8000-000000000001',null,'{"id":"fixture-1"}');end $$;
reset role;

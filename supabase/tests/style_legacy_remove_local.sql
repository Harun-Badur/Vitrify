-- Disposable localhost test schema only. Synthetic records; all changes rollback.
begin;
select style_test.claim('A');
delete from public.style_preference_actions;
delete from public.user_events;
delete from public.liked_products;
delete from public.passed_products;
insert into public.liked_products(id,user_id,product_id,product_snapshot,notify_on_price_drop)
 values('30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','fixture-1','{"id":"fixture-1"}',true);
insert into public.passed_products(id,user_id,product_id)
 values('30000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','fixture-2');
insert into public.user_events(event_id,user_id,session_id,event_type,product_id,payload)
 values('60000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','like','fixture-1','{}');
set local role authenticated;
do $$ declare r jsonb; original jsonb;
begin
 select to_jsonb(l) into original from public.liked_products l where product_id='fixture-1';
 r:=public.style_remove_legacy_preference_v2('70000000-0000-4000-8000-000000000001','unlike','fixture-1','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001');
 perform style_test.ok(r->>'replayed'='false','LEGACY_REMOVE_NEW_CANCELLATION');
 perform style_test.ok(not exists(select 1 from public.liked_products where product_id='fixture-1'),'LEGACY_CURRENT_RELATION_REMOVED');
 perform style_test.ok((select request->'legacy_removed_row'=original from public.style_preference_actions where action_id='70000000-0000-4000-8000-000000000001'),'LEGACY_EXACT_ROW_ARCHIVED');
 perform style_test.ok(exists(select 1 from public.user_events where event_id='60000000-0000-4000-8000-000000000001'),'LEGACY_RAW_HISTORY_PRESERVED');
 perform style_test.ok(not exists(select 1 from public.style_preference_actions where kind in ('favorite','pass')),'LEGACY_NO_FAKE_HISTORICAL_ACTION');
 r:=public.style_remove_legacy_preference_v2('70000000-0000-4000-8000-000000000001','unlike','fixture-1','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001');
 perform style_test.ok(r->>'replayed'='true','LEGACY_REMOVE_EXACT_REPLAY');
 perform style_test.denied('select public.style_remove_legacy_preference_v2(''70000000-0000-4000-8000-000000000001'',''unlike'',''fixture-2'',''20000000-0000-4000-8000-000000000001'',''30000000-0000-4000-8000-000000000001'')','REQUEST_ID_REUSED','LEGACY_REPLAY_BODY_MISMATCH');
 r:=public.style_remove_legacy_preference_v2('70000000-0000-4000-8000-000000000002','undo_pass','fixture-2','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002');
 perform style_test.ok(not exists(select 1 from public.passed_products where product_id='fixture-2'),'LEGACY_PASS_REMOVED');
 perform style_test.claim('B');
 perform style_test.denied('select public.style_remove_legacy_preference_v2(''70000000-0000-4000-8000-000000000001'',''unlike'',''fixture-1'',''20000000-0000-4000-8000-000000000001'',''30000000-0000-4000-8000-000000000001'')','LEGACY_TARGET_CHANGED','LEGACY_OTHER_OWNER_DENIED');
 perform style_test.claim('A');
end;$$;
reset role;
-- A new canonical like must make the old legacy request stale, never cancel it.
select public.style_apply_preference_v2('70000000-0000-4000-8000-000000000003','favorite','fixture-1','20000000-0000-4000-8000-000000000001',null,'{"id":"fixture-1"}');
select style_test.denied('select public.style_remove_legacy_preference_v2(''70000000-0000-4000-8000-000000000004'',''unlike'',''fixture-1'',''20000000-0000-4000-8000-000000000001'',''30000000-0000-4000-8000-000000000001'')','LEGACY_TARGET_CHANGED','LEGACY_NEW_CANONICAL_LIKE_PRESERVED');
-- Inject transaction failure after the relation deletion, prove full rollback.
create function style_test.reject_cancel() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_CANCEL_FAILURE';end;$$;
create trigger test_cancel_failure before insert on public.style_preference_actions for each row execute function style_test.reject_cancel();
insert into public.passed_products(id,user_id,product_id) values('30000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','fixture-3');
select style_test.denied('select public.style_remove_legacy_preference_v2(''70000000-0000-4000-8000-000000000005'',''undo_pass'',''fixture-3'',''20000000-0000-4000-8000-000000000001'',''30000000-0000-4000-8000-000000000003'')','SYNTHETIC_CANCEL_FAILURE','LEGACY_CANCEL_TRANSACTION_FAILURE');
select style_test.ok(exists(select 1 from public.passed_products where product_id='fixture-3'),'LEGACY_FAILED_CANCEL_ROW_RETAINED');
select style_test.ok(not exists(select 1 from public.style_preference_actions where action_id='70000000-0000-4000-8000-000000000005')
 and not exists(select 1 from public.user_events where payload->>'action_id'='70000000-0000-4000-8000-000000000005'),'LEGACY_FAILED_CANCEL_NO_PARTIAL_LEDGER_EVENT');
select style_test.ok(has_function_privilege('authenticated','public.style_remove_legacy_preference_v2(uuid,text,text,uuid,uuid)','EXECUTE')
 and not has_function_privilege('anon','public.style_remove_legacy_preference_v2(uuid,text,text,uuid,uuid)','EXECUTE')
 and not has_function_privilege('service_role','public.style_remove_legacy_preference_v2(uuid,text,text,uuid,uuid)','EXECUTE'),'LEGACY_RPC_EFFECTIVE_ACL');
rollback;

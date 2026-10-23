-- This whole suite rolls back; only isolated synthetic fixture data is used.
begin;
set local role authenticated;
do $$ begin perform style_test.claim('A'); end $$;
do $$ declare r jsonb; begin
  r:=public.style_apply_preference_v2('10000000-0000-4000-8000-000000000001','favorite','fixture-1','20000000-0000-4000-8000-000000000001',null,'{"id":"fixture-1"}');
  perform style_test.ok(r->>'replayed'='false','FAVORITE_FIRST_COMMIT');
  perform style_test.ok((select event_count=1 and (color_w->>'siyah')::numeric=1 from public.user_style_profiles where user_id=auth.uid()),'PAIR_ONE_PROFILE_CONTRIBUTION');
  perform style_test.ok((select count(*)=2 from public.user_events where user_id=auth.uid()),'PAIR_SOURCE_EVENTS_PRESERVED');
  r:=public.style_apply_preference_v2('10000000-0000-4000-8000-000000000001','favorite','fixture-1','20000000-0000-4000-8000-000000000001',null,'{"id":"fixture-1"}');
  perform style_test.ok(r->>'replayed'='true','ACTION_REPLAY');
  perform style_test.ok((select count(*)=2 from public.user_events where user_id=auth.uid()),'REPLAY_NO_NEW_EVENTS');
  perform style_test.denied($q$select public.style_apply_preference_v2('10000000-0000-4000-8000-000000000001','favorite','fixture-2','20000000-0000-4000-8000-000000000001',null,'{"id":"fixture-2"}')$q$,'REQUEST_ID_REUSED','ACTION_ID_PAYLOAD_REUSE');
  perform public.style_apply_preference_v2('10000000-0000-4000-8000-000000000002','favorite','fixture-1','20000000-0000-4000-8000-000000000001',null,'{"id":"fixture-1"}');
  perform style_test.ok((select event_count=2 from public.user_style_profiles where user_id=auth.uid()),'INDEPENDENT_ACTIONS');
  perform style_test.denied($q$select public.style_apply_preference_v2('10000000-0000-4000-8000-000000000010','favorite','fixture-2','20000000-0000-4000-8000-000000000001',null,'{"id":"wrong"}')$q$,'INVALID_SNAPSHOT','INVALID_JSON_SNAPSHOT');
end $$;
-- RLS and privileges are real SQL role checks; claims are synthetic, unsigned.
do $$ begin perform style_test.claim('B'); end $$;
do $$ declare changed integer; begin
  perform style_test.ok((select count(*)=0 from public.liked_products),'B_CANNOT_READ_A_LIKES');
  perform style_test.ok((select count(*)=0 from public.style_preference_actions),'B_CANNOT_READ_A_LEDGER');
  perform style_test.ok((select count(*)=0 from public.user_style_profiles),'B_CANNOT_READ_A_PROFILE');
  perform style_test.denied($q$select public.recompute_profile('00000000-0000-4000-8000-000000000001')$q$,'yalnızca kendi profilin','B_CANNOT_RECOMPUTE_A');
  perform style_test.denied($q$insert into public.style_preference_actions(user_id,action_id,product_id,kind,event_ids,request) values(auth.uid(),gen_random_uuid(),'fixture-1','favorite',array[gen_random_uuid()],'{}')$q$,'permission denied','CLIENT_CANNOT_FORGE_LEDGER');
  perform style_test.denied($q$select public.style_apply_preference_v2('10000000-0000-4000-8000-000000000011','unlike','fixture-1','20000000-0000-4000-8000-000000000001',array['10000000-0000-4000-8000-000000000001']::uuid[])$q$,'STALE_TARGETS','B_CANNOT_CANCEL_A');
  update public.liked_products set notify_on_price_drop=false where product_id='fixture-1';get diagnostics changed=row_count;
  perform style_test.ok(changed=0,'B_CANNOT_UPDATE_A');
  delete from public.liked_products where product_id='fixture-1';get diagnostics changed=row_count;
  perform style_test.ok(changed=0,'B_CANNOT_DELETE_A');
end $$;
do $$ begin perform style_test.claim('A'); end $$;
do $$ begin
  perform public.style_apply_preference_v2('10000000-0000-4000-8000-000000000003','unlike','fixture-1','20000000-0000-4000-8000-000000000001',array['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002']::uuid[]);
  perform style_test.ok((select count(*)=0 from public.liked_products),'UNLIKE_REMOVES_ROW');
  perform style_test.ok((select event_count=0 and color_w='{}' from public.user_style_profiles where user_id=auth.uid()),'UNLIKE_REMOVES_PROFILE_CONTRIBUTION');
  perform public.style_apply_preference_v2('10000000-0000-4000-8000-000000000004','favorite','fixture-1','20000000-0000-4000-8000-000000000001',null,'{"id":"fixture-1"}');
  perform public.style_apply_preference_v2('10000000-0000-4000-8000-000000000003','unlike','fixture-1','20000000-0000-4000-8000-000000000001',array['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002']::uuid[]);
  perform style_test.ok((select event_count=1 from public.user_style_profiles where user_id=auth.uid()),'OLD_UNLIKE_REPLAY_PRESERVES_NEW_LIKE');
  perform style_test.denied($q$select public.style_apply_preference_v2('10000000-0000-4000-8000-000000000012','unlike','fixture-1','20000000-0000-4000-8000-000000000001',array['10000000-0000-4000-8000-000000000001']::uuid[])$q$,'STALE_TARGETS','STALE_UNLIKE_REJECTED');
  perform public.style_apply_preference_v2('10000000-0000-4000-8000-000000000005','pass','fixture-2','20000000-0000-4000-8000-000000000001');
  perform style_test.ok((select jsonb_array_length(negative_preferences)=1 from public.user_style_profiles where user_id=auth.uid()),'PASS_NEGATIVE');
  perform public.style_apply_preference_v2('10000000-0000-4000-8000-000000000006','undo_pass','fixture-2','20000000-0000-4000-8000-000000000001',array['10000000-0000-4000-8000-000000000005']::uuid[]);
  perform style_test.ok((select jsonb_array_length(negative_preferences)=0 from public.user_style_profiles where user_id=auth.uid()),'UNDO_PASS_CLEARS_NEGATIVE');
end $$;
-- Fake committed payload is stored by existing ingest but never becomes a trusted action.
do $$ declare batch jsonb; begin
  batch:=jsonb_build_array(jsonb_build_object('event_id','30000000-0000-4000-8000-000000000001','user_id',auth.uid(),'session_id','20000000-0000-4000-8000-000000000001','event_type','like','product_id','fixture-3','payload',jsonb_build_object('action_id','fake','outcome','committed')));
  perform public.ingest_events(batch);perform public.ingest_events(batch);
  perform style_test.ok((select count(*)=1 from public.user_events where event_id='30000000-0000-4000-8000-000000000001'),'INGEST_EVENT_ID_IDEMPOTENCY');
  perform style_test.ok((select event_count=1 from public.user_style_profiles where user_id=auth.uid()),'FAKE_COMMIT_NOT_VERIFIED');
  perform style_test.denied($q$select public.ingest_events('[{"event_id":"30000000-0000-4000-8000-000000000099","user_id":"00000000-0000-4000-8000-000000000002","session_id":"20000000-0000-4000-8000-000000000001","event_type":"like"}]')$q$,'oturum ile eşleşmiyor','INGEST_OWNER_REJECTION');
  -- Copies arriving add-first/like-later do not inflate a registered action.
  perform public.ingest_events(jsonb_build_array(jsonb_build_object('event_id',gen_random_uuid(),'user_id',auth.uid(),'session_id',gen_random_uuid(),'event_type','dolap_add','product_id','fixture-1','payload',jsonb_build_object('action_id','10000000-0000-4000-8000-000000000004'))));
  perform public.ingest_events(jsonb_build_array(jsonb_build_object('event_id',gen_random_uuid(),'user_id',auth.uid(),'session_id',gen_random_uuid(),'event_type','like','product_id','fixture-1','payload',jsonb_build_object('action_id','10000000-0000-4000-8000-000000000004'))));
  perform style_test.ok((select event_count=1 from public.user_style_profiles where user_id=auth.uid()),'OUT_OF_ORDER_COPIES_ONE_CONTRIBUTION');
end $$;
reset role;
-- Inject failure after the product write to prove complete transactional rollback.
create function style_test.fail_event() returns trigger language plpgsql as $$ begin
  if new.product_id='fixture-4' then raise exception 'INJECTED_EVENT_FAILURE'; end if;return new;
end $$;
create trigger style_test_fail_event before insert on public.user_events for each row execute function style_test.fail_event();
set local role authenticated;
do $$ begin
  perform style_test.denied($q$select public.style_apply_preference_v2('10000000-0000-4000-8000-000000000020','favorite','fixture-4','20000000-0000-4000-8000-000000000001',null,'{"id":"fixture-4"}')$q$,'INJECTED_EVENT_FAILURE','TRANSACTION_ERROR');
  perform style_test.ok((select count(*)=0 from public.liked_products where product_id='fixture-4'),'ROLLBACK_LIKE');
  perform style_test.ok((select count(*)=0 from public.style_preference_actions where action_id='10000000-0000-4000-8000-000000000020'),'ROLLBACK_LEDGER');
end $$;
reset role;
drop trigger style_test_fail_event on public.user_events;
-- A recompute failure occurs AFTER ledger + both source events were inserted.
do $$ declare saved_weights jsonb; begin
  select value into saved_weights from public.recs_config where key='event_weights';
  delete from public.recs_config where key='event_weights';
  perform style_test.denied($q$select public.style_apply_preference_v2('10000000-0000-4000-8000-000000000030','favorite','fixture-4','20000000-0000-4000-8000-000000000001',null,'{"id":"fixture-4"}')$q$,'event_weights','PROFILE_RECOMPUTE_FAILURE');
  perform style_test.ok((select count(*)=0 from public.liked_products where product_id='fixture-4'),'PROFILE_FAILURE_ROLLBACK_LIKE');
  perform style_test.ok((select count(*)=0 from public.style_preference_actions where action_id='10000000-0000-4000-8000-000000000030'),'PROFILE_FAILURE_ROLLBACK_LEDGER');
  perform style_test.ok((select count(*)=0 from public.user_events where payload->>'action_id'='10000000-0000-4000-8000-000000000030'),'PROFILE_FAILURE_ROLLBACK_EVENTS');
  insert into public.recs_config(key,value) values('event_weights',saved_weights);
end $$;
-- Compare today's separate CRUD calls with the proposed atomic transaction.
insert into public.passed_products(user_id,product_id) values
 ('00000000-0000-4000-8000-000000000001','fixture-6'),('00000000-0000-4000-8000-000000000001','fixture-7');
create function style_test.fail_pass_delete() returns trigger language plpgsql as $$ begin
  if old.product_id in ('fixture-6','fixture-7') then raise exception 'INJECTED_DELETE_FAILURE'; end if;return old;
end $$;
create trigger style_test_fail_pass_delete before delete on public.passed_products for each row execute function style_test.fail_pass_delete();
set local role authenticated;
do $$ begin
  insert into public.liked_products(user_id,product_id,product_snapshot) values(auth.uid(),'fixture-6','{"id":"fixture-6"}');
  perform style_test.denied($q$delete from public.passed_products where user_id=auth.uid() and product_id='fixture-6'$q$,'INJECTED_DELETE_FAILURE','OLD_CRUD_CLEANUP_FAILURE');
  perform style_test.ok((select count(*)=1 from public.liked_products where product_id='fixture-6'),'OLD_CRUD_PARTIAL_LIKE_REMAINS');
  perform style_test.denied($q$select public.style_apply_preference_v2('10000000-0000-4000-8000-000000000021','favorite','fixture-7','20000000-0000-4000-8000-000000000001',null,'{"id":"fixture-7"}')$q$,'INJECTED_DELETE_FAILURE','NEW_RPC_CLEANUP_FAILURE');
  perform style_test.ok((select count(*)=0 from public.liked_products where product_id='fixture-7'),'NEW_RPC_LIKE_ROLLED_BACK');
  perform style_test.ok((select count(*)=0 from public.style_preference_actions where action_id='10000000-0000-4000-8000-000000000021'),'NEW_RPC_CLEANUP_NO_LEDGER');
  perform style_test.denied($q$select public.style_apply_preference_v2('10000000-0000-4000-8000-000000000022','unlike','fixture-6','20000000-0000-4000-8000-000000000001','{}'::uuid[])$q$,'LEGACY_TARGET_UNRESOLVED','LEGACY_TARGET_NOT_INVENTED');
end $$;
reset role;
drop trigger style_test_fail_pass_delete on public.passed_products;
-- Preserve legacy keeps both old signals; this is a policy, not inferred grouping.
insert into public.user_events(event_id,user_id,session_id,event_type,product_id,payload)
 values('30000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','dolap_add','fixture-3','{}');
do $$ begin
  perform style_test.ok((select count(*)=3 from public.style_profile_events_v2('00000000-0000-4000-8000-000000000001','preserve_v1')),'LEGACY_PRESERVED');
  perform style_test.ok((select count(*)=1 from public.style_profile_events_v2('00000000-0000-4000-8000-000000000001','exclude_with_approval')),'LEGACY_EXPLICIT_EXCLUSION');
  perform style_test.ok((select count(*)=2 from public.user_events where product_id='fixture-3'),'LEGACY_ROWS_UNCHANGED');
  perform style_test.ok((select sum((public.recs_config_value('event_weights')->>event_type)::numeric)=1
    from public.style_profile_events_v2('00000000-0000-4000-8000-000000000001','exclude_with_approval')),'PAIR_WEIGHT_ONE_NOT_2_2');
  perform style_test.ok(not has_schema_privilege('authenticated','public','CREATE'),'DEFINER_PUBLIC_SCHEMA_NOT_WRITABLE');
  perform style_test.ok(not has_function_privilege('anon','public.style_apply_preference_v2(uuid,text,text,uuid,uuid[],jsonb)','EXECUTE'),'ANON_RPC_REJECTED');
  perform style_test.ok(not has_function_privilege('authenticated','public.recompute_profile_v2(uuid,text)','EXECUTE'),'CLIENT_POLICY_OVERRIDE_REJECTED');
  perform style_test.ok((select count(*)=6 and bool_and(p.prosecdef and pg_get_userbyid(p.proowner)='postgres' and p.proconfig @> array['search_path=public'])
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
    ('ingest_events','recompute_profile','recompute_profile_v1','recompute_profile_v2','style_profile_events_v2','style_apply_preference_v2')),'DEFINER_OWNERS_AND_SEARCH_PATH');
end $$;
-- An absent algorithm selection keeps v1; a missing writer switch fails closed independently.
do $$ declare saved_config jsonb; reference jsonb; observed jsonb; begin
  select value into saved_config from public.recs_config where key='style_profile_v2';
  update public.recs_config set value='{}' where key='style_profile_v2';
  reference:=public.recompute_profile_v1('00000000-0000-4000-8000-000000000001');
  observed:=public.recompute_profile('00000000-0000-4000-8000-000000000001');
  perform style_test.ok(reference=observed,'DEFAULT_VERSION_V1_COMPATIBILITY');
  delete from public.recs_config where key='style_preference_writer_v2';
  perform style_test.denied($q$select public.style_apply_preference_v2(gen_random_uuid(),'pass','fixture-8',gen_random_uuid())$q$,'WRITER_DISABLED','WRITER_WITHOUT_SWITCH_REJECTED');
  insert into public.recs_config(key,value) values('style_preference_writer_v2','{"enabled":true}');
  update public.recs_config set value=saved_config where key='style_profile_v2';
  perform public.recompute_profile('00000000-0000-4000-8000-000000000001');
  perform style_test.ok((select event_count=1 from public.user_style_profiles where user_id='00000000-0000-4000-8000-000000000001'),'VERSION_SWITCH_V2_COMPATIBILITY');
end $$;
-- Wardrobe branch: trusted fixture ledger only; no real wardrobe transaction bridge.
insert into public.style_preference_actions(user_id,action_id,product_id,kind,event_ids,request)
 values('00000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','synthetic-owned','wardrobe',array[gen_random_uuid()],'{}');
do $$ begin perform style_test.ok((select count(*)=1 from public.style_profile_events_v2('00000000-0000-4000-8000-000000000001','exclude_with_approval')),'WARDROBE_NOT_PREFERENCE'); end $$;
-- 1000 canonical contributions, 2002 source events, plus cancellation outside window.
do $$ begin perform style_test.claim(null); end $$;
insert into public.style_preference_actions(user_id,action_id,product_id,kind,event_ids,request)
 select '00000000-0000-4000-8000-000000000002',gen_random_uuid(),'fixture-5','favorite',array[gen_random_uuid(),gen_random_uuid()],'{}' from generate_series(1,1001);
insert into public.user_events(event_id,user_id,session_id,event_type,product_id,payload,created_at)
 select ids.id,a.user_id,'20000000-0000-4000-8000-000000000001',case ids.ord when 1 then 'like' else 'dolap_add' end,
 a.product_id,jsonb_build_object('action_id',a.action_id),case ids.ord when 1 then now()-interval '1 second' else now() end
 from public.style_preference_actions a cross join lateral unnest(a.event_ids) with ordinality ids(id,ord)
 where a.user_id='00000000-0000-4000-8000-000000000002' and a.kind='favorite';
do $$ begin
  perform style_test.ok((select count(*)=2002 from public.user_events where user_id='00000000-0000-4000-8000-000000000002'),'WINDOW_SOURCE_PAIR_COUNT');
  perform style_test.ok((select bool_and(event_type='dolap_add') from (select event_type from public.user_events
    where user_id='00000000-0000-4000-8000-000000000002' order by created_at desc,event_id desc limit 1000) cut),'RAW_WINDOW_SPLITS_PAIRS');
  perform public.recompute_profile_v2('00000000-0000-4000-8000-000000000002','exclude_with_approval');
  perform style_test.ok((select event_count=1000 from public.user_style_profiles where user_id='00000000-0000-4000-8000-000000000002'),'CANONICAL_WINDOW_1000');
end $$;
insert into public.style_preference_actions(user_id,action_id,product_id,kind,event_ids,revokes,request)
 select '00000000-0000-4000-8000-000000000002',gen_random_uuid(),'fixture-5','unlike',array[gen_random_uuid()],array_agg(action_id),'{}'
 from public.style_preference_actions where user_id='00000000-0000-4000-8000-000000000002' and kind='favorite';
do $$ begin
  perform public.recompute_profile_v2('00000000-0000-4000-8000-000000000002','exclude_with_approval');
  perform style_test.ok((select event_count=0 from public.user_style_profiles where user_id='00000000-0000-4000-8000-000000000002'),'CANCELLATION_BEFORE_WINDOW');
end $$;
-- Missing JWT subject must fail new write RPC. Cryptographic validation isn't tested.
set local role authenticated;
do $$ begin
  perform style_test.claim('A');
  delete from public.liked_products where product_id='fixture-1';
  perform public.recompute_profile(auth.uid());
  perform style_test.ok((select event_count=1 from public.user_style_profiles where user_id=auth.uid()),'OLD_DIRECT_DELETE_LEAVES_ANALYTICS_STALE');
  perform style_test.claim(null);
  perform style_test.denied($q$select public.style_apply_preference_v2(gen_random_uuid(),'pass','fixture-8',gen_random_uuid())$q$,'AUTH_REQUIRED','MISSING_SUBJECT_WRITE');
  perform style_test.denied($q$select public.recompute_profile('00000000-0000-4000-8000-000000000002')$q$,'AUTH_REQUIRED','MISSING_SUBJECT_PROFILE');
end $$;
reset role;
rollback;

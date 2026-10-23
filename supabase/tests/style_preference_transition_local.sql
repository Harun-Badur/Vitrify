-- Isolated synthetic cluster only. All cases roll back.
begin;
delete from public.recs_config where key='style_profile_v2';
insert into public.recs_config(key,value) values('style_preference_writer_v2','{"enabled":true}') on conflict(key) do update set value=excluded.value;
set local role authenticated;
do $$ declare aid uuid='70000000-0000-4000-8000-000000000001'; begin
  perform style_test.claim('A');
  perform public.style_apply_preference_v2(aid,'favorite','fixture-1','20000000-0000-4000-8000-000000000001',null,'{"id":"fixture-1"}');
  -- Stored maps are max-normalized, so one color is 1, not raw 2.2.
  perform style_test.ok((select event_count=2 and (color_w->>'siyah')::numeric=1 from public.user_style_profiles where user_id=auth.uid())
    and (select sum((c.value->>e.event_type)::numeric)=2.2 from public.user_events e cross join public.recs_config c where e.user_id=auth.uid() and c.key='event_weights'),'WRITER_ENABLED_V1_PAIR_WEIGHTS');
  perform public.ingest_events(jsonb_build_array(jsonb_build_object('event_id',gen_random_uuid(),'user_id',auth.uid(),'session_id',gen_random_uuid(),'event_type','like','product_id','fixture-1','payload',jsonb_build_object('action_id',aid))));
  perform style_test.ok((select event_count=2 and (color_w->>'siyah')::numeric=1 from public.user_style_profiles where user_id=auth.uid()),'V1_REGISTERED_MIRROR_NO_EXTRA_WEIGHT');
  perform public.style_apply_preference_v2('70000000-0000-4000-8000-000000000002','unlike','fixture-1','20000000-0000-4000-8000-000000000001',array[aid]);
  perform style_test.ok((select event_count=2 from public.user_style_profiles where user_id=auth.uid()),'V1_HISTORY_NOT_REINTERPRETED_AFTER_UNLIKE');
end $$;
reset role;
update public.recs_config set value='{"algorithm":"style-preference-v2","legacy_policy":"preserve_v1"}' where key='style_profile_v2';
insert into public.recs_config(key,value) values('style_profile_v2','{"algorithm":"style-preference-v2","legacy_policy":"preserve_v1"}') on conflict(key) do update set value=excluded.value;
set local role authenticated;
do $$ begin
  perform style_test.claim('A');perform public.recompute_profile(auth.uid());
  perform style_test.ok((select event_count=0 from public.user_style_profiles where user_id=auth.uid()),'V2_CANCEL_RESOLVES_WITHOUT_REWRITING_EVENTS');
  perform public.ingest_events(jsonb_build_array(jsonb_build_object('event_id',gen_random_uuid(),'user_id',auth.uid(),'session_id',gen_random_uuid(),'event_type','like','product_id','fixture-2','payload','{}'::jsonb)));
  perform style_test.ok((select event_count=1 from public.user_style_profiles where user_id=auth.uid()),'PRESERVE_LEGACY_PLUS_LEDGER');
end $$;
reset role;
update public.recs_config set value='{"algorithm":"style-preference-v2","legacy_policy":"exclude_with_approval"}' where key='style_profile_v2';
set local role authenticated;
do $$ begin perform style_test.claim('A');perform public.recompute_profile(auth.uid());
  perform style_test.ok((select event_count=0 from public.user_style_profiles where user_id=auth.uid()),'EXCLUDE_LEGACY_LOCAL_ONLY');end $$;
reset role;
delete from public.recs_config where key='style_preference_writer_v2';
set local role authenticated;
do $$ begin
  perform style_test.claim('A');
  perform style_test.denied($q$select public.style_apply_preference_v2('70000000-0000-4000-8000-000000000003','pass','fixture-3','20000000-0000-4000-8000-000000000001')$q$,'WRITER_DISABLED','MISSING_WRITER_CONFIG_FAILS_CLOSED');
end $$;
reset role;
update public.recs_config set value='{"algorithm":"style-preference-v2"}' where key='style_profile_v2';
insert into public.recs_config(key,value) values('style_preference_writer_v2','{"enabled":true}');
set local role authenticated;
do $$ begin
  perform style_test.denied($q$select public.style_apply_preference_v2('70000000-0000-4000-8000-000000000004','pass','fixture-3','20000000-0000-4000-8000-000000000001')$q$,'LEGACY_POLICY_REQUIRED','INVALID_PROFILE_CONFIG_ROLLS_BACK_WRITE');
  perform style_test.ok((select count(*)=0 from public.passed_products),'INVALID_PROFILE_CONFIG_NO_PARTIAL_ROW');
  delete from public.liked_products where product_id='fixture-1';
  perform style_test.ok((select count(*)=1 from public.style_preference_actions where kind='favorite'),'DIRECT_DELETE_DOES_NOT_REVOKE_LEDGER');
  insert into public.liked_products(user_id,product_id,product_snapshot) values(auth.uid(),'fixture-4','{"id":"fixture-4"}');
  perform style_test.ok((select count(*)=0 from public.style_preference_actions where product_id='fixture-4'),'DIRECT_INSERT_BYPASSES_LEDGER');
end $$;
rollback;

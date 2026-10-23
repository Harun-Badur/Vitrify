set role authenticated;
do $$ begin
  perform style_test.claim('A');perform public.recompute_profile(auth.uid());
  perform style_test.ok((select event_count=2 from public.user_style_profiles where user_id=auth.uid()),'ROLLBACK_RESTORES_V1_PAIR_COUNT');
  perform style_test.ok((select count(*)=1 from public.style_preference_actions),'ROLLBACK_LEDGER_RETAINED');
  perform style_test.ok((select count(*)=2 from public.user_events),'ROLLBACK_SOURCE_EVENTS_RETAINED');
  perform style_test.denied($q$select public.style_apply_preference_v2(gen_random_uuid(),'pass','fixture-8',gen_random_uuid())$q$,'permission denied','ROLLBACK_WRITER_DISABLED');
  perform style_test.claim(null);
  perform style_test.denied($q$select public.recompute_profile('00000000-0000-4000-8000-000000000002')$q$,'AUTH_REQUIRED','ROLLBACK_SUBJECT_GUARD_RETAINED');
end $$;
reset role;

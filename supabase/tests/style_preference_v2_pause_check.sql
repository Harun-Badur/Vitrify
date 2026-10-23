set role authenticated;
do $$ begin
  perform style_test.claim('A');
  perform style_test.denied($q$select public.style_apply_preference_v2(gen_random_uuid(),'pass','fixture-8',gen_random_uuid())$q$,'permission denied','PAUSE_RPC_REJECTED');
  perform style_test.ok((select count(*)=1 from public.style_preference_actions),'PAUSE_LEDGER_PRESERVED');
  perform style_test.ok((select count(*)=2 from public.user_events),'PAUSE_EVENTS_PRESERVED');
  perform style_test.ok((select event_count=1 from public.user_style_profiles where user_id=auth.uid()),'PAUSE_V2_PROFILE_PRESERVED');
end $$;
reset role;

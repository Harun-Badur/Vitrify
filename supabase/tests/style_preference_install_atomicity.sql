do $$ begin
  perform style_test.ok(to_regclass('public.style_preference_actions') is null,'FAILED_INSTALL_NO_LEDGER');
  perform style_test.ok(to_regprocedure('public.style_apply_preference_v2(uuid,text,text,uuid,uuid[],jsonb)') is null
    and to_regprocedure('public.recompute_profile_v1(uuid)') is null
    and to_regprocedure('public.recompute_profile_v2(uuid,text)') is null
    and to_regprocedure('public.style_profile_events_v2(uuid,text)') is null,'FAILED_INSTALL_NO_HELPERS');
  perform style_test.ok((select p.prosrc=b.source and p.proacl::text=b.acl from pg_proc p cross join style_test.install_baseline b where p.oid='public.recompute_profile(uuid)'::regprocedure),'FAILED_INSTALL_RESTORES_FUNCTION_AND_ACL');
  perform style_test.ok((select profiles=(select jsonb_agg(to_jsonb(p) order by user_id) from public.user_style_profiles p) and events=(select jsonb_agg(to_jsonb(e) order by event_id) from public.user_events e) from style_test.install_baseline),'FAILED_INSTALL_PRESERVES_EXISTING_DATA');
end $$;

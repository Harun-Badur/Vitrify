do $$ begin
  perform style_test.ok(to_regclass('public.style_preference_actions') is not null and to_regprocedure('public.style_apply_preference_v2(uuid,text,text,uuid,uuid[],jsonb)') is not null,'DUPLICATE_INSTALL_LEAVES_EXISTING_OBJECTS');
  perform style_test.ok((select count(*)=1 from public.style_preference_actions),'DUPLICATE_INSTALL_PRESERVES_DATA');
end $$;

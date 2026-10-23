-- Runs only in the existing disposable local fixture, before test-only activation.
do $$
begin
  if has_function_privilege('anon','public.style_apply_preference_v2(uuid,text,text,uuid,uuid[],jsonb)','EXECUTE')
    or has_function_privilege('service_role','public.style_apply_preference_v2(uuid,text,text,uuid,uuid[],jsonb)','EXECUTE') then
    raise exception 'PRODUCTION_WRITER_ACL_LEAK';
  end if;
  if not has_function_privilege('authenticated','public.style_apply_preference_v2(uuid,text,text,uuid,uuid[],jsonb)','EXECUTE') then
    raise exception 'AUTHENTICATED_WRITER_MISSING';
  end if;
  if exists(select 1 from public.recs_config where key in ('style_profile_v2','style_preference_writer_v2')) then
    raise exception 'INSTALL_ACTIVATED_CONFIG';
  end if;
  if has_table_privilege('anon','public.style_preference_actions','SELECT')
    or has_table_privilege('authenticated','public.style_preference_actions','INSERT,UPDATE,DELETE') then
    raise exception 'LEDGER_CLIENT_WRITE_LEAK';
  end if;
  raise notice 'PASS PRODUCTION_DEFAULT_ACL_WRITER_AUTH_ONLY';
  raise notice 'PASS PRODUCTION_INSTALL_CONFIG_OFF';
  raise notice 'PASS PRODUCTION_LEDGER_CLIENT_READ_ONLY';
end;
$$;

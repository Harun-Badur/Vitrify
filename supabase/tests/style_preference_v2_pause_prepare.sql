set role authenticated;
do $$ begin
  perform style_test.claim('A');
  perform public.style_apply_preference_v2('60000000-0000-4000-8000-000000000001','favorite','fixture-3','20000000-0000-4000-8000-000000000001',null,'{"id":"fixture-3"}');
end $$;
reset role;

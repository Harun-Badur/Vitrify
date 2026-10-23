-- Local synthetic cluster ONLY. Malformed/null/duplicate targets are adversarial fixtures.
begin;
select style_test.claim('A');
delete from public.user_events;
delete from public.style_preference_actions;
insert into public.style_preference_actions(user_id,action_id,product_id,kind,event_ids,revokes,request,committed_at)
select '00000000-0000-4000-8000-000000000001',md5('eq-action-'||n)::uuid,
 'fixture-'||(n%8+1),case n%3 when 0 then 'pass' when 1 then 'favorite' else 'unlike' end,
 array[md5('eq-event-'||n)::uuid],
 case when n>8 then array[md5('eq-action-'||(n-8))::uuid,md5('eq-action-'||(n-8))::uuid,null::uuid,md5('eq-action-'||(n-1))::uuid]
 else array[null::uuid] end,'{}',now()-n*interval '1 second'
from generate_series(1,96) n;
-- B reuses A's UUID, but its cancellation must never affect A.
insert into public.style_preference_actions(user_id,action_id,product_id,kind,event_ids,revokes,request)
values('00000000-0000-4000-8000-000000000002',md5('eq-action-96')::uuid,'fixture-1','unlike',
 array[md5('eq-b')::uuid],array[md5('eq-action-96')::uuid],'{}');
insert into public.user_events(event_id,user_id,session_id,event_type,product_id,payload)
select md5('eq-raw-'||n)::uuid,'00000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000001','like','fixture-'||(n%8+1),
 case when n%2=0 then jsonb_build_object('action_id',md5('eq-action-'||n)::uuid) else '{}'::jsonb end
from generate_series(1,100) n;
do $$ declare policy text; old_rows jsonb; new_rows jsonb; old_profile jsonb; new_profile jsonb;
 optimized text:=pg_get_functiondef('public.style_profile_events_v2(uuid,text)'::regprocedure);
 original text:=replace(pg_get_functiondef('style_bench.original_profile_events(uuid,text)'::regprocedure),
  'style_bench.original_profile_events(', 'public.style_profile_events_v2(');
begin
 foreach policy in array array['exclude_with_approval','preserve_v1'] loop
  select jsonb_agg(to_jsonb(e) order by event_id,event_type,product_id) into old_rows from style_bench.original_profile_events(auth.uid(),policy) e;
  select jsonb_agg(to_jsonb(e) order by event_id,event_type,product_id) into new_rows from public.style_profile_events_v2(auth.uid(),policy) e;
  perform style_test.ok(old_rows is not distinct from new_rows,
   case policy when 'exclude_with_approval' then 'REVOCATION_EXCLUDE_EQUIVALENT' else 'REVOCATION_PRESERVE_EQUIVALENT' end);
  update public.recs_config set value=jsonb_build_object('algorithm','style-preference-v2','legacy_policy',policy) where key='style_profile_v2';
  perform public.recompute_profile(auth.uid());
  select to_jsonb(p)-'updated_at'-'computed_at' into new_profile from public.user_style_profiles p where user_id=auth.uid();
  execute original;
  perform public.recompute_profile(auth.uid());
  select to_jsonb(p)-'updated_at'-'computed_at' into old_profile from public.user_style_profiles p where user_id=auth.uid();
  perform style_test.ok(new_profile=old_profile,'REVOCATION_PROFILE_EQUIVALENT');
  execute optimized;
 end loop;
 perform style_test.denied('select * from public.style_profile_events_v2(''00000000-0000-4000-8000-000000000002'',''exclude_with_approval'')','OWNER_MISMATCH','REVOCATION_WRONG_OWNER_DENIED');
 perform style_test.ok((select proacl::text=(select acl from style_bench.revocation_baseline)
  from pg_proc where oid='public.style_profile_events_v2(uuid,text)'::regprocedure),'REVOCATION_ACL_UNCHANGED');
end; $$;
rollback;
select style_test.ok((select md5(regexp_replace(prosrc,'[[:space:]]+',' ','g'))<>'452972666bba9de777629473fff8afdd'
 from pg_proc where oid='public.style_profile_events_v2(uuid,text)'::regprocedure),'REVOCATION_INSTALL_ROLLBACK');

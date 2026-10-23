-- Synthetic localhost only; prove exclude policy without deleting legacy data.
begin;
select style_test.claim('A');
insert into public.liked_products(user_id,product_id,product_snapshot) values('00000000-0000-4000-8000-000000000001','fixture-2','{"id":"fixture-2"}');
insert into public.passed_products(user_id,product_id) values('00000000-0000-4000-8000-000000000001','fixture-3');
insert into public.user_events(event_id,user_id,session_id,event_type,product_id,payload)
values('60000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','like','fixture-2','{"color":"red"}'),
 ('60000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','dolap_add','fixture-2','{"color":"red"}');
update public.product_attributes set colors=array['red'] where product_id='fixture-2';
update public.product_attributes set colors=array['blue'] where product_id='fixture-1';
create temp table preserved_legacy as select to_jsonb(e) as row from public.user_events e where event_id in ('60000000-0000-4000-8000-000000000011','60000000-0000-4000-8000-000000000012');
update public.recs_config set value='{"algorithm":"style-preference-v2","legacy_policy":"exclude_with_approval"}' where key='style_profile_v2';
select public.style_apply_preference_v2('70000000-0000-4000-8000-000000000011','favorite','fixture-1','20000000-0000-4000-8000-000000000001',null,'{"id":"fixture-1"}');
select style_test.ok((select event_count=1 and color_w ? 'blue' and not color_w ? 'red' from public.user_style_profiles where user_id=auth.uid()),'APPROVED_EXCLUDE_ONLY_ONE_CANONICAL_PREFERENCE');
select style_test.ok((select count(*)=2 from public.user_events e join preserved_legacy p on to_jsonb(e)=p.row),'APPROVED_EXCLUDE_LEGACY_EVENTS_BYTE_VALUES_PRESERVED');
select style_test.ok(exists(select 1 from public.liked_products where user_id=auth.uid() and product_id='fixture-2')
 and exists(select 1 from public.passed_products where user_id=auth.uid() and product_id='fixture-3'),'APPROVED_EXCLUDE_LEGACY_RELATIONS_PRESERVED');
select style_test.ok((select count(*)=2 from public.user_events where payload->>'action_id'='70000000-0000-4000-8000-000000000011')
 and (select count(*)=1 from public.style_preference_actions where action_id='70000000-0000-4000-8000-000000000011'),'APPROVED_EXCLUDE_FAVORITE_PAIR_SINGLE_LEDGER');
rollback;

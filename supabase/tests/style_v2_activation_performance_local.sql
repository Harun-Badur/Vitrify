-- LOCAL DISPOSABLE SYNTHETIC CLUSTER ONLY. Every row/flag change rolls back.
begin;
set local statement_timeout='120s';
select style_test.claim('A');
delete from public.user_events;
delete from public.style_preference_actions;
insert into public.products(id,provider,external_id,title,price,image_url,product_url,category)
select 'v2-bench-'||n,'mock','v2-bench-'||n,'Synthetic fixture',100,
 'https://example.invalid/image','https://example.invalid/item','upper_body' from generate_series(1,10000) n;
insert into public.product_attributes(product_id,colors,subcategory,fit,brand_slug,price_band)
select id,array['blue'],'tisort','regular','fixture','mid' from public.products where id like 'v2-bench-%';
insert into public.user_events(event_id,user_id,session_id,event_type,product_id,payload,created_at)
select md5('v2-legacy-'||n)::uuid,'00000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000001','like','fixture-2','{"color":"red"}',now()-n*interval '1 second'
from generate_series(1,10000) n;
create temp table v2_preserved_legacy as select to_jsonb(e) as row from public.user_events e;
create temp table v2_timings(scenario text,path text,sample integer,ms numeric);
create temp table v2_plans(scenario text,plan jsonb);
do $$
declare scenario text; path text; n integer; sample integer; started timestamptz;
 result jsonb; action uuid; query_text text; query_plan jsonb; expected_count integer;
begin
 execute style_bench.candidate_definition();
 foreach scenario in array array['distinct_products','repeated_eight_products'] loop
  delete from public.style_preference_actions;
  delete from public.user_events where payload ? 'action_id';
  insert into public.style_preference_actions(user_id,action_id,product_id,kind,event_ids,revokes,request,committed_at)
  select '00000000-0000-4000-8000-000000000001',md5('v2-action-'||i)::uuid,
    case when scenario='distinct_products' then 'v2-bench-'||i else 'fixture-'||(i%8+1) end,
    'favorite',array[md5('v2-like-'||i)::uuid,md5('v2-wardrobe-'||i)::uuid],
    case when scenario='repeated_eight_products' and i>8 then array[md5('v2-action-'||(i-8))::uuid] else '{}'::uuid[] end,
    '{}',now()-i*interval '1 second'
  from generate_series(1,10000) i;
  insert into public.user_events(event_id,user_id,session_id,event_type,product_id,payload,created_at)
  select a.event_ids[j],a.user_id,'20000000-0000-4000-8000-000000000001',
   case j when 1 then 'like' else 'dolap_add' end,a.product_id,
   jsonb_build_object('action_id',a.action_id,'action_version',2,'outcome','committed'),a.committed_at
  from public.style_preference_actions a cross join generate_series(1,2) j;
  analyze public.style_preference_actions;analyze public.user_events;
  query_text:=split_part(split_part(pg_get_functiondef('public.style_profile_events_v2(uuid,text)'::regprocedure),'return query',2),'end;',1);
  query_text:=replace(query_text,'p_user_id',quote_literal('00000000-0000-4000-8000-000000000001')||'::uuid');
  query_text:=replace(query_text,'p_legacy_policy',quote_literal('exclude_with_approval')||'::text');
  execute 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '||query_text into query_plan;
  insert into v2_plans values(scenario,query_plan);
  foreach path in array array['v1_baseline','v1_patched','v2_exclude'] loop
   if path='v2_exclude' then
    update public.recs_config set value='{"algorithm":"style-preference-v2","legacy_policy":"exclude_with_approval"}' where key='style_profile_v2';
   else
    update public.recs_config set value='{"algorithm":"v1"}' where key='style_profile_v2';
   end if;
   for n in 1..3 loop
    if path='v1_baseline' then perform style_bench.baseline_recompute(auth.uid());else perform public.recompute_profile(auth.uid());end if;
   end loop;
   for sample in 1..20 loop
    started:=clock_timestamp();
    if path='v1_baseline' then perform style_bench.baseline_recompute(auth.uid());else perform public.recompute_profile(auth.uid());end if;
    insert into v2_timings values(scenario,path,sample,extract(epoch from clock_timestamp()-started)*1000);
   end loop;
   if path='v2_exclude' then
    expected_count:=case scenario when 'distinct_products' then 1000 else 8 end;
    perform style_test.ok((select event_count=expected_count from public.user_style_profiles where user_id=auth.uid()),'V2_BENCH_CANONICAL_COUNT_'||upper(scenario));
   end if;
  end loop;
  -- Actual successful RPC includes advisory/row work, canonical update and recompute.
  for sample in 1..20 loop
   action:=md5('v2-rpc-'||scenario||'-'||sample)::uuid;
   started:=clock_timestamp();
   result:=public.style_apply_preference_v2(action,'favorite','fixture-1',
    '20000000-0000-4000-8000-000000000001',null,'{"id":"fixture-1"}');
   insert into v2_timings values(scenario,'rpc_commit',sample,extract(epoch from clock_timestamp()-started)*1000);
   perform style_test.ok(result->>'replayed'='false','V2_BENCH_RPC_COMMIT');
   started:=clock_timestamp();
   result:=public.style_apply_preference_v2(action,'favorite','fixture-1',
    '20000000-0000-4000-8000-000000000001',null,'{"id":"fixture-1"}');
   insert into v2_timings values(scenario,'rpc_replay',sample,extract(epoch from clock_timestamp()-started)*1000);
   perform style_test.ok(result->>'replayed'='true','V2_BENCH_RPC_REPLAY');
  end loop;
 end loop;
 perform style_test.ok((select count(*)=10000 from public.user_events e join v2_preserved_legacy p on to_jsonb(e)=p.row),'V2_BENCH_LEGACY_ROWS_PRESERVED');
end; $$;
select scenario,path,count(*) as samples,round(avg(ms),3) as mean_ms,
 round(percentile_cont(0.95) within group(order by ms)::numeric,3) as p95_ms,
 round(max(ms),3) as max_ms from v2_timings group by scenario,path order by scenario,path;
select scenario,plan from v2_plans order by scenario;
rollback;

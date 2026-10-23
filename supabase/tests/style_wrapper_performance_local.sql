-- Isolated synthetic PostgreSQL fixture ONLY. All benchmark data rolls back.
begin;
delete from public.recs_config where key in ('style_profile_v2','style_preference_writer_v2');
select style_test.claim('A');
delete from public.user_events;
delete from public.style_preference_actions;
insert into public.user_events(event_id,user_id,session_id,event_type,product_id,payload,created_at)
select md5('bench-event-'||n)::uuid,'00000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000001','like','fixture-'||(n%8+1),'{}',now()-n*interval '1 second'
from generate_series(1,10000) n;
analyze public.user_events;
create temp table wrapper_measurements(label text,round integer,baseline_ms numeric,wrapper_ms numeric);
create temp table wrapper_plans(label text,plan jsonb);
do $$
#variable_conflict use_variable
declare label text; r integer; i integer; t timestamptz; b numeric; w numeric; old_result jsonb; new_result jsonb;
 query_text text; query_plan jsonb;
begin
  foreach label in array array['ledger_empty','ledger_10000','ledger_action_ids','previous_scalar_action_ids','optimized_action_ids','optimized_no_action_ids','optimized_order_index'] loop
    if label='ledger_10000' then
      insert into public.style_preference_actions(user_id,action_id,product_id,kind,event_ids,revokes,request)
      select '00000000-0000-4000-8000-000000000001',md5('bench-action-'||n)::uuid,
       'fixture-'||(n%8+1),'favorite',array[md5('bench-source-'||n)::uuid],'{}','{}'
      from generate_series(1,10000) n;
      analyze public.style_preference_actions;
    end if;
    if label='ledger_action_ids' then
      update public.user_events set payload=jsonb_build_object('action_id',md5(event_id::text)::uuid);
    end if;
    if label='previous_scalar_action_ids' then
      -- This candidate replaces one local helper, never the production package.
      execute replace(pg_get_functiondef('public.recompute_profile_v1(uuid)'::regprocedure),
        'public.recompute_profile_v1(', 'style_bench.previous_v1(');
      execute style_bench.previous_scalar_definition();
    end if;
    if label='optimized_action_ids' then
      execute style_bench.candidate_definition();
    end if;
    if label='optimized_no_action_ids' then
      update public.user_events set payload='{}';
    end if;
    if label='optimized_order_index' then
      update public.user_events set payload=jsonb_build_object('action_id',md5(event_id::text)::uuid);
      create index style_bench_event_order on public.user_events(user_id,created_at desc,event_id desc);
      analyze public.user_events;
    end if;
    old_result:=style_test.baseline_recompute('00000000-0000-4000-8000-000000000001');
    new_result:=public.recompute_profile('00000000-0000-4000-8000-000000000001');
    perform style_test.ok(old_result=new_result,'WRAPPER_RESULT_'||upper(label));
    for i in 1..3 loop
      perform style_test.baseline_recompute('00000000-0000-4000-8000-000000000001');
      perform public.recompute_profile('00000000-0000-4000-8000-000000000001');
    end loop;
    query_text:=split_part(split_part(pg_get_functiondef('public.recompute_profile_v1(uuid)'::regprocedure),'for v_event in',2),'loop',1);
    query_text:=replace(query_text,'p_user_id',quote_literal('00000000-0000-4000-8000-000000000001')||'::uuid');
    query_text:=replace(query_text,'v_weights',quote_literal(public.recs_config_value('event_weights')::text)||'::jsonb');
    execute 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '||query_text into query_plan;
    insert into wrapper_plans values(label,query_plan);
    query_text:=split_part(split_part(pg_get_functiondef('style_bench.baseline_recompute(uuid)'::regprocedure),'for v_event in',2),'loop',1);
    query_text:=replace(query_text,'p_user_id',quote_literal('00000000-0000-4000-8000-000000000001')||'::uuid');
    query_text:=replace(query_text,'v_weights',quote_literal(public.recs_config_value('event_weights')::text)||'::jsonb');
    execute 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '||query_text into query_plan;
    insert into wrapper_plans values(label||'_baseline',query_plan);
    for r in 1..5 loop
     for i in 1..20 loop
      -- Individual call timings; alternate order, same transaction/fixtures.
      if r%2=1 then
        t:=clock_timestamp();perform style_test.baseline_recompute('00000000-0000-4000-8000-000000000001');b:=extract(epoch from clock_timestamp()-t)*1000;
        t:=clock_timestamp();perform public.recompute_profile('00000000-0000-4000-8000-000000000001');w:=extract(epoch from clock_timestamp()-t)*1000;
      else
        t:=clock_timestamp();perform public.recompute_profile('00000000-0000-4000-8000-000000000001');w:=extract(epoch from clock_timestamp()-t)*1000;
        t:=clock_timestamp();perform style_test.baseline_recompute('00000000-0000-4000-8000-000000000001');b:=extract(epoch from clock_timestamp()-t)*1000;
      end if;
      insert into wrapper_measurements values(label,r,b,w);
     end loop;
    end loop;
    perform style_test.ok((select count(*)=100 from wrapper_measurements m where m.label=label),'SAMPLES_100_PER_PATH_'||upper(label));
  end loop;
end;
$$;
-- Compare the original mirror semantics with the candidate for real mirrors,
-- registered source events, uppercase IDs and invalid/non-string metadata.
update public.user_events set payload=jsonb_build_object('action_id',md5('bench-action-1')::uuid)
 where event_id=md5('bench-event-1')::uuid;
update public.user_events set event_id=md5('bench-source-2')::uuid,
 payload=jsonb_build_object('action_id',md5('bench-action-2')::uuid)
 where event_id=md5('bench-event-2')::uuid;
update public.user_events set payload=jsonb_build_object('action_id',upper(md5('bench-action-3')::uuid::text))
 where event_id=md5('bench-event-3')::uuid;
update public.user_events set payload='{"action_id":"not-a-uuid"}' where event_id=md5('bench-event-4')::uuid;
update public.user_events set payload='{"action_id":123}' where event_id=md5('bench-event-5')::uuid;
update public.user_events set payload=jsonb_build_object('action_id','{'||md5('bench-action-6')::uuid::text||'}') where event_id=md5('bench-event-6')::uuid;
update public.user_events set payload=jsonb_build_object('action_id',replace(md5('bench-action-7')::uuid::text,'-','')) where event_id=md5('bench-event-7')::uuid;
update public.user_events set payload='{"action_id":null}' where event_id=md5('bench-event-8')::uuid;
update public.user_events set payload='{"action_id":[]}' where event_id=md5('bench-event-9')::uuid;
do $$ declare before_row jsonb; after_row jsonb;
begin
 perform style_bench.previous_v1('00000000-0000-4000-8000-000000000001');
 select to_jsonb(p)-'computed_at'-'updated_at' into before_row from public.user_style_profiles p where user_id='00000000-0000-4000-8000-000000000001';
 perform public.recompute_profile('00000000-0000-4000-8000-000000000001');
 select to_jsonb(p)-'computed_at'-'updated_at' into after_row from public.user_style_profiles p where user_id='00000000-0000-4000-8000-000000000001';
 perform style_test.ok(before_row=after_row,'CANDIDATE_MIRROR_CANONICAL_INVALID_CASE_EQUIVALENCE');
end; $$;
-- More than 1000 newest mirrors must not truncate the surviving history.
delete from public.user_events;
insert into public.user_events(event_id,user_id,session_id,event_type,product_id,payload,created_at)
select md5('bench-boundary-'||n)::uuid,'00000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000001','like','fixture-'||(n%8+1),
 case when n<=1500 then jsonb_build_object('action_id',md5('bench-action-'||n)::uuid) else '{}'::jsonb end,
 now()-n*interval '1 second' from generate_series(1,10000) n;
do $$ declare before_row jsonb; after_row jsonb;
begin
 perform style_bench.previous_v1('00000000-0000-4000-8000-000000000001');
 select to_jsonb(p)-'computed_at'-'updated_at' into before_row from public.user_style_profiles p where user_id=auth.uid();
 perform public.recompute_profile('00000000-0000-4000-8000-000000000001');
 select to_jsonb(p)-'computed_at'-'updated_at' into after_row from public.user_style_profiles p where user_id=auth.uid();
 perform style_test.ok(before_row=after_row,'CANDIDATE_1500_NEWEST_MIRRORS_EQUIVALENCE');
 perform style_test.ok((after_row->>'event_count')::integer=1000,'CANDIDATE_NO_PREMATURE_1000_LIMIT');
end; $$;
select 'LOCAL_ONLY_NOT_ANDROID' as scope,label,round(avg(baseline_ms),3) as baseline_ms,
 round(avg(wrapper_ms),3) as wrapper_ms,
 round(percentile_cont(0.95) within group(order by baseline_ms)::numeric,3) as baseline_p95_ms,
 round(percentile_cont(0.95) within group(order by wrapper_ms)::numeric,3) as wrapper_p95_ms,
 round((avg(wrapper_ms)/avg(baseline_ms)-1)*100,2) as delta_percent
from wrapper_measurements group by label order by label;
select label,plan from wrapper_plans order by label;
rollback;

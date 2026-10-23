-- Existing disposable PostgreSQL runner only; synthetic claims are NOT real JWT evidence.
create temp table activation_saved_config as select * from public.recs_config where key in ('style_preference_writer_v2','style_profile_v2');
create temp table activation_saved_rows as
 select 'events' as source,to_jsonb(e) as data from public.user_events e
 union all select 'ledger',to_jsonb(a) from public.style_preference_actions a
 union all select 'likes',to_jsonb(l) from public.liked_products l
 union all select 'passes',to_jsonb(p) from public.passed_products p
 union all select 'profiles',to_jsonb(s) from public.user_style_profiles s;
delete from public.recs_config where key in ('style_preference_writer_v2','style_profile_v2');
\ir ../../reports/backend/proposals/20261013_style_v2_activate_writer.sql
select style_test.ok((select value->'enabled'='true'::jsonb from public.recs_config where key='style_preference_writer_v2'),'ACTIVATION_GLOBAL_WRITER_ON');
\ir ../../reports/backend/proposals/20261013_style_v2_activate_profile.sql
select style_test.ok(not has_table_privilege('authenticated','public.liked_products','INSERT') and has_table_privilege('authenticated','public.liked_products','SELECT'),'ACTIVATION_DIRECT_WRITES_CLOSED_READS_PRESERVED');
select style_test.ok((select value->>'legacy_policy'='exclude_with_approval' and (value->>'activated_at')::timestamptz<=clock_timestamp() from public.recs_config where key='style_profile_v2'),'ACTIVATION_DB_CLOCK_EXCLUDE');
do $$ declare current_rows jsonb; saved_rows jsonb; begin
 select jsonb_agg(to_jsonb(x) order by source,data::text) into saved_rows from activation_saved_rows x;
 select jsonb_agg(to_jsonb(x) order by source,data::text) into current_rows from (
  select 'events' as source,to_jsonb(e) as data from public.user_events e
  union all select 'ledger',to_jsonb(a) from public.style_preference_actions a
  union all select 'likes',to_jsonb(l) from public.liked_products l
  union all select 'passes',to_jsonb(p) from public.passed_products p
  union all select 'profiles',to_jsonb(s) from public.user_style_profiles s) x;
 perform style_test.ok(saved_rows is not distinct from current_rows,'ACTIVATION_ALL_USER_ROWS_UNCHANGED');
end $$;
begin;
-- Isolate this synthetic owner's prior fixture actions inside a rollback-only transaction.
-- Its raw legacy events remain, demonstrating that exclude_with_approval ignores them.
delete from public.liked_products where user_id='00000000-0000-4000-8000-000000000003';
delete from public.passed_products where user_id='00000000-0000-4000-8000-000000000003';
delete from public.style_preference_actions where user_id='00000000-0000-4000-8000-000000000003';
set local role authenticated;
select style_test.claim('C');
select style_test.denied('delete from public.liked_products','permission denied','ACTIVATION_DIRECT_DELETE_REJECTED');
select public.style_apply_preference_v2('90000000-0000-4000-8000-000000000001','favorite','fixture-1','20000000-0000-4000-8000-000000000001',null,'{"id":"fixture-1"}');
select style_test.ok((select event_count=1 from public.user_style_profiles where user_id=auth.uid()),'ACTIVATION_RPC_WORKS_WITHOUT_DIRECT_GRANTS');
select style_test.ok(public.style_apply_preference_v2('90000000-0000-4000-8000-000000000001','favorite','fixture-1','20000000-0000-4000-8000-000000000001',null,'{"id":"fixture-1"}')->>'replayed'='true','ACTIVATION_REPLAY');
select public.style_apply_preference_v2('90000000-0000-4000-8000-000000000002','unlike','fixture-1','20000000-0000-4000-8000-000000000001',array['90000000-0000-4000-8000-000000000001']::uuid[]);
select style_test.ok((select event_count=0 from public.user_style_profiles where user_id=auth.uid()),'ACTIVATION_EXACT_UNDO');
rollback;
\ir ../../reports/backend/proposals/20261013_style_v2_activate_pause.sql
select style_test.ok((select value->'enabled'='false'::jsonb from public.recs_config where key='style_preference_writer_v2'),'ACTIVATION_PAUSE_OFF');
-- Restore only this disposable harness baseline for its existing subsequent tests.
delete from public.recs_config where key in ('style_preference_writer_v2','style_profile_v2');
insert into public.recs_config select * from activation_saved_config;
grant select,insert,update,delete on public.liked_products,public.passed_products to authenticated;

-- Existing isolated runner only; synthetic claims, not verified JWTs or Storage.
begin;
select style_test.ok(not exists(select 1 from pg_constraint where conrelid='public.discover_recommendation_job_payloads'::regclass and contype='f' and confrelid in ('auth.users'::regclass,'public.users'::regclass)),'PAYLOAD_REAL_COMPOSITE_NOT_DIRECT_FK');
insert into public.discover_recommendation_jobs(id,owner_id) values('77777777-7777-4777-8777-777777777777','00000000-0000-4000-8000-000000000001');
insert into public.discover_recommendation_job_payloads(job_id,owner_id,request_payload) values('77777777-7777-4777-8777-777777777777','00000000-0000-4000-8000-000000000001','synthetic');
do $$ begin
 begin
  update public.discover_recommendation_job_payloads set owner_id='00000000-0000-4000-8000-000000000002' where job_id='77777777-7777-4777-8777-777777777777';
  raise exception 'Expected owner FK failure';
 exception when foreign_key_violation then null; end;
 perform style_test.ok(true,'PAYLOAD_COMPOSITE_FOREIGN_OWNER_DENIED');
end $$;
select style_test.ok((public.deletion_readiness()->>'ready')::boolean,'A1_REAL_READINESS');
select style_test.ok(not (public.deletion_readiness()->>'writerCoverage')::boolean,'NO_FALSE_WRITER_ATTESTATION');
select style_test.ok(not has_function_privilege('authenticated','public.deletion_is_fenced(uuid)','EXECUTE'),'FENCE_SERVICE_ONLY');
select style_test.ok(not has_function_privilege('anon','public.deletion_prune_tombstones(boolean)','EXECUTE'),'RETENTION_SERVICE_ONLY');
select style_test.ok((select count(*)=3 from deletion_private.owner_gates),'EXISTING_OWNERS_SEEDED');
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000004','synthetic-new@fixture.invalid');
select style_test.ok(exists(select 1 from deletion_private.owner_gates where subject='00000000-0000-4000-8000-000000000004' and not fenced),'NEW_AUTH_OWNER_SEEDED');
select style_test.ok(exists(select 1 from public.users where id='00000000-0000-4000-8000-000000000004'),'EXISTING_SIGNUP_TRIGGER_PRESERVED');
select style_test.ok(not exists(select 1 from pg_trigger where tgfoid='deletion_private.block_owned_write()'::regprocedure and (tgtype & 8)<>0),'FENCE_NEVER_BLOCKS_DELETE_CASCADE');
set local role authenticated;
select style_test.claim('A');
select style_test.ok(public.wardrobe_apply_change(auth.uid(),'item','11111111-1111-4111-8111-111111111111',null,
 jsonb_build_object('title','Original','imageUrl','','imageStoragePath',auth.uid()::text||'/11111111-1111-4111-8111-111111111111/original-22222222-2222-4222-8222-222222222222.png','category','upper_body','brand','','createdAt',clock_timestamp()))='applied','ORIGINAL_PATH_PERSISTED');
select style_test.ok(public.wardrobe_cloud_snapshot(auth.uid())->'items'->0->>'imageStoragePath' like '%/original-%','SNAPSHOT_RETURNS_PATH');
select style_test.ok(public.wardrobe_cloud_snapshot(auth.uid())->'items'->0->>'imageUrl'='','NO_SIGNED_OR_LOCAL_URL_IN_DB');
select style_test.ok(public.wardrobe_apply_change(auth.uid(),'item','11111111-1111-4111-8111-111111111111',null,'{}')='conflict','CAS_STALE_VERSION_REJECTED');
select style_test.ok((public.storage_upload_admit('wardrobe-cutouts',auth.uid()::text||'/11111111-1111-4111-8111-111111111111/original-22222222-2222-4222-8222-222222222222.png','original-request'))->>'owner'=auth.uid()::text,'ORIGINAL_ADMISSION_OWNER_BOUND');
select style_test.claim('B');
select style_test.ok(jsonb_array_length(public.wardrobe_cloud_snapshot(auth.uid())->'items')=0,'PHOTO_RLS_OTHER_OWNER_EMPTY');
select style_test.denied($command$select public.wardrobe_apply_change(auth.uid(),'item','33333333-3333-4333-8333-333333333333',null,
 '{"title":"Foreign","imageUrl":"","imageStoragePath":"00000000-0000-4000-8000-000000000001/33333333-3333-4333-8333-333333333333/original-22222222-2222-4222-8222-222222222222.png","category":"upper_body","brand":"","createdAt":"2026-10-14T00:00:00Z"}')$command$,'Persistent remote','FOREIGN_PATH_DENIED');
reset role;
do $$ begin
 perform style_test.claim('A');
 begin
  perform public.wardrobe_apply_change(auth.uid(),'outfit','44444444-4444-4444-8444-444444444444',null,
   '{"title":"Rollback","createdAt":"2026-10-14T00:00:00Z","wardrobeItemIds":["11111111-1111-4111-8111-111111111111"],"catalogProductIds":["missing-fixture"]}');
  raise exception 'Expected FK failure';
 exception when foreign_key_violation then null; end;
 perform style_test.ok(not exists(select 1 from public.outfits where id='44444444-4444-4444-8444-444444444444'),'OUTFIT_FAILURE_FULL_ROLLBACK');
end $$;
do $$ declare lease jsonb; begin
 lease:=public.deletion_begin('00000000-0000-4000-8000-000000000001','deletion-synthetic',repeat('a',64));
 perform style_test.ok((lease->>'drain_remaining_ms')::integer>0,'DB_CLOCK_DRAIN');
 perform style_test.ok(public.deletion_is_fenced('00000000-0000-4000-8000-000000000001'),'DURABLE_FENCE');
 perform style_test.denied($command$select public.deletion_begin(null,'deletion-synthetic',repeat('a',64))$command$,'lease_held_by_other','CONCURRENT_LEASE_DENIED');
 perform style_test.denied($command$insert into public.style_preference_actions(user_id,action_id,kind,product_id,event_ids,request) values('00000000-0000-4000-8000-000000000001','55555555-5555-4555-8555-555555555555','favorite','fixture-1',array['55555555-5555-4555-8555-555555555555']::uuid[],'{}')$command$,'fenced','FENCED_LEDGER_DENIED');
end $$;
-- Real SQL CASCADE; not a Supabase Auth deleteUser/owner test.
delete from auth.users where id='00000000-0000-4000-8000-000000000001';
select style_test.ok(not exists(select 1 from public.discover_recommendation_jobs where owner_id='00000000-0000-4000-8000-000000000001') and not exists(select 1 from public.discover_recommendation_job_payloads where owner_id='00000000-0000-4000-8000-000000000001'),'AUTH_JOBS_PAYLOAD_CASCADE_CHAIN');
select style_test.ok(not exists(select 1 from public.wardrobe_items where user_id='00000000-0000-4000-8000-000000000001'),'AUTH_CASCADE_PHOTO_ROWS');
select style_test.ok(not exists(select 1 from public.style_preference_actions where user_id='00000000-0000-4000-8000-000000000001'),'AUTH_CASCADE_LEDGER');
select style_test.ok(exists(select 1 from deletion_private.owner_gates where subject='00000000-0000-4000-8000-000000000001') and exists(select 1 from deletion_private.receipts where subject='00000000-0000-4000-8000-000000000001'),'TOMBSTONES_SURVIVE');
rollback;
select style_test.ok((select count(*)=3 from auth.users),'SYNTHETIC_TEST_ROWS_ROLLED_BACK');

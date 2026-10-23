-- Local PostgreSQL 17 minimal-fixture run PASS: reports/backend/a1-sql20-local-evidence.txt.
-- Staging NOT RUN. Requires independently proven disposable target and migration 20.
-- Run only against disposable staging fixtures, as independent schema owner.
-- No gate activation, physical Storage call or Auth deletion. Always rollback.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create function pg_temp.a1_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL %',label; end if; raise notice 'PASS %',label; end $$;
create function pg_temp.a1_denied(command text,expected_message text,expected_state text default null) returns void language plpgsql as $$
declare denied boolean:=false;
begin
 begin execute command;
 exception when others then
   if (expected_message is not null and sqlerrm<>expected_message) or (expected_state is not null and sqlstate<>expected_state) then raise; end if;
   denied:=true;
 end;
 perform pg_temp.a1_assert(denied,'expected rejection');
end $$;
do $$ begin
 if to_regprocedure('public.storage_upload_status(text)') is null or
    to_regprocedure('public.storage_upload_cancel_before_dispatch(uuid,uuid,text)') is null then
   raise exception 'Required draft is not installed'; end if;
 if has_function_privilege('anon','public.storage_upload_status(text)','EXECUTE') or
    has_function_privilege('authenticated','public.storage_upload_cancel_before_dispatch(uuid,uuid,text)','EXECUTE') or
    has_table_privilege('authenticated','deletion_private.storage_resolutions','SELECT') then
   raise exception 'ACL boundary failed'; end if;
 if not exists(select 1 from pg_class where oid='deletion_private.storage_resolutions'::regclass and relrowsecurity) then
   raise exception 'Resolution RLS missing'; end if;
end $$;
-- Fixed synthetic owners must not exist in Auth or owner_gates: fail instead of reusing live data.
do $$ begin
 if exists(select 1 from auth.users where id in ('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002')) or
    exists(select 1 from deletion_private.owner_gates where subject in ('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002')) then
   raise exception 'Disposable fixture collision'; end if;
end $$;
insert into deletion_private.owner_gates(subject,fenced) values ('a1000000-0000-4000-8000-000000000001',false);
insert into deletion_private.storage_operations(operation,subject,request,bucket,path,state,dispatch_started,legacy_record) values
 ('a1000000-0000-4000-8000-000000000011','a1000000-0000-4000-8000-000000000001','a1-never-dispatched','model-photos','a1000000-0000-4000-8000-000000000001/never.jpg','ADMITTED',false,false),
 ('a1000000-0000-4000-8000-000000000012','a1000000-0000-4000-8000-000000000001','a1-started','model-photos','a1000000-0000-4000-8000-000000000001/started.jpg','UNKNOWN',true,false),
 ('a1000000-0000-4000-8000-000000000013','a1000000-0000-4000-8000-000000000001','a1-legacy','model-photos','a1000000-0000-4000-8000-000000000001/legacy.jpg','UNKNOWN',false,true);
select public.storage_upload_cancel_before_dispatch('a1000000-0000-4000-8000-000000000011','a1000000-0000-4000-8000-000000000001','a1-never-dispatched');
do $$ declare item record; denied boolean; begin
 for item in select operation,request from deletion_private.storage_operations where request in ('a1-started','a1-legacy') loop
   denied:=false;
   begin perform public.storage_upload_cancel_before_dispatch(item.operation,'a1000000-0000-4000-8000-000000000001',item.request);
   exception when others then
     if sqlerrm <> 'No-dispatch proof unavailable' then raise; end if;
     denied:=true;
   end;
   if not denied then raise exception 'Ambiguous dispatch incorrectly resolved'; end if;
 end loop;
end $$;
do $$ declare op deletion_private.storage_operations; denied boolean:=false; begin
 select * into op from deletion_private.storage_operations where request='a1-never-dispatched';
 begin perform public.storage_upload_start(op.operation,op.lease,op.subject,op.bucket,op.path);
 exception when others then
   if sqlerrm <> 'Upload unavailable or consumed' then raise; end if;
   denied:=true;
 end;
 if not denied then raise exception 'Revoked operation allowed dispatch'; end if;
end $$;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ begin
 if (public.storage_upload_status('a1-never-dispatched')->>'state') is distinct from 'REJECTED_NO_DISPATCH' or
    (public.storage_upload_status('a1-started')->>'state') is distinct from 'UNKNOWN' or
    (public.storage_upload_status('a1-legacy')->>'state') is distinct from 'UNKNOWN' then
   raise exception 'Reconciliation decision incorrect'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ begin if public.storage_upload_status('a1-never-dispatched') is not null then raise exception 'Foreign request exposed'; end if; end $$;
reset role;
-- New fixtures are fake Auth users and rollback with the whole test. No DELETE,
-- HTTP, Storage bytes, readiness mutation or successful deletion begin is used.
insert into auth.users(id) values ('a1000000-0000-4000-8000-000000000001'),('a1000000-0000-4000-8000-000000000002');
insert into deletion_private.owner_gates(subject,fenced) values ('a1000000-0000-4000-8000-000000000002',false) on conflict(subject) do nothing;

-- Missing certificate must count as unresolved (SQL NULL regression); an expired
-- ADMITTED/UNKNOWN ticket is not terminal evidence. B's rows never enter A census.
insert into deletion_private.storage_operations(operation,subject,request,bucket,path,state,dispatch_started,expires_at) values
 ('a1000000-0000-4000-8000-000000000014','a1000000-0000-4000-8000-000000000001','a1-expired','model-photos','a1000000-0000-4000-8000-000000000001/expired.jpg','UNKNOWN',false,clock_timestamp()-interval '1 hour'),
 ('a1000000-0000-4000-8000-000000000015','a1000000-0000-4000-8000-000000000002','a1-b-unknown','model-photos','a1000000-0000-4000-8000-000000000002/b.jpg','UNKNOWN',true,clock_timestamp()-interval '1 hour'),
 ('a1000000-0000-4000-8000-000000000016','a1000000-0000-4000-8000-000000000001','a1-start-wins','model-photos','a1000000-0000-4000-8000-000000000001/start-wins.jpg','ADMITTED',false,clock_timestamp()+interval '1 hour'),
 ('a1000000-0000-4000-8000-000000000017','a1000000-0000-4000-8000-000000000001','a1-expired-start','model-photos','a1000000-0000-4000-8000-000000000001/expired-start.jpg','ADMITTED',false,clock_timestamp()-interval '1 hour');
do $$ declare op deletion_private.storage_operations; begin
 select * into op from deletion_private.storage_operations where request='a1-start-wins';
 perform pg_temp.a1_assert(public.storage_upload_start(op.operation,op.lease,op.subject,op.bucket,op.path),'start-first dispatch allowed once');
 perform pg_temp.a1_denied(format('select public.storage_upload_cancel_before_dispatch(%L,%L,%L)',op.operation,op.subject,op.request),'No-dispatch proof unavailable');
 perform pg_temp.a1_denied(format('select public.storage_upload_start(%L,%L,%L,%L,%L)',op.operation,op.lease,op.subject,op.bucket,op.path),'Upload unavailable or consumed');
 select * into op from deletion_private.storage_operations where request='a1-expired-start';
 perform pg_temp.a1_assert(public.storage_upload_start(op.operation,op.lease,op.subject,op.bucket,op.path)=false,'expired start never dispatches');
 perform pg_temp.a1_assert((select state='UNKNOWN' and not dispatch_started from deletion_private.storage_operations where operation=op.operation),'expired start remains UNKNOWN');
 perform pg_temp.a1_denied(format('select public.storage_upload_cancel_before_dispatch(%L,%L,%L)',op.operation,'a1000000-0000-4000-8000-000000000002',op.request),'No-dispatch proof unavailable');
end $$;

-- Replay cancellation rolls back its entire statement, including its row update.
select pg_temp.a1_denied($q$select public.storage_upload_cancel_before_dispatch('a1000000-0000-4000-8000-000000000011','a1000000-0000-4000-8000-000000000001','a1-never-dispatched')$q$,null,'23505');
select pg_temp.a1_assert((select count(*)=1 from deletion_private.storage_resolutions),'duplicate cancel has no extra certificate');

-- Service-only provider journal: lease/owner/request binding, no replay with a
-- fresh request, late observation after fencing is not retention/drain proof.
create temporary table a1_provider_fixture(op jsonb);
grant select,insert on a1_provider_fixture to service_role;
set local role service_role;
insert into a1_provider_fixture select public.provider_dispatch_admit('a1000000-0000-4000-8000-000000000001','fashn','a1-provider');
select pg_temp.a1_denied($q$select public.provider_dispatch_admit('a1000000-0000-4000-8000-000000000001','fashn','a1-provider-new')$q$,'Provider dispatch unresolved');
do $$ declare op jsonb; begin
 select f.op into op from a1_provider_fixture f;
 perform pg_temp.a1_denied(format('select public.provider_dispatch_start(%L,%L,%L,%L,%L)',op->>'operation','a1000000-0000-4000-8000-000000000099',op->>'owner','fashn','a1-provider'),'Provider dispatch consumed or unavailable');
 perform pg_temp.a1_denied(format('select public.provider_dispatch_start(%L,%L,%L,%L,%L)',op->>'operation',op->>'lease','a1000000-0000-4000-8000-000000000002','fashn','a1-provider'),'Provider dispatch consumed or unavailable');
 perform pg_temp.a1_assert(public.provider_dispatch_start((op->>'operation')::uuid,(op->>'lease')::uuid,(op->>'owner')::uuid,'fashn','a1-provider'),'provider start commits UNKNOWN');
 perform pg_temp.a1_denied(format('select public.provider_dispatch_start(%L,%L,%L,%L,%L)',op->>'operation',op->>'lease',op->>'owner','fashn','a1-provider'),'Provider dispatch consumed or unavailable');
 perform pg_temp.a1_denied(format('select public.provider_dispatch_observe(%L,%L,%L,%L,%L,%L)',op->>'operation',op->>'lease',op->>'owner','fashn','wrong-request','fixture-prediction'),'Provider observation unavailable');
end $$;
reset role;
select pg_temp.a1_assert((select state='UNKNOWN' and prediction is null from deletion_private.provider_operations where request='a1-provider'),'provider remains UNKNOWN before observation');
update deletion_private.owner_gates set fenced=true where subject='a1000000-0000-4000-8000-000000000001';
set local role service_role;
do $$ declare op jsonb; begin
 select f.op into op from a1_provider_fixture f;
 perform public.provider_dispatch_observe((op->>'operation')::uuid,(op->>'lease')::uuid,(op->>'owner')::uuid,'fashn','a1-provider','fixture-prediction');
 perform pg_temp.a1_denied($q$select public.provider_dispatch_admit('a1000000-0000-4000-8000-000000000001','fashn','a1-provider-after-fence')$q$,'Account deletion fenced or owner unavailable','42501');
end $$;
reset role;
select pg_temp.a1_assert((select state='OBSERVED' from deletion_private.provider_operations where request='a1-provider'),'late observation accepted without reopening owner');
select pg_temp.a1_assert((select fenced from deletion_private.owner_gates where subject='a1000000-0000-4000-8000-000000000001'),'owner stays fenced');

insert into deletion_private.receipts(subject,request,recovery_hash,receipt,lease,lease_until) values
 ('a1000000-0000-4000-8000-000000000001','a1-snapshot',repeat('0',64),'{}','a1000000-0000-4000-8000-000000000021',clock_timestamp()+interval '1 hour');
set local role service_role;
do $$ declare snapshot jsonb; begin
 snapshot:=public.deletion_storage_barrier_snapshot('a1-snapshot','a1000000-0000-4000-8000-000000000021');
 perform pg_temp.a1_assert(snapshot->>'owner'='a1000000-0000-4000-8000-000000000001' and (snapshot->>'fenced')::boolean,'snapshot identity/fence');
 perform pg_temp.a1_assert((snapshot->>'unresolved')::int=5 and (snapshot->>'legacyUnresolved')::int=1,'census includes missing certificate/expired/legacy UNKNOWN, excludes B and certificate');
 perform pg_temp.a1_assert(snapshot->'provider'='null'::jsonb and not public.deletion_storage_barrier('a1-snapshot','a1000000-0000-4000-8000-000000000021'),'observation never enables provider barrier');
 perform pg_temp.a1_denied($q$select public.deletion_storage_barrier_snapshot('wrong-request','a1000000-0000-4000-8000-000000000021')$q$,'Lease unavailable');
 perform pg_temp.a1_denied($q$select public.deletion_storage_barrier_snapshot('a1-snapshot','a1000000-0000-4000-8000-000000000099')$q$,'Lease unavailable');
end $$;
reset role;
update deletion_private.receipts set lease_until=clock_timestamp()-interval '1 hour' where request='a1-snapshot';
set local role service_role;
select pg_temp.a1_denied($q$select public.deletion_storage_barrier_snapshot('a1-snapshot','a1000000-0000-4000-8000-000000000021')$q$,'Lease unavailable');
reset role;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.a1_assert(public.storage_upload_status('a1-expired')->>'state'='UNKNOWN','expiry is not no-dispatch certificate');
select pg_temp.a1_assert(public.storage_upload_status('missing') is null,'missing request never becomes rejection');
select pg_temp.a1_denied($q$select public.provider_dispatch_admit('a1000000-0000-4000-8000-000000000001','fashn','a1-client')$q$,null,'42501');
select pg_temp.a1_denied($q$select public.deletion_storage_barrier_snapshot('a1-snapshot','a1000000-0000-4000-8000-000000000021')$q$,null,'42501');
select pg_temp.a1_denied($q$select * from deletion_private.provider_operations$q$,null,'42501');
reset role;
set local role anon;
select pg_temp.a1_denied($q$select public.storage_upload_status('a1-expired')$q$,null,'42501');
reset role;
rollback;

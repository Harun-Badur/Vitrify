-- Synthetic local cluster ONLY. No external identities or real purchases.
-- Auth/A1 fixture bootstrap is supplied by test-premium-local.ps1.
\ir ../rate_limits.sql
\ir ../proposals/premium_v1.sql
insert into auth.users values ('10000000-0000-4000-8000-000000000001'), ('10000000-0000-4000-8000-000000000002');
create function pg_temp.assert(v boolean, label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAIL %',label; end if; raise notice 'PASS %',label;
end$$;
do $$declare o uuid := '10000000-0000-4000-8000-000000000001'; b text; r jsonb; t bigint := (extract(epoch from clock_timestamp())*1000)::bigint;
begin
 b := public.premium_binding(o);
 perform pg_temp.assert(b=public.premium_binding(o),'stable opaque identity');
 perform pg_temp.assert(public.premium_store_snapshot(o,b,'free',null,t,null,null,null),'store free');
 r:=public.premium_vton_reserve(o,'request-1','hash1');
 perform pg_temp.assert((r->>'allowed')::boolean,'free reserve');
 perform pg_temp.assert(not (public.premium_vton_reserve(o,'request-1','hash1')->>'allowed')::boolean,'same request no double dispatch');
 perform pg_temp.assert(not (public.premium_vton_reserve(o,'request-1','changed')->>'allowed')::boolean,'request payload conflict');
 perform public.premium_vton_settle(o,'request-1','not_sent',null);
 perform public.premium_vton_settle(o,'request-1','not_sent',null);
 perform pg_temp.assert((select day_count=0 and minute_count=1 from public.rate_limits where user_id=o),'refund once; retain abuse minute counter');
 perform public.premium_vton_reserve(o,'request-2','hash2');
 perform public.premium_vton_settle(o,'request-2','dispatched',null);
 perform public.premium_vton_settle(o,'request-2','unknown','prediction-2');
 perform pg_temp.assert((select day_count=1 from public.rate_limits where user_id=o),'unknown no refund');
 begin
   perform public.premium_vton_settle(o,'request-2','not_sent',null);
   raise exception 'unexpected refund';
 exception when check_violation then null; end;
 perform public.premium_vton_settle(o,'request-2','failed','prediction-2');
 perform public.premium_vton_settle(o,'request-2','failed','prediction-2');
 perform pg_temp.assert((select day_count=0 from public.rate_limits where user_id=o),'confirmed failure refund once');
 update public.rate_limits set minute_window=now()-interval '2 minutes',day_count=3 where user_id=o;
 perform pg_temp.assert(not (public.premium_vton_reserve(o,'request-3','hash3')->>'allowed')::boolean,'free daily limit');
 perform pg_temp.assert(public.premium_store_snapshot(o,b,'premium',t+3600000,t+1,'txn1','app_store','evt1'),'premium snapshot');
 perform pg_temp.assert((public.premium_vton_reserve(o,'request-3','hash3')->>'allowed')::boolean,'upgrade without reset');
 perform pg_temp.assert((select day_count=4 from public.rate_limits where user_id=o),'upgrade retained counter');
 perform pg_temp.assert(not public.premium_store_snapshot(o,b,'free',null,t,null,null,'old'),'out of order cannot revoke newer snapshot');
 perform pg_temp.assert(public.premium_store_snapshot(o,b,'premium',t+3600000,t+1,'txn1','app_store','evt1'),'duplicate event idempotent');
 perform pg_temp.assert(public.premium_store_snapshot(o,b,'free',null,t+2,null,null,null),'downgrade snapshot');
 perform pg_temp.assert(not (public.premium_vton_reserve(o,'downgrade','hash')->>'allowed')::boolean,'downgrade does not reset daily usage');
 perform pg_temp.assert(public.premium_store_snapshot(o,b,'premium',t+3600000,t+3,'txn1','app_store',null),'restore premium');
 begin
   perform public.premium_store_snapshot('10000000-0000-4000-8000-000000000002',public.premium_binding('10000000-0000-4000-8000-000000000002'),'premium',t+3600000,t+3,'txn1','app_store',null);
   raise exception 'unexpected owner transfer';
 exception when check_violation then null; end;
 perform pg_temp.assert(not exists(select 1 from public.premium_memberships where user_id='10000000-0000-4000-8000-000000000002'),'transaction ownership rejects transfer atomically');
 update public.rate_limits set day_count=20,minute_window=now()-interval '2 minutes' where user_id=o;
 perform pg_temp.assert(not (public.premium_vton_reserve(o,'over20','hash')->>'allowed')::boolean,'premium daily limit is 20');
 perform public.premium_vton_settle(o,'request-3','dispatched',null);
 perform public.premium_vton_settle(o,'request-3','unknown','prediction-3');
 update public.premium_vton_requests set day_window=(now() at time zone 'UTC')::date-1 where user_id=o and request_id='request-3';
 update public.rate_limits set day_window=(now() at time zone 'UTC')::date-1, day_count=20, minute_window=now()-interval '2 minutes' where user_id=o;
 perform public.premium_vton_reserve(o,'new-day','newhash');
 perform public.premium_vton_settle(o,'request-3','failed','prediction-3');
 perform pg_temp.assert((select day_count=1 from public.rate_limits where user_id=o),'old day refund does not credit new day');
 update public.premium_memberships set source_ms=t-120000 where user_id=o;
 perform pg_temp.assert((public.premium_vton_reserve(o,'stale','hash')->>'reason')='membership_unverified','stale snapshot cannot dispatch');
 perform pg_temp.assert(not has_function_privilege('authenticated','public.premium_vton_reserve(uuid,text,text)','execute'),'client cannot consume with spoofed premium');
 perform pg_temp.assert(not has_table_privilege('authenticated','public.premium_memberships','insert'),'client cannot grant membership');
end$$;
-- Reserved synthetic second user for actual concurrent process test.
select public.premium_store_snapshot('10000000-0000-4000-8000-000000000002',public.premium_binding('10000000-0000-4000-8000-000000000002'),'free',null,(extract(epoch from clock_timestamp())*1000)::bigint,null,null,null);

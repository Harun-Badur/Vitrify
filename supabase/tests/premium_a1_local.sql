-- New delta only. Actual A1 gate/lease functions extracted from reviewed source by runner.
\ir ../rate_limits.sql
\ir ../proposals/premium_v1.sql
insert into auth.users values ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
insert into deletion_private.owner_gates(subject,fenced) select id,false from auth.users on conflict do nothing;
create function pg_temp.assert(v boolean,label text) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'FAIL %',label;end if;raise notice 'PASS %',label;end$$;
do $$declare a uuid:='10000000-0000-4000-8000-000000000001';b uuid:='10000000-0000-4000-8000-000000000002';opaque text; token uuid; res jsonb;t bigint:=(extract(epoch from clock_timestamp())*1000)::bigint;
begin
 perform pg_temp.assert((select count(*)=5 from deletion_private.inventory where relation_name like 'premium_%'),'new tables join existing deletion inventory');
 opaque:=public.premium_binding(a);perform public.premium_binding(b);
 perform public.premium_store_snapshot(a,opaque,'free',null,t,null,null,'event');
 insert into public.premium_transactions values('app_store','fixture-txn',a);
 perform public.premium_vton_reserve(a,'reservation','hash');
 res:=public.deletion_begin(a,'delete-request',repeat('a',64));token:=(res->>'lease')::uuid;
 -- All writers must reject even while Auth and the binding still exist.
 begin perform public.premium_binding(a);raise exception 'binding allowed';exception when insufficient_privilege then null;end;
 begin perform public.premium_store_snapshot(a,opaque,'premium',t+600000,t+1,'new-txn','app_store','late');raise exception 'snapshot allowed';exception when insufficient_privilege then null;end;
 begin perform public.premium_vton_reserve(a,'late','hash');raise exception 'quota allowed';exception when insufficient_privilege then null;end;
 begin insert into public.premium_events values('direct',a);raise exception 'direct writer allowed';exception when insufficient_privilege then null;end;
 perform pg_temp.assert(not exists(select 1 from public.premium_events where event_id='late'),'PA1-02 fence rejects atomic late entitlement');
 res:=public.premium_deletion_capture('delete-request',token,null);
 perform pg_temp.assert(res->>'state'='blocked_policy','PA1-05 unresolved retention blocks handoff');
 perform pg_temp.assert((select premium_cleanup is null from deletion_private.receipts where subject=a),'no opaque retention without policy');
 res:=public.premium_deletion_capture('delete-request',token,'vitrify-rc-lifecycle-20261017','fixture-project','sandbox');
 perform pg_temp.assert(res->>'state'='queued','provider method remains pending, no deletion call');
 perform pg_temp.assert((select premium_cleanup->>'appUserId'=opaque from deletion_private.receipts where subject=a),'opaque checkpoint saved privately');
 perform pg_temp.assert(not (res ? 'appUserId'),'opaque identifier never returned in checkpoint result');
 perform public.deletion_save('delete-request',token,jsonb_build_object('subjectId',a,'requestId','delete-request','layers','{}'::jsonb));
 perform public.deletion_release('delete-request',token);
 res:=public.deletion_begin(null,'delete-request',repeat('a',64));token:=(res->>'lease')::uuid;
 perform pg_temp.assert((public.premium_deletion_capture('delete-request',token,'vitrify-rc-lifecycle-20261017','fixture-project','sandbox')->>'state')='queued','same recovery preserves handoff');
 begin perform public.premium_deletion_capture('delete-request',gen_random_uuid(),'vitrify-rc-lifecycle-20261017','fixture-project','sandbox');raise exception 'wrong lease accepted';exception when others then if sqlerrm='wrong lease accepted' then raise;end if;end;
 perform pg_temp.assert(not has_column_privilege('authenticated','deletion_private.receipts','premium_cleanup','select'),'private checkpoint has no client grant');
 delete from auth.users where id=a;
 perform pg_temp.assert(not exists(select 1 from public.premium_identities where user_id=a) and not exists(select 1 from public.premium_memberships where user_id=a) and not exists(select 1 from public.premium_transactions where user_id=a) and not exists(select 1 from public.premium_events where user_id=a) and not exists(select 1 from public.premium_vton_requests where user_id=a) and not exists(select 1 from public.rate_limits where user_id=a),'PA1-01 all six user relations cascade');
 perform pg_temp.assert(exists(select 1 from public.premium_identities where user_id=b),'other owner preserved');
 begin perform public.premium_binding(a);raise exception 'deleted owner recreated';exception when insufficient_privilege then null;end;
 perform pg_temp.assert(not exists(select 1 from public.premium_identities where app_user_id=opaque),'PA1-03 late webhook cannot resolve deleted owner');
 perform pg_temp.assert(not has_function_privilege('authenticated','public.premium_admission(uuid)','execute') and not has_function_privilege('authenticated','public.premium_deletion_capture(text,uuid,text,text,text)','execute'),'new RPCs remain server-only');
end$$;

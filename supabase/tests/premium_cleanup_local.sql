\ir ../rate_limits.sql
\ir ../proposals/premium_v1.sql
\ir ../proposals/premium_cleanup_lifecycle.sql
insert into auth.users values('10000000-0000-4000-8000-000000000001');
create function pg_temp.assert(v boolean) returns void language plpgsql as $$begin if v is distinct from true then raise exception 'FAIL lifecycle';end if;end$$;
do $$declare a uuid:='10000000-0000-4000-8000-000000000001';r jsonb;t uuid;c jsonb;
begin
 perform public.premium_binding(a);
 r:=public.deletion_begin(a,'lifecycle',repeat('a',64));t:=(r->>'lease')::uuid;
 perform pg_temp.assert(public.premium_deletion_capture('lifecycle',t,'vitrify-rc-lifecycle-20261017')->>'state'='blocked_policy');
 r:=public.premium_deletion_capture('lifecycle',t,'vitrify-rc-lifecycle-20261017','fixture-project','sandbox');
 perform pg_temp.assert(r->>'state'='queued');
 begin perform public.premium_cleanup_record('lifecycle',0,'awaiting_verification');raise exception 'Allowed before Auth deletion';exception when raise_exception then if SQLERRM<>'Cleanup not admitted' then raise;end if;end;
 delete from auth.users where id=a;
 perform pg_temp.assert(public.premium_cleanup_record('lifecycle',0,'awaiting_verification'));
 perform pg_temp.assert(not public.premium_cleanup_record('lifecycle',0,'retry_required','RC_NETWORK_UNKNOWN'));
 begin perform public.premium_cleanup_record('lifecycle',1,'retry_required','unsafe raw error');raise exception 'Allowed unsafe error';exception when raise_exception then if SQLERRM<>'Unsafe cleanup error' then raise;end if;end;
 update deletion_private.receipts set premium_cleanup=jsonb_set(premium_cleanup,'{createdAt}',to_jsonb(clock_timestamp()-interval '31 days')) where request='lifecycle';
 perform pg_temp.assert(public.premium_cleanup_record('lifecycle',1,'awaiting_verification'));
 select premium_cleanup into c from deletion_private.receipts where request='lifecycle';
 perform pg_temp.assert(c->>'state'='review_required' and c->>'appUserId' is not null);
 perform pg_temp.assert(not has_function_privilege('authenticated','public.premium_cleanup_record(text,integer,text,text)','execute'));
 raise notice 'PASS lifecycle: scope, durable handoff, post-Auth gate, CAS, safe errors, review without purge, private grants';
end$$;

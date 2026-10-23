-- LOCAL PROPOSAL ONLY. Not a migration or production instruction.
-- Requires existing rate_limits. New tables cascade from auth.users; A1 integration
-- and provider data retention require separate A1 approval before activation.
begin;
-- S1/S2/S4/S6 delta: use the existing A1 gate, never a new fence implementation.
do $$begin
 if to_regclass('deletion_private.inventory') is null or to_regprocedure('deletion_private.lock_writer(uuid)') is null or to_regprocedure('public.deletion_assert_lease(text,uuid)') is null then raise exception 'A1 foundation required';end if;
end$$;
create table public.premium_identities (
 user_id uuid primary key references auth.users(id) on delete cascade,
 app_user_id text not null unique default gen_random_uuid()::text
);
create table public.premium_memberships (
 user_id uuid primary key references auth.users(id) on delete cascade,
 tier text not null check(tier in ('free','premium')),
 expires_ms bigint,
 source_ms bigint not null,
 check(tier <> 'premium' or expires_ms is not null)
);
create table public.premium_transactions (
 store text not null check(store in ('app_store','play_store')),
 transaction_id text not null,
 user_id uuid not null references auth.users(id) on delete cascade,
 primary key(store,transaction_id)
);
create table public.premium_events (
 event_id text primary key,
 user_id uuid not null references auth.users(id) on delete cascade
);
create table public.premium_vton_requests (
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id text not null,
 payload_hash text not null,
 day_window date not null,
 state text not null check(state in ('reserved','dispatched','unknown','completed','refunded')),
 prediction_id text,
 primary key(user_id,request_id)
);
alter table public.premium_identities enable row level security;
alter table public.premium_memberships enable row level security;
alter table public.premium_transactions enable row level security;
alter table public.premium_events enable row level security;
alter table public.premium_vton_requests enable row level security;
revoke all on public.premium_identities,public.premium_memberships,public.premium_transactions,public.premium_events,public.premium_vton_requests from public,anon,authenticated;
grant select,insert,update,delete on public.premium_identities,public.premium_memberships,public.premium_transactions,public.premium_events,public.premium_vton_requests to service_role;
insert into deletion_private.inventory(relation_name,owner_column) values
 ('premium_identities','user_id'),('premium_memberships','user_id'),('premium_transactions','user_id'),('premium_events','user_id'),('premium_vton_requests','user_id');
do $$declare t text;begin
 foreach t in array array['premium_identities','premium_memberships','premium_transactions','premium_events','premium_vton_requests'] loop
  execute format('create trigger account_deletion_fence before insert or update on public.%I for each row execute function deletion_private.block_owned_write(''user_id'')',t);
 end loop;
end$$;

create function public.premium_binding(p_owner uuid) returns text
language plpgsql security definer set search_path=pg_catalog,public as $$
declare b text;
begin
 perform deletion_private.lock_writer(p_owner);
 perform pg_advisory_xact_lock(hashtextextended('premium:'||p_owner::text,0));
 insert into public.premium_identities(user_id) values(p_owner) on conflict(user_id) do nothing;
 select app_user_id into strict b from public.premium_identities where user_id=p_owner;
 return b;
end$$;

create function public.premium_store_snapshot(p_owner uuid,p_binding text,p_tier text,p_expires_ms bigint,p_source_ms bigint,p_transaction text,p_store text,p_event text) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare old public.premium_memberships; claimed uuid;
begin
 perform deletion_private.lock_writer(p_owner);
 perform pg_advisory_xact_lock(hashtextextended('premium:'||p_owner::text,0));
 if not exists(select 1 from public.premium_identities where user_id=p_owner and app_user_id=p_binding) then raise exception 'OWNER_MISMATCH' using errcode='23514'; end if;
 if p_tier not in ('free','premium') or p_tier is null or p_source_ms is null or abs(p_source_ms-(extract(epoch from clock_timestamp())*1000)::bigint)>60000 or (p_tier='premium' and p_expires_ms is null) then raise exception 'SNAPSHOT_INVALID' using errcode='23514'; end if;
 if p_event is not null then
   select user_id into claimed from public.premium_events where event_id=p_event;
   if found then
     if claimed<>p_owner then raise exception 'EVENT_OWNER_MISMATCH' using errcode='23514'; end if;
     return true;
   end if;
 end if;
 select * into old from public.premium_memberships where user_id=p_owner;
 if found and (old.source_ms>p_source_ms or (old.source_ms=p_source_ms and (old.tier<>p_tier or old.expires_ms is distinct from p_expires_ms))) then return false; end if;
 if p_transaction is not null then
   if p_store not in ('app_store','play_store') then raise exception 'STORE_INVALID' using errcode='23514'; end if;
   insert into public.premium_transactions values(p_store,p_transaction,p_owner) on conflict do nothing;
   if not exists(select 1 from public.premium_transactions where store=p_store and transaction_id=p_transaction and user_id=p_owner) then raise exception 'TRANSACTION_OWNER_MISMATCH' using errcode='23514'; end if;
 elsif p_tier='premium' then raise exception 'TRANSACTION_REQUIRED' using errcode='23514'; end if;
 insert into public.premium_memberships values(p_owner,p_tier,p_expires_ms,p_source_ms)
 on conflict(user_id) do update set tier=excluded.tier,expires_ms=excluded.expires_ms,source_ms=excluded.source_ms;
 if p_event is not null then insert into public.premium_events values(p_event,p_owner); end if;
 return true;
end$$;

create function public.premium_vton_reserve(p_owner uuid,p_request text,p_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare n timestamptz:=clock_timestamp(); d date:=(n at time zone 'UTC')::date; m timestamptz:=date_trunc('minute',n);
 s public.premium_memberships; q public.rate_limits; prior public.premium_vton_requests; lim int;
begin
 if p_request is null or p_request !~ '^[a-zA-Z0-9-]{1,100}$' or p_hash is null or length(p_hash)<1 or length(p_hash)>128 then raise exception 'REQUEST_INVALID' using errcode='23514'; end if;
 perform deletion_private.lock_writer(p_owner);
 perform pg_advisory_xact_lock(hashtextextended('premium:'||p_owner::text,0));
 select * into prior from public.premium_vton_requests where user_id=p_owner and request_id=p_request;
 if found then return jsonb_build_object('allowed',false,'reason',case when prior.payload_hash<>p_hash then 'request_conflict' else 'already_recorded' end,'state',prior.state); end if;
 select * into s from public.premium_memberships where user_id=p_owner;
 if not found or s.source_ms<(extract(epoch from n)*1000)::bigint-60000 then return jsonb_build_object('allowed',false,'reason','membership_unverified'); end if;
 lim:=case when s.tier='premium' and s.expires_ms>(extract(epoch from n)*1000)::bigint then 20 else 3 end;
 insert into public.rate_limits(user_id,minute_window,day_window) values(p_owner,m,d) on conflict do nothing;
 select * into strict q from public.rate_limits where user_id=p_owner for update;
 if q.minute_window<>m then q.minute_count:=0; end if;
 if q.day_window<>d then q.day_count:=0; end if;
 if q.day_count>=lim then return jsonb_build_object('allowed',false,'reason','daily_limit','retry_after_seconds',greatest(1,ceil(extract(epoch from ((d+1)::timestamp at time zone 'UTC')-n)))); end if;
 if q.minute_count>=3 then return jsonb_build_object('allowed',false,'reason','minute_limit','retry_after_seconds',greatest(1,ceil(extract(epoch from m+interval '1 minute'-n)))); end if;
 update public.rate_limits set minute_window=m,minute_count=q.minute_count+1,day_window=d,day_count=q.day_count+1,updated_at=n where user_id=p_owner;
 insert into public.premium_vton_requests values(p_owner,p_request,p_hash,d,'reserved',null);
 return jsonb_build_object('allowed',true,'daily_limit',lim);
end$$;

create function public.premium_vton_settle(p_owner uuid,p_request text,p_outcome text,p_prediction text) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.premium_vton_requests;
begin
 perform deletion_private.lock_writer(p_owner);
 perform pg_advisory_xact_lock(hashtextextended('premium:'||p_owner::text,0));
 select * into strict r from public.premium_vton_requests where user_id=p_owner and request_id=p_request for update;
 if p_outcome is null or p_outcome not in ('dispatched','unknown','completed','failed','not_sent') then raise exception 'OUTCOME_INVALID' using errcode='23514'; end if;
 if p_prediction is not null and (length(p_prediction)<1 or length(p_prediction)>200 or (r.prediction_id is not null and r.prediction_id<>p_prediction)) then raise exception 'PREDICTION_MISMATCH' using errcode='23514'; end if;
 if r.state in ('refunded','completed') then
   if (r.state='refunded' and p_outcome in ('not_sent','failed')) or (r.state='completed' and p_outcome='completed') then return true; end if;
   raise exception 'TERMINAL_STATE' using errcode='23514';
 end if;
 if p_outcome='dispatched' then
   if r.state<>'reserved' then raise exception 'DISPATCH_NOT_AVAILABLE' using errcode='23514'; end if;
 elsif p_outcome='not_sent' then
   if r.state not in ('reserved','dispatched') or r.prediction_id is not null then raise exception 'REFUND_UNPROVEN' using errcode='23514'; end if;
 elsif p_outcome in ('completed','failed') then
   if r.state not in ('dispatched','unknown') or p_prediction is null then raise exception 'RESULT_UNPROVEN' using errcode='23514'; end if;
 elsif p_outcome='unknown' and r.state not in ('dispatched','unknown') then raise exception 'DISPATCH_UNPROVEN' using errcode='23514';
 end if;
 if p_outcome in ('not_sent','failed') then
   -- Never credit a different UTC day or restore minute allowance for abuse retries.
   update public.rate_limits set day_count=greatest(0,day_count-1),updated_at=clock_timestamp() where user_id=p_owner and day_window=r.day_window;
 end if;
 update public.premium_vton_requests set state=case when p_outcome in ('not_sent','failed') then 'refunded' else p_outcome end,prediction_id=coalesce(p_prediction,prediction_id) where user_id=p_owner and request_id=p_request;
 return true;
end$$;
revoke all on function public.premium_binding(uuid),public.premium_store_snapshot(uuid,text,text,bigint,bigint,text,text,text),public.premium_vton_reserve(uuid,text,text),public.premium_vton_settle(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.premium_binding(uuid),public.premium_store_snapshot(uuid,text,text,bigint,bigint,text,text,text),public.premium_vton_reserve(uuid,text,text),public.premium_vton_settle(uuid,text,text,text) to service_role;
create function public.premium_admission(p_owner uuid) returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$begin perform deletion_private.lock_writer(p_owner);return true;end$$;

-- Same private receipt, no archive. Never exposed by deletion_begin/deletion_save.
alter table deletion_private.receipts add column premium_cleanup jsonb;
create function public.premium_deletion_capture(p_request text,p_lease uuid,p_retention_policy text default null,p_project text default null,p_environment text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,deletion_private as $$
declare who uuid;fenced boolean;opaque text;prior jsonb;
begin
 select subject into who from deletion_private.receipts where request=p_request;
 select g.fenced into fenced from deletion_private.owner_gates g where subject=who for update;
 if fenced is distinct from true then raise exception 'Deletion fence required';end if;
 if public.deletion_assert_lease(p_request,p_lease) is distinct from who then raise exception 'Lease mismatch';end if;
 select premium_cleanup into prior from deletion_private.receipts where subject=who;
 if prior is not null then return jsonb_build_object('state',prior->>'state');end if;
 select app_user_id into opaque from public.premium_identities where user_id=who;
 if opaque is null then return jsonb_build_object('state','none');end if;
 -- Approved operational targets are not legal retention periods or automatic TTLs.
 if p_retention_policy is distinct from 'vitrify-rc-lifecycle-20261017' or coalesce(length(trim(p_project)),0)=0 or p_environment is null or p_environment not in ('sandbox','production') then return jsonb_build_object('state','blocked_policy');end if;
 update deletion_private.receipts set premium_cleanup=jsonb_build_object('appUserId',opaque,'project',p_project,'environment',p_environment,'state','queued','policy',p_retention_policy,'createdAt',clock_timestamp(),'updatedAt',clock_timestamp(),'version',0) where subject=who;
 return jsonb_build_object('state','queued');
end$$;
revoke all on function public.premium_admission(uuid),public.premium_deletion_capture(text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.premium_admission(uuid),public.premium_deletion_capture(text,uuid,text,text,text) to service_role;
commit;

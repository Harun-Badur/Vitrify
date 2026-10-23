-- LOCAL UNAPPLIED DRAFT; apply after premium_v1.sql only with separate approval.
-- S3/S4: existing private recovery receipt; compare-and-swap result recording.
-- No scheduler, archive, automatic TTL, provider network call or Auth gate.
begin;
create function public.premium_cleanup_record(p_request text,p_version integer,p_state text,p_error text default null) returns boolean
language plpgsql security definer set search_path=pg_catalog,public,deletion_private as $$
declare c jsonb;who uuid;
begin
 select subject,premium_cleanup into who,c from deletion_private.receipts where request=p_request for update;
 if c is null or (c->>'version')::integer is distinct from p_version then return false;end if;
 -- Provider work is strictly post-Auth deletion. Existing fence remains untouched.
 if exists(select 1 from auth.users where id=who) or not exists(select 1 from deletion_private.owner_gates where subject=who and fenced) then raise exception 'Cleanup not admitted';end if;
 if p_state not in ('awaiting_verification','retry_required','review_required') or p_state is null then raise exception 'Invalid cleanup state';end if;
 if p_error is not null and p_error not in ('RC_NETWORK_UNKNOWN','RC_AUTH_DENIED','RC_RATE_LIMITED','RC_DELETE_REJECTED') then raise exception 'Unsafe cleanup error';end if;
 if clock_timestamp() >= (c->>'createdAt')::timestamptz + interval '30 days' then p_state:='review_required';end if;
 if c->>'state'='review_required' and p_state<>'review_required' then raise exception 'Explicit review required';end if;
 update deletion_private.receipts set premium_cleanup=c||jsonb_build_object('state',p_state,'errorCode',p_error,'updatedAt',clock_timestamp(),'version',p_version+1) where request=p_request;
 return true;
end$$;
revoke all on function public.premium_cleanup_record(text,integer,text,text) from public,anon,authenticated;
grant execute on function public.premium_cleanup_record(text,integer,text,text) to service_role;
-- A verified non-creating v2 read or operator evidence must precede any future
-- opaque-ID removal. No removal path is enabled by this draft; 200/404 DELETE
-- alone cannot clear it. Day-30 review requires an explicit retention decision.
commit;

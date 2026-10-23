-- NOT APPLIED. Temporary FASHN test-period overlay. Deploy only after approval.
-- Requires existing A1 lock_writer/provider_operations; does not modify them.
-- Apply only while all provider admission is paused and older requests are drained.
-- Arm flag=true BEFORE the stored future cutover; effective activation is that DB time.
begin;
create table public.fashn_test_requests (
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id text not null check(request_id ~ '^[a-zA-Z0-9-]{1,100}$'),
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 lease uuid not null default gen_random_uuid(),
 state text not null check(state in ('reserved','not_sent','unknown','completed')),
 created_at timestamptz not null default clock_timestamp(),
 primary key(user_id,request_id)
);
create unique index fashn_test_one_use on public.fashn_test_requests(user_id) where state<>'not_sent';
alter table public.fashn_test_requests enable row level security;
revoke all on public.fashn_test_requests from public,anon,authenticated,service_role;

-- Fixed server cutover, never derived from client input or reset on flag toggles.
-- A future boundary excludes accounts created anywhere in the deployment window.
create table public.fashn_test_policy (
 singleton boolean primary key check(singleton),
 eligible_after timestamptz not null check(isfinite(eligible_after))
);
alter table public.fashn_test_policy enable row level security;
revoke all on public.fashn_test_policy from public,anon,authenticated,service_role;
insert into public.fashn_test_policy values(true,clock_timestamp() + interval '30 minutes');

-- Permanently exclude ALL accounts visible now, irrespective of usage evidence.
-- Late-committing signups and deployment-window accounts are additionally excluded
-- by Auth.created_at <= eligible_after in every status/reserve check.
create table public.fashn_test_prior_users (
 user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.fashn_test_prior_users enable row level security;
revoke all on public.fashn_test_prior_users from public,anon,authenticated,service_role;
insert into public.fashn_test_prior_users
 select id from auth.users;

create function public.fashn_trial_gate(p_owner uuid,p_action text,p_request text default null,p_hash text default null,p_lease uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare prior public.fashn_test_requests; held public.fashn_test_requests; historical boolean; eligible boolean; cutoff timestamptz; checked_at timestamptz;
begin
 -- Existing fence, not a replacement; auth owner is supplied only by JWT-verified Edge.
 perform deletion_private.lock_writer(p_owner);
 perform pg_advisory_xact_lock(hashtextextended('fashn-test:'||p_owner::text,0));
 if p_action is null or p_action not in ('status','reserve','dispatch','release','complete') then raise exception 'ACTION_INVALID'; end if;
 if p_action in ('status','reserve') then
   select eligible_after into cutoff from public.fashn_test_policy where singleton;
   checked_at:=clock_timestamp();
   select coalesce(checked_at > cutoff and u.created_at > cutoff and u.created_at <= checked_at,false)
     into eligible from auth.users u where u.id=p_owner;
   eligible:=coalesce(eligible,false);
   -- Fail closed for historical evidence, including ambiguous/refunded legacy attempts.
   select exists(select 1 from public.fashn_test_prior_users where user_id=p_owner)
     or exists(select 1 from deletion_private.provider_operations op where subject=p_owner and provider='fashn'
       and not exists(select 1 from public.fashn_test_requests r where r.user_id=p_owner and r.request_id=op.request))
     into historical;
   select * into held from public.fashn_test_requests where user_id=p_owner and state<>'not_sent';
   -- Current trial's own legacy daily-counter/provider entries are not a second historical use.
   -- They only exist after this trial reserved and are already covered by held.
   if p_action='status' then return jsonb_build_object('used',not eligible or historical or held.user_id is not null); end if;
   if p_request is null or p_request !~ '^[a-zA-Z0-9-]{1,100}$' or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'REQUEST_INVALID'; end if;
   select * into prior from public.fashn_test_requests where user_id=p_owner and request_id=p_request;
   if found then return jsonb_build_object('allowed',false,'reason',case when prior.payload_hash=p_hash then 'already_recorded' else 'request_conflict' end,'state',prior.state); end if;
   if not eligible then return jsonb_build_object('allowed',false,'reason','trial_ineligible','state','ineligible'); end if;
   if historical or held.user_id is not null then return jsonb_build_object('allowed',false,'reason','trial_used','state',coalesce(held.state,'historical')); end if;
   insert into public.fashn_test_requests(user_id,request_id,payload_hash,state) values(p_owner,p_request,p_hash,'reserved') returning * into prior;
   return jsonb_build_object('allowed',true,'lease',prior.lease);
 end if;
 if p_action='dispatch' then
   update public.fashn_test_requests set state='unknown' where user_id=p_owner and request_id=p_request and payload_hash=p_hash and lease=p_lease and state='reserved';
 elsif p_action='release' then
   update public.fashn_test_requests set state='not_sent' where user_id=p_owner and request_id=p_request and payload_hash=p_hash and lease=p_lease and state='reserved';
 else
   update public.fashn_test_requests set state='completed' where user_id=p_owner and request_id=p_request and payload_hash=p_hash and lease=p_lease and state='unknown';
 end if;
 return to_jsonb(found);
end$$;
revoke all on function public.fashn_trial_gate(uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.fashn_trial_gate(uuid,text,text,text,uuid) to service_role;
commit;

-- Unapplied Cutout V2. Requires installed A1 + wardrobe photo contract. OFF by default.
begin;
do $$ begin
 if not exists(select 1 from pg_roles where rolname=current_user and (rolsuper or rolbypassrls))
 then raise exception 'CUTOUT_V2_INSTALLER_ROLE'; end if;
 if to_regprocedure('deletion_private.lock_writer(uuid)') is null
 or to_regclass('deletion_private.storage_operations') is null
 or to_regprocedure('public.storage_upload_start(uuid,uuid,uuid,text,text)') is null
 or to_regprocedure('public.storage_upload_succeed(uuid,uuid,uuid,text,text,jsonb)') is null
 or to_regclass('deletion_private.inventory') is null
 or not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.wardrobe_items')
   and tgfoid=to_regprocedure('deletion_private.block_owned_write()') and tgenabled in ('O','A')
   and (tgtype::integer & 23)=23 and tgnargs=1 and tgargs=decode('757365725f696400','hex')) then
   raise exception 'CUTOUT_V2_A1_DEPENDENCY';
 end if;
end $$;
alter table public.wardrobe_items add column cutout_protocol smallint
  check (cutout_protocol is null or cutout_protocol = 2);
create schema cutout_v2_private;
revoke all on schema cutout_v2_private from public, anon, authenticated, service_role;

create table cutout_v2_private.readiness (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  a1_writer_revision text,
  a1_inventory_reviewed boolean not null default false,
  provider_claim_reviewed boolean not null default false,
  check (not enabled or (a1_writer_revision is not null and a1_inventory_reviewed and provider_claim_reviewed))
);
insert into cutout_v2_private.readiness default values;

create table public.wardrobe_cutout_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  -- Historical cloud UUID intentionally NOT cascading from wardrobe_items:
  -- deleting an item must retain its dispatch/dedup tombstone until owner deletion.
  wardrobe_item_id uuid not null,
  original_version text not null check (original_version ~ '^[a-f0-9]{64}$'),
  state text not null default 'RESERVED' check (state in
    ('RESERVED','ARMED','RUNNING','UNKNOWN','COMPLETING','SUCCEEDED','FAILED')),
  revision bigint not null default 0 check (revision >= 0),
  claim_count smallint not null default 0 check (claim_count in (0,1)),
  claimed_at timestamptz,
  non_dispatch_proven boolean not null default false,
  tombstoned_at timestamptz,
  failure_code text check (failure_code in
    ('PREPARATION_FAILED','CLOSED_UNCLAIMED','PROVIDER_FAILED','OWNER_FENCED','ORIGINAL_CHANGED','RESULT_UNAVAILABLE')),
  result_bucket text check (result_bucket = 'wardrobe-cutouts'),
  result_key text,
  result_sha256 text check (result_sha256 ~ '^[a-f0-9]{64}$'),
  result_bytes bigint check (result_bytes > 0 and result_bytes <= 12582912),
  result_operation uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (owner_id, wardrobe_item_id, original_version),
  unique (id, owner_id),
  check ((claim_count = 0) = (claimed_at is null)),
  check (state not in ('RESERVED','ARMED') or claim_count = 0),
  check (state not in ('RUNNING','UNKNOWN','COMPLETING','SUCCEEDED') or claim_count = 1),
  check (not non_dispatch_proven or
    (state = 'FAILED' and claim_count = 0 and failure_code is not distinct from 'CLOSED_UNCLAIMED')),
  check ((state = 'SUCCEEDED') =
    (result_bucket is not null and result_key is not null and result_sha256 is not null
      and result_bytes is not null and result_operation is not null)),
  check (state = 'SUCCEEDED' or (result_bucket is null and result_key is null
    and result_sha256 is null and result_bytes is null and result_operation is null)),
  check (result_key is null or result_key =
    owner_id::text || '/' || wardrobe_item_id::text || '/cutout-' || id::text || '.png')
);
create index wardrobe_cutout_jobs_owner_state on public.wardrobe_cutout_jobs(owner_id, state);

create table cutout_v2_private.request_aliases (
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  job_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (owner_id, request_id),
  foreign key (job_id, owner_id) references public.wardrobe_cutout_jobs(id, owner_id) on delete cascade
);

create table cutout_v2_private.capabilities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null,
  stage text not null check (stage in ('CLAIM','COMPLETE')),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  bound_revision bigint not null check (bound_revision >= 0),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  unique (job_id, stage), -- never mint a replacement CLAIM after uncertainty
  foreign key (job_id, owner_id) references public.wardrobe_cutout_jobs(id, owner_id) on delete cascade
);

-- Writer admission metadata, not another writer and NOT a v1 UNKNOWN reset.
-- A1 barrier must inventory this table before enabled=true is even considered.
create table cutout_v2_private.storage_attempts (
  operation uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null unique,
  state text not null check (state in ('ADMITTED','UNKNOWN','VERIFIED','COMPENSATED')),
  physical_dispatch_possible boolean not null default false,
  png_sha256 text not null check (png_sha256 ~ '^[a-f0-9]{64}$'),
  byte_length bigint not null check (byte_length > 0 and byte_length <= 12582912),
  -- Fixed typed evidence only; no arbitrary JSON, request bodies or signed URLs.
  verified_at timestamptz,
  unique (operation, job_id, owner_id),
  foreign key (job_id, owner_id) references public.wardrobe_cutout_jobs(id, owner_id) on delete cascade,
  check ((state = 'VERIFIED') = (verified_at is not null)),
  check (state not in ('UNKNOWN','VERIFIED') or physical_dispatch_possible)
);
create index cutout_v2_capabilities_owner on cutout_v2_private.capabilities(owner_id);
create index cutout_v2_storage_attempts_owner on cutout_v2_private.storage_attempts(owner_id);
alter table public.wardrobe_cutout_jobs add constraint cutout_result_operation
  foreign key (result_operation, id, owner_id)
  references cutout_v2_private.storage_attempts(operation, job_id, owner_id);

alter table public.wardrobe_cutout_jobs enable row level security;
alter table public.wardrobe_cutout_jobs force row level security;
create policy cutout_jobs_owner_read on public.wardrobe_cutout_jobs for select to authenticated
  using (owner_id = (select auth.uid()));
revoke all on public.wardrobe_cutout_jobs from public, anon, authenticated, service_role;
-- No DML or broad SELECT granted: status/result RPCs project sanitized fields.
-- Realtime, if later approved, needs separate column/publication and fence review.
alter table cutout_v2_private.readiness enable row level security;
alter table cutout_v2_private.request_aliases enable row level security;
alter table cutout_v2_private.capabilities enable row level security;
alter table cutout_v2_private.storage_attempts enable row level security;
revoke all on all tables in schema cutout_v2_private from public, anon, authenticated, service_role;

-- A1 DB inventory is public-only. Private rows cascade through auth.users;
-- all physical dispatch lives in the EXISTING storage_operations barrier.
insert into deletion_private.inventory(relation_name,owner_column)
values ('wardrobe_cutout_jobs','owner_id');

-- New-item-only admission API; old apply/create/edit and legacy rows unchanged.
-- Same authenticated request + existing validation/CAS path, no marker backfill.
create function public.wardrobe_apply_change_v2(p_owner uuid,p_kind text,p_id uuid,p_expected timestamptz,p_value jsonb) returns text
language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid(); result text; affected integer;
begin
 if who is null or who is distinct from p_owner then raise exception 'CUTOUT_V2_OWNER_INVALID'; end if;
 if not coalesce((select enabled from cutout_v2_private.readiness where singleton),false)
 then raise exception 'CUTOUT_V2_DISABLED'; end if;
 perform deletion_private.lock_writer(who);
 if p_kind is distinct from 'item' or p_expected is not null or p_value is null then raise exception 'CUTOUT_V2_NEW_ITEM_REQUIRED'; end if;
 if exists(select 1 from public.wardrobe_items where id=p_id) then return 'conflict'; end if;
 result:=public.wardrobe_apply_change(who,p_kind,p_id,p_expected,p_value);
 if result is distinct from 'applied' then return result; end if;
 update public.wardrobe_items set cutout_protocol=2 where id=p_id and user_id=who;
 get diagnostics affected=row_count;
 if affected<>1 then raise exception 'CUTOUT_V2_NEW_ITEM_UNVERIFIED'; end if;
 return result;
end $$;
revoke all on function public.wardrobe_apply_change_v2(uuid,text,uuid,timestamptz,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.wardrobe_apply_change_v2(uuid,text,uuid,timestamptz,jsonb) to authenticated;

-- Do not rely on an assumed upstream path constraint for privileged reads.
create function cutout_v2_private.original_version(p_owner uuid,p_item uuid) returns text
language sql stable security definer set search_path=pg_catalog as $$
 select encode(sha256(convert_to(w.image_storage_path,'UTF8')),'hex') from public.wardrobe_items w
 where w.id=p_item and w.user_id=p_owner and w.cutout_protocol=2 and w.image_storage_path is not null
 and w.image_storage_path ~ ('^'||p_owner::text||'/'||p_item::text||'/original-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}[.]png$')
$$;

create function cutout_v2_private.assert_current(p_owner uuid,p_job uuid) returns public.wardrobe_cutout_jobs
language plpgsql security definer set search_path=pg_catalog as $$
declare j public.wardrobe_cutout_jobs;
begin
 perform deletion_private.lock_writer(p_owner);
 select * into j from public.wardrobe_cutout_jobs where id=p_job and owner_id=p_owner for update;
 if not found or j.tombstoned_at is not null
   or cutout_v2_private.original_version(p_owner,j.wardrobe_item_id) is distinct from j.original_version
 then raise exception 'CUTOUT_V2_ORIGINAL_CHANGED'; end if;
 return j;
end $$;

create function public.cutout_v2_read(p_owner uuid,p_job uuid,p_request uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare j public.wardrobe_cutout_jobs; a cutout_v2_private.storage_attempts;
begin
 if p_job is null then
   select job_id into p_job from cutout_v2_private.request_aliases where owner_id=p_owner and request_id=p_request;
 end if;
 if not exists(select 1 from cutout_v2_private.request_aliases where owner_id=p_owner and request_id=p_request and job_id=p_job)
 or not exists(select 1 from deletion_private.owner_gates where subject=p_owner and fenced=false)
 then return jsonb_build_object('state','UNKNOWN'); end if;
 select * into j from public.wardrobe_cutout_jobs where id=p_job and owner_id=p_owner;
 if not found then return jsonb_build_object('state','UNKNOWN'); end if;
 if j.tombstoned_at is not null or cutout_v2_private.original_version(p_owner,j.wardrobe_item_id) is distinct from j.original_version
 then return jsonb_build_object('state','UNKNOWN','reasonCode','ORIGINAL_CHANGED'); end if;
 if j.state='SUCCEEDED' then
   select * into a from cutout_v2_private.storage_attempts where operation=j.result_operation and job_id=j.id and owner_id=p_owner and state='VERIFIED';
   if not found then return jsonb_build_object('state','UNKNOWN'); end if;
 end if;
 return jsonb_strip_nulls(jsonb_build_object('protocol','vitrify.cutout.v2','state',
  case when j.state in ('ARMED','RUNNING') and exists(select 1 from cutout_v2_private.capabilities c
    where c.job_id=j.id and c.stage=case when j.state='ARMED' then 'CLAIM' else 'COMPLETE' end
    and c.expires_at<=clock_timestamp()) then 'UNKNOWN' else j.state end,
  'jobId',j.id,'owner',p_owner,'wardrobeItemId',j.wardrobe_item_id,'originalVersion',j.original_version,
  'request',p_request,'revision',j.revision,'nonDispatchProven',j.non_dispatch_proven,
  'resultId',case when j.state='SUCCEEDED' then j.id end,'pngSha256',j.result_sha256,
  'bucket',j.result_bucket,'key',j.result_key,'byteLength',j.result_bytes));
end $$;

-- Only control Edge / existing sole writer possess service-role. Never CPU/client.
create function public.cutout_v2_command(p_action text,p_value jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid; jid uuid; req uuid; iid uuid; ver text; j public.wardrobe_cutout_jobs;
 cap cutout_v2_private.capabilities; op deletion_private.storage_operations;
 attempt cutout_v2_private.storage_attempts; h text; next_h text; n bigint;
begin
 -- Disable new admission/inference without disabling already-claimed cleanup.
 if p_action in ('reserve','execute','claim') and not coalesce((select enabled from cutout_v2_private.readiness where singleton),false)
 then raise exception 'CUTOUT_V2_DISABLED'; end if;
 jid:=(p_value->>'job')::uuid; req:=(p_value->>'request')::uuid;
 h:=p_value->>'tokenHash'; next_h:=p_value->>'nextHash';
 if p_action in ('claim','source','admit','finalize') then
   select owner_id into who from public.wardrobe_cutout_jobs where id=jid;
 else who:=(p_value->>'owner')::uuid; end if;
 perform deletion_private.lock_writer(who);
 if p_action='reserve' then
   iid:=(p_value->>'item')::uuid; ver:=p_value->>'original';
   if req is null or ver is null or ver !~ '^[a-f0-9]{64}$'
    or cutout_v2_private.original_version(who,iid) is distinct from ver
   then raise exception 'CUTOUT_V2_ORIGINAL_CHANGED'; end if;
   select c.* into j from cutout_v2_private.request_aliases a join public.wardrobe_cutout_jobs c on c.id=a.job_id
    where a.owner_id=who and a.request_id=req;
   if found then
    if j.wardrobe_item_id<>iid or j.original_version<>ver then raise exception 'CUTOUT_V2_REQUEST_CONFLICT'; end if;
   else
    insert into public.wardrobe_cutout_jobs(owner_id,wardrobe_item_id,original_version) values(who,iid,ver)
      on conflict(owner_id,wardrobe_item_id,original_version) do nothing;
    select * into j from public.wardrobe_cutout_jobs where owner_id=who and wardrobe_item_id=iid and original_version=ver for update;
    insert into cutout_v2_private.request_aliases(owner_id,request_id,job_id) values(who,req,j.id);
   end if;
   return public.cutout_v2_read(who,j.id,req);
 end if;
 j:=cutout_v2_private.assert_current(who,jid);
 if p_action in ('execute','close') then
   if not exists(select 1 from cutout_v2_private.request_aliases where owner_id=who and request_id=req and job_id=jid)
   then raise exception 'CUTOUT_V2_REQUEST_CONFLICT'; end if;
   if p_action='execute' and j.state<>'RESERVED' then return public.cutout_v2_read(who,jid,req); end if;
   if j.revision is distinct from (p_value->>'revision')::bigint then raise exception 'CUTOUT_V2_REVISION_CONFLICT'; end if;
   if p_action='close' then
     if j.claim_count<>0 or j.state not in ('RESERVED','ARMED') then raise exception 'CUTOUT_V2_DISPATCH_UNCERTAIN'; end if;
     update cutout_v2_private.capabilities set revoked_at=clock_timestamp() where job_id=jid;
     update public.wardrobe_cutout_jobs set state='FAILED',failure_code='CLOSED_UNCLAIMED',non_dispatch_proven=true,
       revision=revision+1,updated_at=clock_timestamp() where id=jid;
   else
     if next_h is null or next_h !~ '^[a-f0-9]{64}$' then raise exception 'CUTOUT_V2_CAPABILITY_INVALID'; end if;
     update public.wardrobe_cutout_jobs set state='ARMED',revision=revision+1,updated_at=clock_timestamp() where id=jid;
     insert into cutout_v2_private.capabilities(owner_id,job_id,stage,token_hash,bound_revision,expires_at)
       values(who,jid,'CLAIM',next_h,j.revision+1,clock_timestamp()+interval '10 minutes');
     return public.cutout_v2_read(who,jid,req)||jsonb_build_object('dispatch',true);
   end if;
   return public.cutout_v2_read(who,jid,req);
 end if;
 if p_action in ('finalize','reconcile') then
   if p_action='reconcile' and not exists(select 1 from cutout_v2_private.request_aliases
     where owner_id=who and request_id=req and job_id=jid) then raise exception 'CUTOUT_V2_REQUEST_CONFLICT'; end if;
   -- Trusted writer only; the raw cap was consumed before physical upload.
   select * into attempt from cutout_v2_private.storage_attempts where job_id=jid for update;
   select * into op from deletion_private.storage_operations where operation=attempt.operation;
   if not found or op.subject<>who or op.bucket<>'wardrobe-cutouts'
     or op.path<>who::text||'/'||j.wardrobe_item_id::text||'/cutout-'||jid::text||'.png'
     or op.state<>'SUCCEEDED' or (p_action='finalize' and op.operation is distinct from (p_value->>'operation')::uuid)
     or j.state not in ('COMPLETING','SUCCEEDED') then raise exception 'CUTOUT_V2_STORAGE_UNVERIFIED'; end if;
   update cutout_v2_private.storage_attempts set state='VERIFIED',physical_dispatch_possible=true,verified_at=coalesce(verified_at,clock_timestamp()) where operation=op.operation;
   update public.wardrobe_cutout_jobs set state='SUCCEEDED',result_bucket=op.bucket,result_key=op.path,
     result_sha256=attempt.png_sha256,result_bytes=attempt.byte_length,result_operation=op.operation,
     revision=revision+1,updated_at=clock_timestamp() where id=jid and state='COMPLETING';
   return jsonb_build_object('state','SUCCEEDED','resultId',jid,'pngSha256',attempt.png_sha256);
 end if;
 select * into cap from cutout_v2_private.capabilities where job_id=jid
   and stage=case when p_action='claim' then 'CLAIM' else 'COMPLETE' end for update;
 if not found or h is null or cap.token_hash<>h or cap.expires_at<=clock_timestamp() or cap.revoked_at is not null
   or cap.consumed_at is not null or cap.bound_revision<>j.revision then raise exception 'CUTOUT_V2_CAPABILITY_INVALID'; end if;
 if p_action='source' then
   if j.state<>'RUNNING' then raise exception 'CUTOUT_V2_DISPATCH_UNCERTAIN'; end if;
   return (select jsonb_build_object('bucket','wardrobe-cutouts','path',image_storage_path)
     from public.wardrobe_items where id=j.wardrobe_item_id and user_id=who);
 elsif p_action='claim' then
   if j.state<>'ARMED' or j.claim_count<>0 or next_h is null or next_h !~ '^[a-f0-9]{64}$'
     then raise exception 'CUTOUT_V2_DISPATCH_UNCERTAIN'; end if;
   update cutout_v2_private.capabilities set consumed_at=clock_timestamp() where id=cap.id;
   update public.wardrobe_cutout_jobs set state='RUNNING',claim_count=1,claimed_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() where id=jid;
   insert into cutout_v2_private.capabilities(owner_id,job_id,stage,token_hash,bound_revision,expires_at)
    values(who,jid,'COMPLETE',next_h,j.revision+1,clock_timestamp()+interval '10 minutes');
   return jsonb_build_object('claimed',true,'jobId',jid);
 elsif p_action='admit' then
   n:=(p_value->>'bytes')::bigint;
   if j.state<>'RUNNING' or n is null or n<=0 or n>12582912 or (p_value->>'digest') is null or (p_value->>'digest') !~ '^[a-f0-9]{64}$'
    then raise exception 'CUTOUT_V2_COMPLETION_INVALID'; end if;
   insert into deletion_private.storage_operations(subject,request,bucket,path,lease,state)
    values(who,'cutout-v2-'||jid::text,'wardrobe-cutouts',who::text||'/'||j.wardrobe_item_id::text||'/cutout-'||jid::text||'.png',gen_random_uuid(),'ADMITTED') returning * into op;
   insert into cutout_v2_private.storage_attempts(operation,owner_id,job_id,state,png_sha256,byte_length)
    values(op.operation,who,jid,'ADMITTED',p_value->>'digest',n);
   update cutout_v2_private.capabilities set consumed_at=clock_timestamp() where id=cap.id;
   update public.wardrobe_cutout_jobs set state='COMPLETING',revision=revision+1,updated_at=clock_timestamp() where id=jid;
   return jsonb_build_object('operation',op.operation,'lease',op.lease,'owner',who,'bucket',op.bucket,'path',op.path);
 end if;
 raise exception 'CUTOUT_V2_ACTION_INVALID';
end $$;

-- Item tombstones retain history, revoke capabilities, never reset canonical jobs.
create function cutout_v2_private.item_changed() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op='UPDATE' and new.image_storage_path is not distinct from old.image_storage_path then return new; end if;
 perform 1 from deletion_private.owner_gates where subject=old.user_id for update;
 update public.wardrobe_cutout_jobs set tombstoned_at=coalesce(tombstoned_at,clock_timestamp())
  where owner_id=old.user_id and wardrobe_item_id=old.id;
 update cutout_v2_private.capabilities set revoked_at=coalesce(revoked_at,clock_timestamp())
  where owner_id=old.user_id and job_id in(select id from public.wardrobe_cutout_jobs where owner_id=old.user_id and wardrobe_item_id=old.id);
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger cutout_v2_item_changed after update of image_storage_path or delete on public.wardrobe_items
 for each row execute function cutout_v2_private.item_changed();

create function cutout_v2_private.owner_fenced() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if new.fenced then
  update cutout_v2_private.capabilities set revoked_at=coalesce(revoked_at,clock_timestamp()) where owner_id=new.subject;
 end if;
 return new;
end $$;
create trigger cutout_v2_owner_fenced after update of fenced on deletion_private.owner_gates
 for each row execute function cutout_v2_private.owner_fenced();

-- Mirror existing durable dispatch evidence atomically, not a parallel barrier.
create function cutout_v2_private.storage_changed() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if new.state in ('UNKNOWN','SUCCEEDED') then
  update cutout_v2_private.storage_attempts set physical_dispatch_possible=true,
    state=case when state='VERIFIED' then state else 'UNKNOWN' end where operation=new.operation;
  if new.state='SUCCEEDED' then
   update public.wardrobe_cutout_jobs set revision=revision+1,updated_at=clock_timestamp()
    where state='COMPLETING' and id in(select job_id from cutout_v2_private.storage_attempts where operation=new.operation);
  end if;
 end if;
 return new;
end $$;
create trigger cutout_v2_storage_changed after update of state on deletion_private.storage_operations
 for each row execute function cutout_v2_private.storage_changed();

revoke all on all functions in schema cutout_v2_private from public,anon,authenticated,service_role;
revoke all on function public.cutout_v2_command(text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.cutout_v2_read(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.cutout_v2_command(text,jsonb), public.cutout_v2_read(uuid,uuid,uuid) to service_role;

-- Authenticated read-only extension. No dispatch, alias creation, signing or apply.
-- Preserve the V1 snapshot and photoVersion=1; callers opt into the V2 projection.
create function public.wardrobe_cloud_snapshot_v2(p_owner uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare result jsonb; items jsonb;
begin
 if auth.uid() is null or auth.uid() is distinct from p_owner then raise exception 'CUTOUT_V2_OWNER_INVALID'; end if;
 if not exists(select 1 from deletion_private.owner_gates where subject=p_owner and fenced=false)
 then raise exception 'CUTOUT_V2_OWNER_FENCED'; end if;
 result:=public.wardrobe_cloud_snapshot(p_owner);
 select coalesce(jsonb_agg(e.value || coalesce((
  select jsonb_strip_nulls(jsonb_build_object(
    'cutoutProtocol',w.cutout_protocol,
    'originalVersion',cutout_v2_private.original_version(p_owner,w.id),
    'cutoutStatus',case when w.cutout_protocol=2 then case when j.id is not null then 'ready' when exists(
      select 1 from public.wardrobe_cutout_jobs f where f.owner_id=p_owner and f.wardrobe_item_id=w.id
      and f.original_version=cutout_v2_private.original_version(p_owner,w.id) and f.state='FAILED') then 'blocked' else 'pending' end end,
    'cutoutStoragePath',j.result_key,
    'cutoutResult',case when j.id is not null then jsonb_build_object('jobId',j.id,'requestId',a.request_id,
      'pngSha256',j.result_sha256,'originalVersion',j.original_version) end))
  from public.wardrobe_items w
  left join public.wardrobe_cutout_jobs j on j.owner_id=p_owner and j.wardrobe_item_id=w.id
    and j.original_version=cutout_v2_private.original_version(p_owner,w.id) and j.state='SUCCEEDED'
    and j.tombstoned_at is null and exists(select 1 from cutout_v2_private.storage_attempts s
      where s.operation=j.result_operation and s.owner_id=p_owner and s.job_id=j.id and s.state='VERIFIED')
  left join lateral (select request_id from cutout_v2_private.request_aliases where owner_id=p_owner and job_id=j.id
    order by created_at,request_id limit 1) a on true
  where w.id=(e.value->>'id')::uuid and w.user_id=p_owner
 ),'{}'::jsonb) order by e.position),'[]'::jsonb) into items
 from jsonb_array_elements(result->'items') with ordinality e(value,position);
 return result||jsonb_build_object('items',items,'cutoutVersion',2,'cutoutReady',
  coalesce((select enabled from cutout_v2_private.readiness where singleton),false));
end $$;
revoke all on function public.wardrobe_cloud_snapshot_v2(uuid) from public,anon,authenticated,service_role;
grant execute on function public.wardrobe_cloud_snapshot_v2(uuid) to authenticated;

create function public.wardrobe_cutout_result(p_owner uuid,p_item uuid,p_original text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare jid uuid; req uuid;
begin
 if auth.uid() is null or auth.uid() is distinct from p_owner then raise exception 'CUTOUT_V2_OWNER_INVALID'; end if;
 if cutout_v2_private.original_version(p_owner,p_item) is distinct from p_original then return jsonb_build_object('state','UNKNOWN'); end if;
 select j.id,a.request_id into jid,req from public.wardrobe_cutout_jobs j
 join lateral(select request_id from cutout_v2_private.request_aliases where owner_id=p_owner and job_id=j.id order by created_at,request_id limit 1)a on true
 where j.owner_id=p_owner and j.wardrobe_item_id=p_item and j.original_version=p_original and j.tombstoned_at is null;
 return public.cutout_v2_read(p_owner,jid,req);
end $$;
revoke all on function public.wardrobe_cutout_result(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.wardrobe_cutout_result(uuid,uuid,text) to authenticated;
-- Owner-only metadata hints; capabilities remain private and never enter Realtime.
grant select on public.wardrobe_cutout_jobs to authenticated;
do $$ begin
 if not exists(select 1 from pg_publication where pubname='supabase_realtime') then raise exception 'CUTOUT_V2_REALTIME_DEPENDENCY'; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='wardrobe_cutout_jobs') then
  alter publication supabase_realtime add table public.wardrobe_cutout_jobs;
 end if;
end $$;
commit;

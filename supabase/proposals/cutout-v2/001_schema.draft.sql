-- PROPOSAL ONLY. Not a migration. Never place in supabase/migrations.
-- A1_DEPENDENCY: S1/S2/S4/S5/S6/S7. No existing object/policy/function replaced.
-- Deliberate execution guard: removing it requires a separately reviewed release.
begin read only;
do $$ begin raise exception 'CUTOUT_V2_DRAFT_ONLY'; end $$;

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

-- No RPC EXECUTE grants yet. Fixed-search-path definer functions must be reviewed
-- alongside exact A1 bindings, then revoke PUBLIC EXECUTE individually.
-- No bucket creation, Storage policies, signed upload, Storage DML or service keys.
-- No changes to wardrobe_apply_change, photoVersion=1, V1 provider/device journals.
rollback;

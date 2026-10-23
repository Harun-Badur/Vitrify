-- Wardrobe and outfits V1. Requires schema_products.sql and schema.sql.
-- Favorites remain in liked_products; wardrobe items are separate user-owned data.
-- One-time staging install only: execute the WHOLE file. No existing object is overwritten.
begin;
do $$
begin
  if to_regclass('public.wardrobe_items') is not null
    or to_regclass('public.outfits') is not null
    or to_regclass('public.outfit_items') is not null
    or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='set_wardrobe_outfit_updated_at') then
    raise exception 'Wardrobe installation requires absent target objects';
  end if;
  if exists (
    select 1 from (values ('users','uuid'::regtype),('products','text'::regtype)) v(name,typ)
    where not exists (
      select 1 from pg_attribute a join pg_index i on i.indrelid=a.attrelid
      where a.attrelid=to_regclass('public.'||v.name) and a.attname='id'
        and not a.attisdropped and a.atttypid=v.typ and a.attnotnull
        and i.indisunique and i.indisvalid and i.indimmediate and i.indnkeyatts=1
        and i.indkey[0]=a.attnum and i.indpred is null and i.indexprs is null
    )
  ) or to_regprocedure('auth.uid()') is null
    or not exists(select 1 from pg_roles where rolname='authenticated')
    or not exists(select 1 from pg_roles where rolname='anon') then
    raise exception 'Wardrobe dependency mismatch';
  end if;
end $$;

create table public.wardrobe_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  image_url text not null,
  name text not null,
  category text not null,
  subcategory text,
  color text,
  secondary_colors jsonb not null default '[]'::jsonb
    check (jsonb_typeof(secondary_colors) = 'array'),
  pattern text,
  brand text,
  size text,
  season text,
  style_tags jsonb not null default '[]'::jsonb
    check (jsonb_typeof(style_tags) = 'array'),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.outfits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  cover_image text,
  occasion text,
  notes text,
  scheduled_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.outfit_items (
  id uuid primary key default gen_random_uuid(),
  outfit_id uuid not null references public.outfits (id) on delete cascade,
  source_type text not null check (source_type in ('wardrobe', 'catalog')),
  wardrobe_item_id uuid references public.wardrobe_items (id) on delete cascade,
  product_id text references public.products (id) on delete restrict,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  constraint outfit_items_source_matches_reference check (
    (source_type = 'wardrobe' and wardrobe_item_id is not null and product_id is null)
    or
    (source_type = 'catalog' and product_id is not null and wardrobe_item_id is null)
  )
);

create index wardrobe_items_user_created_at_idx
  on public.wardrobe_items (user_id, created_at desc);
create index outfits_user_created_at_idx
  on public.outfits (user_id, created_at desc);
create index outfit_items_outfit_position_idx
  on public.outfit_items (outfit_id, position, id);
create index outfit_items_wardrobe_item_id_idx
  on public.outfit_items (wardrobe_item_id)
  where wardrobe_item_id is not null;
create index outfit_items_product_id_idx
  on public.outfit_items (product_id)
  where product_id is not null;

create function public.set_wardrobe_outfit_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Strictly advance after row-lock acquisition, including repeated RPCs in one transaction.
  new.updated_at = greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;

drop trigger if exists trg_wardrobe_items_updated_at on public.wardrobe_items;
create trigger trg_wardrobe_items_updated_at
before update on public.wardrobe_items
for each row execute function public.set_wardrobe_outfit_updated_at();

drop trigger if exists trg_outfits_updated_at on public.outfits;
create trigger trg_outfits_updated_at
before update on public.outfits
for each row execute function public.set_wardrobe_outfit_updated_at();

alter table public.wardrobe_items enable row level security;
alter table public.outfits enable row level security;
alter table public.outfit_items enable row level security;

drop policy if exists wardrobe_items_select_own on public.wardrobe_items;
create policy wardrobe_items_select_own on public.wardrobe_items
for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists wardrobe_items_insert_own on public.wardrobe_items;
create policy wardrobe_items_insert_own on public.wardrobe_items
for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists wardrobe_items_update_own on public.wardrobe_items;
create policy wardrobe_items_update_own on public.wardrobe_items
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists wardrobe_items_delete_own on public.wardrobe_items;
create policy wardrobe_items_delete_own on public.wardrobe_items
for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists outfits_select_own on public.outfits;
create policy outfits_select_own on public.outfits
for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists outfits_insert_own on public.outfits;
create policy outfits_insert_own on public.outfits
for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists outfits_update_own on public.outfits;
create policy outfits_update_own on public.outfits
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists outfits_delete_own on public.outfits;
create policy outfits_delete_own on public.outfits
for delete to authenticated using (user_id = (select auth.uid()));

-- Item ownership comes from the parent outfit. Wardrobe references must
-- additionally point to an item owned by the same authenticated user.
drop policy if exists outfit_items_select_own on public.outfit_items;
create policy outfit_items_select_own on public.outfit_items
for select to authenticated using (
  exists (
    select 1 from public.outfits as o
    where o.id = outfit_id and o.user_id = (select auth.uid())
  )
);

drop policy if exists outfit_items_insert_own on public.outfit_items;
create policy outfit_items_insert_own on public.outfit_items
for insert to authenticated with check (
  exists (
    select 1 from public.outfits as o
    where o.id = outfit_id and o.user_id = (select auth.uid())
  )
  and (
    source_type = 'catalog'
    or exists (
      select 1 from public.wardrobe_items as w
      where w.id = wardrobe_item_id and w.user_id = (select auth.uid())
    )
  )
);

drop policy if exists outfit_items_update_own on public.outfit_items;
create policy outfit_items_update_own on public.outfit_items
for update to authenticated
using (
  exists (
    select 1 from public.outfits as o
    where o.id = outfit_id and o.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.outfits as o
    where o.id = outfit_id and o.user_id = (select auth.uid())
  )
  and (
    source_type = 'catalog'
    or exists (
      select 1 from public.wardrobe_items as w
      where w.id = wardrobe_item_id and w.user_id = (select auth.uid())
    )
  )
);

drop policy if exists outfit_items_delete_own on public.outfit_items;
create policy outfit_items_delete_own on public.outfit_items
for delete to authenticated using (
  exists (
    select 1 from public.outfits as o
    where o.id = outfit_id and o.user_id = (select auth.uid())
  )
);

revoke all on public.wardrobe_items, public.outfits, public.outfit_items from public, anon;
grant select, insert, update, delete on public.wardrobe_items to authenticated;
grant select, insert, update, delete on public.outfits to authenticated;
grant select, insert, update, delete on public.outfit_items to authenticated;
commit;
-- Failure: stop; ROLLBACK any still-open failed transaction. Never continue to the RPC file.
-- Successful installation rollback: do not DROP data-bearing tables automatically.
-- Leave the schema intact and stop client use pending review; this file changes no existing user rows.

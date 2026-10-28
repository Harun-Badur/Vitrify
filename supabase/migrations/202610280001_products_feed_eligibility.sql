-- Catalog enrichment state on products. Values are written only by
-- scripts/backfillCatalogEnrichment.ts (service role); this file backfills nothing.
-- feed_eligible defaults to false: a new product enters no feed until it is enriched.
-- Color, subtype and fit stay in product_attributes (colors, subcategory, fit).
-- RLS, policies and grants are unchanged. The existing table-level SELECT grant
-- covers the new columns; the final block verifies that and rolls back otherwise.

begin;

do $precondition$
declare
  problems text;
begin
  if to_regclass('public.products') is null or to_regclass('public.product_attributes') is null then
    raise exception 'products_feed_eligibility: public.products or public.product_attributes is missing';
  end if;

  select string_agg(format('%s.%s (%s)', expected.table_name, expected.column_name, expected.data_type), ', ')
    into problems
  from (values
    ('products', 'id', 'text'),
    ('products', 'title', 'text'),
    ('products', 'brand', 'text'),
    ('products', 'category', 'text'),
    ('products', 'product_url', 'text'),
    ('products', 'image_url', 'text'),
    ('products', 'price', 'numeric'),
    ('product_attributes', 'product_id', 'text'),
    ('product_attributes', 'colors', 'ARRAY'),
    ('product_attributes', 'fit', 'text'),
    ('product_attributes', 'subcategory', 'text')
  ) as expected (table_name, column_name, data_type)
  where not exists (
    select 1 from information_schema.columns as actual
    where actual.table_schema = 'public'
      and actual.table_name = expected.table_name
      and actual.column_name = expected.column_name
      and actual.data_type = expected.data_type
  );
  if problems is not null then
    raise exception 'products_feed_eligibility: unexpected schema, missing or retyped: %', problems;
  end if;

  -- A rerun is allowed only when an existing new column already has the target type.
  select string_agg(format('%s is %s', actual.column_name, actual.data_type), ', ')
    into problems
  from information_schema.columns as actual
  join (values
    ('gender', 'text'),
    ('feed_eligible', 'boolean'),
    ('eligibility_missing', 'ARRAY'),
    ('attribute_source', 'text'),
    ('attribute_version', 'integer')
  ) as target (column_name, data_type) on target.column_name = actual.column_name
  where actual.table_schema = 'public'
    and actual.table_name = 'products'
    and actual.data_type <> target.data_type;
  if problems is not null then
    raise exception 'products_feed_eligibility: column already exists with another type: %', problems;
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.products'::regclass) then
    raise exception 'products_feed_eligibility: RLS is not enabled on public.products';
  end if;
end;
$precondition$;

alter table public.products
  add column if not exists gender text,
  add column if not exists feed_eligible boolean not null default false,
  add column if not exists eligibility_missing text[],
  add column if not exists attribute_source text,
  add column if not exists attribute_version integer;

alter table public.products
  drop constraint if exists products_gender_check;

alter table public.products
  add constraint products_gender_check
  check (gender is null or gender in ('kadin', 'erkek', 'unisex', 'cocuk'));

do $verify$
declare
  v_role text;
  v_column text;
begin
  if (select is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'products' and column_name = 'feed_eligible') <> 'NO'
    or coalesce((select column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'products' and column_name = 'feed_eligible'), '') <> 'false' then
    raise exception 'products_feed_eligibility: feed_eligible must be NOT NULL DEFAULT false';
  end if;

  foreach v_role in array array['anon', 'authenticated'] loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'products'
        and cmd in ('SELECT', 'ALL') and permissive = 'PERMISSIVE'
        and (v_role = any (roles) or 'public' = any (roles))
    ) then
      raise exception 'products_feed_eligibility: no SELECT policy on products for %', v_role;
    end if;
    foreach v_column in array array['gender', 'feed_eligible', 'eligibility_missing', 'attribute_source', 'attribute_version'] loop
      if not has_column_privilege(v_role, 'public.products', v_column, 'SELECT') then
        raise exception 'products_feed_eligibility: % cannot read products.%', v_role, v_column;
      end if;
    end loop;
  end loop;
end;
$verify$;

commit;

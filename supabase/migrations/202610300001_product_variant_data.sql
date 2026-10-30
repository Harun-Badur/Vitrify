-- Scraped color/size variants per product (variant pilot: lcw, flo).
-- Review only; NOT applied by Claude. Nullable columns, IF NOT EXISTS, safe to re-run.
-- No grant/RLS change: existing table-level SELECT grants and policies on public.products cover new columns.
-- Client keeps these columns out of its select until PRODUCT_VARIANT_COLUMNS_ENABLED is flipped.
begin;

alter table public.products
  add column if not exists color_variants jsonb null,
  add column if not exists size_options jsonb null,
  add column if not exists variants_fetched_at timestamptz null;

commit;

-- ROLLBACK (run manually; drops the scraped data):
-- begin;
-- alter table public.products
--   drop column if exists color_variants,
--   drop column if exists size_options,
--   drop column if exists variants_fetched_at;
-- commit;

-- PROPOSAL ONLY. Not a migration: do NOT move to supabase/migrations/ and do NOT apply
-- without the owner's review. Staging first (Vitrify-A1-Staging), never production from here.
--
-- Why: the Merchant feed importer (scripts/importMerchantFeed.ts, dry-run today) writes brand slugs
-- as products.provider, and needs a way to retire products that left the feed.
-- AGENTS.md A1 question "which S# scenario does this close?": none. This is catalog work, outside
-- the A1 account-deletion scope; it touches no Storage, auth or deletion path.
--
-- Data-loss note: nothing here deletes or rewrites product rows. Existing rows keep is_active=true.

begin;

-- (a) Replace the closed provider list with a slug rule. Every current value
-- (amazon, trendyol, hepsiburada, mock, boyner, mavi, lcw, defacto, flo) already matches it.
-- Matches isValidProviderSlug in scripts/lib/merchantFeed/mapRow.ts.
alter table public.products drop constraint if exists products_provider_check;
alter table public.products
  add constraint products_provider_check
  check (provider ~ '^[a-z][a-z0-9]{1,23}$');

-- (b) Activity flag. DEFAULT true keeps every existing row visible. Constant default: no table rewrite.
alter table public.products
  add column if not exists is_active boolean not null default true,
  add column if not exists last_seen_at timestamptz null;

-- Existing table-level SELECT grants and the products_select_anon policy cover the new columns
-- (same situation as 202610280001_products_feed_eligibility.sql).

-- Optional, only if feed queries get slow after (c): partial index for the gated paths.
-- create index if not exists products_feed_active_idx on public.products (gender)
--   where feed_eligible and is_active;

commit;

-- =============================================================================
-- (c) Where is_active must join the feed/active conditions. LISTED ONLY, nothing changed here.
-- Rule of thumb: discovery/feed paths gate on is_active = true; history paths (likes,
-- favorites, wardrobe pairing, lookups by id) must NOT, so a user still sees what they saved.
-- =============================================================================
-- GATE (add `.eq('is_active', true)` / `and is_active`):
--   1. supabase/functions/recs-feed/index.ts:405-409  select ... .eq(FEED_ELIGIBLE_COLUMN, true)
--        also add is_active to the select list; row loop at :486 (isFeedEligibleRow) and
--        :501 (isActiveCatalogRecord) are where a row-level check would go.
--   2. services/productService.ts:242  client.from('products').select(columns).eq(FEED_ELIGIBLE_COLUMN, true)
--        (feed query), with the row filters at :269 (isFeedEligibleRow), :311/:316 (isActiveCatalogRecord)
--        and :583 (isFeedEligibleProduct && isActiveCatalogRecord, complement strip).
--   3. lib/feedEligibility.ts + lib/catalogEligibility.ts: the single place to teach
--      isFeedEligibleRow / isActiveCatalogRecord about is_active (both also bundled into the Edge function).
--   4. services/catalogProductAdapter.ts:173 maps feed_eligible -> feedEligible; add isActive the same way.
--   5. src/intelligence/recommendations/complementaryProductsForDisplay.ts:14 (pool gated "at the query";
--      follows from 2).
--   6. supabase/price_tracking.sql:35 `from public.products as p` (price-drop view): decide whether
--      drop alerts for inactive products should keep firing.
--   7. scripts/backfillCatalogEnrichment.ts:95 (feed_eligible count) and previewCatalogEnrichment.ts:
--      reporting only; add an is_active split.
-- DO NOT GATE (history / by-id lookups):
--   - services/productRepository.ts:121-124  (select ... .in('id', batch))
--   - services/likeService.ts:128             (liked products by id)
--   - Dolap/wardrobe lookups that resolve stored product ids.
-- Importer side (next stage): set last_seen_at = now() for every product present in the feed;
-- products absent for N runs get is_active = false (soft retire, reversible), never deleted.

-- =============================================================================
-- ROLLBACK (run manually, only if needed)
-- =============================================================================
-- begin;
--   -- Fails on purpose if rows with a new provider slug exist: remove or migrate them first.
--   alter table public.products drop constraint if exists products_provider_check;
--   alter table public.products
--     add constraint products_provider_check
--     check (provider in (
--       'amazon', 'trendyol', 'hepsiburada', 'mock',
--       'boyner', 'mavi', 'lcw', 'defacto', 'flo'
--     ));
--   -- Drops the activity data (is_active, last_seen_at).
--   alter table public.products
--     drop column if exists is_active,
--     drop column if exists last_seen_at;
-- commit;

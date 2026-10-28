import { isActiveCatalogRecord } from '../lib/catalogEligibility';
import { catalogMetadataRepair } from '../lib/catalogMetadata';
import { FEED_ELIGIBLE_COLUMN, isFeedEligibleProduct, isFeedEligibleRow } from '../lib/feedEligibility';
import { measureDiscoverStage, measureDiscoverStageSync, recordDiscoverStage } from '../lib/discoverStageTiming';
import { DISCOVER_CATALOG_PAGE_SIZE, isRecord, isFeedProductRow, isAttributeRow, mapFeedRow } from './catalogProductAdapter';
import { MOCK_PRODUCTS } from '../data/mockProducts';
import { getProductRepository, productsById } from './productRepository';
import { track } from '../lib/analytics';
import { hasAnyFilter, type FeedQueryFilters } from '../lib/feedQuery';
import { logger } from '../lib/logger';
import { allowedGendersFor, effectiveProductPref, type ProductPref } from '../lib/productPreferenceRules';
import { fetchRecsConfig, fetchStyleProfileSnapshot } from '../lib/recsConfig';
import { setLastFeedMode, setLastRecommendationId } from '../lib/recsFeedState';
import { emptySessionIntent } from '../lib/scoring';
import { buildIntent } from '../lib/sessionIntent';
import { getSupabaseClient } from '../lib/supabase';
import { pickDisplayReason } from '../lib/displayReason';
import { rankCatalog } from '../src/intelligence/ranking/rankCatalog';
import { selectRecommendationPool } from '../src/intelligence/recommendations/selectRecommendationPool';
import { runCooperatively } from '../src/intelligence/cooperativeWork';
import {
  ensureNonEmptyFeed,
  selectLocalFeed,
} from '../src/intelligence/recommendations/feedFallback';
import {
  enrichProduct,
  resolveCatalogOutfitRole,
  type ProductAttributeRow,
} from '../src/intelligence/style/productStyle';
import {
  isGarmentCategory,
  isOutfitRole,
  type Product,
} from '../types/product';
import type {
  FeedMode,
  RecsFeedResponse,
  SessionIntent,
} from '../types/recommendation';
import { DEFAULT_FEED_MODE } from '../types/recommendation';
import { recordCount, span } from '../lib/perfTrace';

export { filterProducts } from '../src/intelligence/filters/productFilters';
export type { ProductFilters } from '../src/intelligence/filters/productFilters';
export { toScoringCandidate } from '../src/intelligence/ranking/productCandidate';
export { inferGenderFromTitle } from '../src/intelligence/style/productStyle';
export type { ProductGender } from '../types/product';

export type FeedSource = 'supabase' | 'mock' | 'edge';

export class FeedServiceError extends Error {
  constructor(public readonly code: 'FEED_AUTH' | 'FEED_SERVER' | 'FEED_NETWORK' | 'FEED_TIMEOUT' | 'FEED_RESPONSE') {
    super(code); this.name = 'FeedServiceError';
  }
}

export interface FetchFeedProductsResult {
  hasMore?: boolean;
  products: Product[];
  source: FeedSource;
  isPersonalized: boolean;
  recommendationId?: string;
  /** True when personal recs substituted after empty search mask. */
  fallback?: boolean;
  /** Soft facets dropped during progressive relax. */
  relaxed?: string[];
  warning?: 'LOCAL_RANK_FAILED';
}

const DEFAULT_FEED_LIMIT = 20;
const CATALOG_PAGE_SIZE = DISCOVER_CATALOG_PAGE_SIZE;
const MAX_RECOMMENDATION_CATALOG_PAGES = 20;
// A response deadline, not a warm-request latency target: cold Edge startup
// and mobile networking may legitimately exceed the former 1.2s limit.
const EDGE_TIMEOUT_MS = 10_000;
let edgeSupportsPagination: boolean | undefined;

const isProductSnapshotLite = (value: unknown): value is Product => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.imageUrl === 'string' &&
    typeof value.title === 'string' &&
    typeof value.price === 'number' &&
    Number.isFinite(value.price) &&
    typeof value.brand === 'string' &&
    typeof value.category === 'string' &&
    isGarmentCategory(value.category)
  );
};

interface FeedItemReference {
  productId: string;
  score: number;
  reasons: string[];
  position: number;
}
type FeedResponseReferences = Omit<RecsFeedResponse, 'items'> & { items: FeedItemReference[] };

const parseFeedItem = (value: unknown): FeedItemReference | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (!isProductSnapshotLite(value.product)) {
    return null;
  }
  const reasons = Array.isArray(value.reasons)
    ? value.reasons.filter((item): item is string => typeof item === 'string')
    : [];
  const score =
    typeof value.score === 'number' && Number.isFinite(value.score)
      ? value.score
      : 0;
  const position =
    typeof value.position === 'number' && Number.isFinite(value.position)
      ? value.position
      : 0;
  return {
    productId: value.product.id,
    score,
    reasons,
    position,
  };
};

const parseFeedResponse = (value: unknown): FeedResponseReferences | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.recommendation_id !== 'string' ||
    typeof value.score_id !== 'string' ||
    typeof value.config_version !== 'string' ||
    !Array.isArray(value.items)
  ) {
    return null;
  }
  const items = value.items
    .map(parseFeedItem)
    .filter((item): item is FeedItemReference => item !== null);
  const relaxed = Array.isArray(value.relaxed)
    ? value.relaxed.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    recommendation_id: value.recommendation_id,
    score_id: value.score_id,
    config_version: value.config_version,
    items,
    has_more: typeof value.has_more === 'boolean' ? value.has_more : undefined,
    fallback: value.fallback === true,
    relaxed,
  };
};

export const getRecsFeedUrl = (): string | null => {
  const explicit = process.env.EXPO_PUBLIC_RECS_FEED_URL?.trim().replace(
    /\/+$/,
    '',
  );
  if (explicit) {
    return explicit;
  }

  const proxyUrl = process.env.EXPO_PUBLIC_VTON_PROXY_URL?.trim().replace(
    /\/+$/,
    '',
  );
  if (proxyUrl) {
    return proxyUrl.replace(/\/vton-proxy$/, '/recs-feed');
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim().replace(
    /\/+$/,
    '',
  );
  if (!supabaseUrl) {
    return null;
  }
  return `${supabaseUrl}/functions/v1/recs-feed`;
};

const neverEmpty = (products: Product[]): Product[] =>
  ensureNonEmptyFeed(products, MOCK_PRODUCTS);

const CATALOG_CACHE_MS = 60_000;
type CatalogQueryResult = { data: unknown[] | null; error: { message: string } | null };
const catalogPages = new Map<string, { at: number; result: Promise<CatalogQueryResult> }>();
const preparedCatalogProducts = new Map<string, { at: number; key: string; product: Product }>();
let catalogCacheClient: ReturnType<typeof getSupabaseClient>;

interface DeferredCatalogProduct {
  product: Product;
  attributes: ProductAttributeRow | undefined;
  rowKey: string;
  cacheable: boolean;
}
interface CatalogPage {
  products: Product[];
  hasMore: boolean;
  deferred?: Map<string, DeferredCatalogProduct>;
}

const queryCatalogPage = async (
  productPref: ProductPref,
  excludeIds: readonly string[] = [],
  offset = 0,
  deferEnrichment = false,
): Promise<CatalogPage> => {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase bağlantısı yok');
  }
  if (catalogCacheClient !== client) {
    catalogPages.clear();
    preparedCatalogProducts.clear();
    catalogCacheClient = client;
  }

  const productSelectWithImages =
    'id, provider, external_id, title, brand, price, current_price, previous_price, last_price_checked_at, currency, image_url, images, product_url, category, affiliate_url, colors, sizes, created_at, feed_eligible';
  const productSelectLegacy =
    'id, provider, external_id, title, brand, price, current_price, previous_price, last_price_checked_at, currency, image_url, product_url, category, affiliate_url, colors, sizes, created_at, feed_eligible';

  const genders = allowedGendersFor(productPref);
  let productsResult: {
    data: unknown[] | null;
    error: { message: string } | null;
  } = await measureDiscoverStage('catalog.products', () => catalogQuery(productSelectWithImages));

  function catalogQuery(columns: string) {
    const serverExclusions = excludeIds.slice(0, CATALOG_PAGE_SIZE);
    const key = JSON.stringify([columns, genders, [...serverExclusions].sort(), offset]);
    const cached = catalogPages.get(key);
    if (cached && Date.now() - cached.at < CATALOG_CACHE_MS) { recordDiscoverStage('catalog.cache', 0); return cached.result; }
    // Fail closed: a missing column is an error, never an unfiltered catalog.
    // Same hard gender filter as recs-feed; 'hepsi' is the full kadin/erkek/unisex set.
    let query = client!.from('products').select(columns).eq(FEED_ELIGIBLE_COLUMN, true).in('gender', [...genders])
      .order('created_at', { ascending: true }).order('id');
    if (excludeIds.length > 0) {
      // Bound the GET URL: a long session of UUIDs can exceed gateway URL limits.
      query = query.not('id', 'in', `(${excludeIds.slice(0, CATALOG_PAGE_SIZE).map(id => `"${id.replace(/["\\]/g, '')}"`).join(',')})`);
    }
    const entry = { at: Date.now(), result: Promise.resolve(query.range(offset, offset + CATALOG_PAGE_SIZE)) };
    catalogPages.set(key, entry);
    if (catalogPages.size > 12) catalogPages.delete(catalogPages.keys().next().value!);
    void entry.result.then(result => {
      if (result.error && catalogPages.get(key) === entry) catalogPages.delete(key);
    }, () => { if (catalogPages.get(key) === entry) catalogPages.delete(key); });
    return entry.result;
  }

  if (
    productsResult.error &&
    /column .*images.* does not exist/i.test(productsResult.error.message)
  ) {
    logger.warn('products.images yok; legacy select kullanılıyor');
    productsResult = await measureDiscoverStage('catalog.products', () => catalogQuery(productSelectLegacy));
  }

  if (productsResult.error) throw new Error(productsResult.error.message);
  const excluded = new Set(excludeIds);
  const rows = (productsResult.data ?? []).slice(0, CATALOG_PAGE_SIZE)
    .filter(row => !isRecord(row) || typeof row.id !== 'string' || !excluded.has(row.id));
  const validRows = rows.filter(isFeedProductRow).filter(isFeedEligibleRow);
  const cachedProducts = new Map<string, Product>();
  const ids: string[] = [];
  for (const row of validRows) {
    const cached = preparedCatalogProducts.get(row.id);
    if (cached && Date.now() - cached.at < CATALOG_CACHE_MS && cached.key === JSON.stringify(row)) {
      cachedProducts.set(row.id, cached.product);
    } else ids.push(row.id);
  }
  if (validRows.length === 0) return { products: [], hasMore: (productsResult.data?.length ?? 0) > CATALOG_PAGE_SIZE };

  let attributesResult: { data: unknown[] | null; error: { message: string } | null } = ids.length === 0
    ? { data: [], error: null } : await measureDiscoverStage('catalog.attributes', () => client
    .from('product_attributes')
    .select(
      'product_id, gender, colors, fit, subcategory, brand_slug, price_band, outfit_role',
    ).in('product_id', ids));

  if (
    attributesResult.error &&
    /column .*outfit_role.* does not exist/i.test(attributesResult.error.message)
  ) {
    attributesResult = await measureDiscoverStage('catalog.attributes', () => client
      .from('product_attributes')
      .select('product_id, gender, colors, fit, subcategory, brand_slug, price_band')
      .in('product_id', ids));
  }

  const attributesById = new Map<string, ProductAttributeRow>();
  for (const row of attributesResult.data ?? []) {
    if (isAttributeRow(row)) {
      attributesById.set(row.product_id, row);
    }
  }

  const repository = getProductRepository();
  const deferred = new Map<string, DeferredCatalogProduct>();
  function* prepareProducts(): Generator<void, Product[], void> {
    const products: Product[] = [];
    for (const row of validRows) {
      const cached = cachedProducts.get(row.id);
      if (cached) {
        if (isActiveCatalogRecord(cached)) products.push(cached);
      } else {
        const product = mapFeedRow(row);
        if (product) {
          const attributes = attributesById.get(product.id);
          if (!isActiveCatalogRecord(product, attributes)) continue;
          if (deferEnrichment) {
            // Pool seats depend only on provider/id/role, including existing P0 repairs.
            // Never publish these lightweight records to the canonical repository/UI.
            products.push({ ...product, outfitRole: resolveCatalogOutfitRole(product.category,
              catalogMetadataRepair(product.id)?.outfitRole ?? (isOutfitRole(attributes?.outfit_role) ? attributes.outfit_role : product.outfitRole)) });
            deferred.set(product.id, { product, attributes, rowKey: JSON.stringify(row), cacheable: !attributesResult.error });
          } else {
            const enriched = repository.register([enrichProduct(product, attributes)])[0];
            products.push(enriched);
            if (!attributesResult.error) {
              preparedCatalogProducts.set(row.id, { at: Date.now(), key: JSON.stringify(row), product: enriched });
              if (preparedCatalogProducts.size > 400) preparedCatalogProducts.delete(preparedCatalogProducts.keys().next().value!);
            }
          }
        }
      }
      yield;
    }
    return products;
  }
  const prepared = await measureDiscoverStage('catalog.prepare', () => runCooperatively(prepareProducts(), { diagnosticStage: 'catalog' }));
  if (deferEnrichment) return { products: prepared, deferred, hasMore: (productsResult.data?.length ?? 0) > CATALOG_PAGE_SIZE };
  const resolved = await measureDiscoverStage('catalog.resolve', () => repository.productsById(prepared.map(product => product.id)));
  const products = prepared.map(product => resolved.get(product.id)!);
  return { products, hasMore: (productsResult.data?.length ?? 0) > CATALOG_PAGE_SIZE };
};

let initialCatalogRequest: { productPref: ProductPref; result: Promise<{ products: Product[]; hasMore: boolean }> } | null = null;
const fetchCatalogPage = (productPref: ProductPref, excludeIds: readonly string[] = [], offset = 0, deferEnrichment = false) => {
  // SQL page promises are still shared; lightweight records never enter feed-page requests.
  if (deferEnrichment) return queryCatalogPage(productPref, excludeIds, offset, true);
  if (excludeIds.length > 0 || offset > 0) return queryCatalogPage(productPref, excludeIds, offset);
  if (initialCatalogRequest?.productPref !== productPref) {
    const request = { productPref, result: queryCatalogPage(productPref).finally(() => {
      if (initialCatalogRequest === request) initialCatalogRequest = null;
    }) };
    initialCatalogRequest = request;
  }
  return initialCatalogRequest.result;
};

// The swipe feed still reads the oldest page. Recommendations need later imports too,
// then a bounded pool so outfit search does not combine the whole catalog.
let recommendationPool: { products: Product[]; at: number; productPref: ProductPref } | null = null;
let recommendationPoolClient: ReturnType<typeof getSupabaseClient>;
let recommendationRequest: { productPref: ProductPref; result: Promise<Product[]> } | null = null;

/** Drops the preference-scoped catalog caches; prepared product records are preference-free and stay. */
export const resetProductPrefCatalogCaches = (): void => {
  catalogPages.clear();
  initialCatalogRequest = null;
  recommendationPool = null;
  recommendationRequest = null;
};

const loadRecommendationCatalog = async (productPref: ProductPref): Promise<Product[]> => {
  const client = getSupabaseClient();
  const collected: Product[] = [];
  let offset = 0;
  const deferred = new Map<string, DeferredCatalogProduct>();
  const collect = (page: CatalogPage) => {
    collected.push(...page.products);
    for (const [id, value] of page.deferred ?? []) deferred.set(id, value);
  };
  let page = await fetchCatalogPage(productPref, [], offset, true);
  collect(page);
  let pages = 1;
  while (page.hasMore && pages < MAX_RECOMMENDATION_CATALOG_PAGES) {
    // Bound concurrency to two pages. Keep the same ordered scan and pool;
    // a terminal page may cause at most one speculative empty read.
    const batchSize = Math.min(2, MAX_RECOMMENDATION_CATALOG_PAGES - pages);
    const batch = await Promise.all(Array.from({ length: batchSize }, (_, index) =>
      fetchCatalogPage(productPref, [], offset + (index + 1) * CATALOG_PAGE_SIZE, true)));
    for (const next of batch) {
      collect(next);
      page = next;
      pages += 1;
      offset += CATALOG_PAGE_SIZE;
      if (!page.hasMore) break;
    }
  }
  recordCount('catalog_load_pages', pages);
  const selected = measureDiscoverStageSync('catalog.pool', () => selectRecommendationPool(collected));
  const repository = getProductRepository();
  function* enrichSelected(): Generator<void, Product[], void> {
    const result: Product[] = [];
    for (const product of selected) {
      const pending = deferred.get(product.id);
      if (!pending) result.push(product);
      else {
        const enriched = repository.register([enrichProduct(pending.product, pending.attributes)])[0];
        result.push(enriched);
        if (pending.cacheable) {
          preparedCatalogProducts.set(product.id, { at: Date.now(), key: pending.rowKey, product: enriched });
          if (preparedCatalogProducts.size > 400) preparedCatalogProducts.delete(preparedCatalogProducts.keys().next().value!);
        }
      }
      yield;
    }
    return result;
  }
  const products = await measureDiscoverStage('catalog.prepare', () => runCooperatively(enrichSelected(), { diagnosticStage: 'catalog' }));
  if (getSupabaseClient() === client) {
    recommendationPool = { products, at: Date.now(), productPref };
    recommendationPoolClient = client;
  }
  return products;
};

/** NULL preference is 'hepsi'. Each preference has its own pool; another preference's pool is never served. */
export const fetchRecommendationCatalog = (preference: ProductPref | null = null): Promise<Product[]> => {
  const productPref = effectiveProductPref(preference);
  const client = getSupabaseClient();
  // Page cache may already have switched clients during a feed read.
  // Compare against the pool's own source, not the page cache's source.
  if (recommendationPoolClient !== client) recommendationPool = null;
  if (recommendationPool?.productPref === productPref && Date.now() - recommendationPool.at < 60_000) {
    recordDiscoverStage('catalog.cache', 0);
    return Promise.resolve(recommendationPool.products);
  }
  if (recommendationRequest?.productPref !== productPref) {
    const request = { productPref, result: measureDiscoverStage('catalog.total', () => span('catalog_load', () => loadRecommendationCatalog(productPref)))
      .finally(() => { if (recommendationRequest === request) recommendationRequest = null; }) };
    recommendationRequest = request;
  }
  return recommendationRequest.result;
};

const rankLocally = async (
  catalog: Product[],
  userId: string,
  intent: SessionIntent,
  limit: number,
  mode: FeedMode,
): Promise<Product[]> => {
  const [config, profile] = await Promise.all([
    fetchRecsConfig(),
    fetchStyleProfileSnapshot(userId),
  ]);
  return neverEmpty(
    rankCatalog(catalog, userId, intent, limit, mode, config, profile),
  );
};

const fetchEdgeFeed = async (
  userId: string,
  intent: SessionIntent,
  limit: number,
  mode: FeedMode,
  filters: FeedQueryFilters = {},
  excludeIds: readonly string[] = [],
  productPref: ProductPref = 'hepsi',
): Promise<RecsFeedResponse | null> => {
  const url = getRecsFeedUrl();
  const client = getSupabaseClient();
  if (!url || !client || (edgeSupportsPagination === false && excludeIds.length > 0)) {
    return null;
  }

  const { data, error } = await client.auth.getSession();
  const accessToken = data.session?.access_token?.trim();
  if (error) throw new FeedServiceError('FEED_AUTH');
  if (!accessToken) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, EDGE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        limit,
        intent,
        mode,
        filters: hasAnyFilter(filters) ? filters : undefined,
        exclude_ids: excludeIds,
        gender_pref: productPref,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new FeedServiceError(response.status === 401 || response.status === 403 ? 'FEED_AUTH' : 'FEED_SERVER');
    }
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new FeedServiceError('FEED_RESPONSE'); }
    const parsed = parseFeedResponse(payload);
    if (!parsed) throw new FeedServiceError('FEED_RESPONSE');
    edgeSupportsPagination = typeof parsed.has_more === 'boolean';
    // Preserve the first legacy ranking, but never reuse a finite legacy response as a next page.
    if (!edgeSupportsPagination && (excludeIds.length > 0 || parsed.items.length === 0)) return null;
    let resolved: ReadonlyMap<string, Product>;
    try { resolved = await productsById(parsed.items.map(item => item.productId)); }
    catch { throw new FeedServiceError('FEED_SERVER'); }
    // A missing catalog record follows the existing unavailable-edge fallback.
    if (parsed.items.some(item => !resolved.has(item.productId))) return null;
    return { ...parsed, items: parsed.items.map(({ productId, ...metadata }) => {
      const product = resolved.get(productId)!;
      product.reason = pickDisplayReason(metadata.reasons);
      product.reasons = metadata.reasons;
      return { ...metadata, product };
    }) };
  } catch (error) {
    if (error instanceof FeedServiceError) throw error;
    if (controller.signal.aborted) throw new FeedServiceError('FEED_TIMEOUT');
    throw new FeedServiceError('FEED_NETWORK');
  } finally {
    clearTimeout(timeout);
  }
};

const fetchFeedProductsUntraced = async (
  limit = DEFAULT_FEED_LIMIT,
  userId: string | null = null,
  mode: FeedMode = DEFAULT_FEED_MODE,
  filters: FeedQueryFilters = {},
  telemetryMode?: 'personal' | 'trend' | 'search',
  excludeIds: readonly string[] = [],
  preference: ProductPref | null = null,
): Promise<FetchFeedProductsResult> => {
  const startedAt = Date.now();
  // NULL (not chosen) is sent and filtered as 'hepsi'.
  const productPref = effectiveProductPref(preference);
  const intent = userId ? buildIntent() : emptySessionIntent();
  if (filters.category && !intent.constraints.category) {
    intent.constraints.category = filters.category;
  }
  setLastRecommendationId(null);
  setLastFeedMode(telemetryMode ?? mode);

  if (userId) {
    const edge = await span('feed_edge_rank', () => fetchEdgeFeed(userId, intent, limit, mode, filters, excludeIds, productPref));
    const excluded = new Set(excludeIds);
    if (edge && edge.has_more === true && !edge.items.some(item => !excluded.has(item.product.id))) {
      throw new FeedServiceError('FEED_RESPONSE');
    }
    // An empty/non-progressing batch with hasMore cannot be advanced using ID exclusions.
    if (edge && (edge.has_more === false || edge.items.some(item => !excluded.has(item.product.id)))) {
      setLastRecommendationId(edge.recommendation_id);
      logger.debug('recs-feed timing', {
        ms: Date.now() - startedAt,
        source: 'edge',
        n: edge.items.length,
        fallback: edge.fallback === true,
      });
      const edgeProducts = edge.items.map((item) => item.product).filter(product => {
        if (excluded.has(product.id)) return false;
        excluded.add(product.id);
        return isFeedEligibleProduct(product) && isActiveCatalogRecord(product);
      });
      return {
        hasMore: edge.has_more ?? true,
        products: edgeProducts,
        source: 'edge',
        isPersonalized: true,
        recommendationId: edge.recommendation_id,
        fallback: edge.fallback === true,
        relaxed: edge.relaxed ?? [],
      };
    }

    logger.debug('feed_fallback', { reason: 'edge_unavailable' });
    track('feed_fallback', null, { reason: 'edge_unavailable' });
  }

  let offset = 0;
  let page = await fetchCatalogPage(productPref, excludeIds, offset);
  const poolRows = [...page.products];
  while (poolRows.length < CATALOG_PAGE_SIZE && page.hasMore) {
    offset += CATALOG_PAGE_SIZE;
    page = await fetchCatalogPage(productPref, excludeIds, offset);
    poolRows.push(...page.products);
  }
  // Keep the original bounded ranking workload; later products remain available for future batches.
  const catalog = [...new Map(poolRows.map(product => [product.id, product])).values()].slice(0, CATALOG_PAGE_SIZE);
  const poolHasMore = page.hasMore || poolRows.length > catalog.length;
  if (catalog.length === 0) return { products: [], hasMore: false, source: 'supabase', isPersonalized: false };

  if (!userId) {
    const selected = selectLocalFeed(catalog, filters, limit);
    return {
      products: selected.products,
      hasMore: poolHasMore || catalog.length > selected.products.length,
      source: 'supabase',
      isPersonalized: false,
      fallback: selected.fallback,
      relaxed: selected.relaxed,
    };
  }

  try {
    const ranked = await span('feed_local_rank', () => rankLocally(catalog, userId, intent, limit * 3, mode));
    const selected = selectLocalFeed(ranked, filters, limit);
    logger.debug('recs-feed timing', {
      ms: Date.now() - startedAt,
      source: 'supabase',
      n: selected.selectedCount,
      fallback: selected.fallback,
      relaxed: selected.relaxed,
    });
    return {
      products: selected.products,
      hasMore: poolHasMore || catalog.length > selected.products.length,
      source: 'supabase',
      isPersonalized: true,
      fallback: selected.fallback,
      relaxed: selected.relaxed,
    };
  } catch (error) {
    logger.warn('Yerel skorlama düştü; katalog sırası kullanılıyor', { code: 'LOCAL_RANK_FAILED' });
    track('feed_fallback', null, { reason: 'local_rank_failed' });
    const selected = selectLocalFeed(catalog, filters, limit);
    return {
      products: selected.products,
      hasMore: poolHasMore || catalog.length > selected.products.length,
      source: 'supabase',
      isPersonalized: false,
      warning: 'LOCAL_RANK_FAILED',
      fallback: selected.fallback,
      relaxed: selected.relaxed,
    };
  }
};

/** Same behavior as before; only the total duration is timed (opt-in, see lib/perfTrace). */
export const fetchFeedProducts = (
  ...args: Parameters<typeof fetchFeedProductsUntraced>
): ReturnType<typeof fetchFeedProductsUntraced> =>
  span('feed_fetch_total', () => fetchFeedProductsUntraced(...args));

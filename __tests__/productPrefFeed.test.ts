import { readFileSync } from 'fs';
import { join } from 'path';
import { MOCK_PRODUCTS } from '../data/mockProducts';
import { fetchFeedProducts, fetchRecommendationCatalog } from '../services/productService';
import { loadDiscoverRecommendationPacket } from '../services/discoverRecommendationCacheService';
import { DiscoverRecommendationCache } from '../lib/discoverRecommendationCache';
import { useAppStore } from '../store/useAppStore';
import { getSupabaseClient } from '../lib/supabase';
import { emptySessionIntent } from '../lib/scoring';
import { buildIntent } from '../lib/sessionIntent';
import { anchorContext, type RecommendationFeedPacket } from '../src/recommendationCache/feedPacket';
import { serializeFinal } from '../src/recommendationCache/codec';
import { complementaryProductsForDisplay } from '../src/intelligence/recommendations/complementaryProductsForDisplay';
import * as engine from '../src/intelligence/recommendations/getDiscoverRecommendations';
import { getProductRepository } from '../services/productRepository';
import type { Product } from '../types/product';

jest.mock('expo/virtual/env', () => ({ env: process.env }), { virtual: true });
jest.mock('../lib/supabase', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../lib/recsFeedState', () => ({ setLastFeedMode: jest.fn(), setLastRecommendationId: jest.fn() }));
jest.mock('../lib/sessionIntent', () => ({ buildIntent: jest.fn(), recordSessionProductAction: jest.fn(), resetSessionIntent: jest.fn() }));
jest.mock('../services/likeService', () => ({ insertPassedProduct: jest.fn(), insertLikedProduct: jest.fn() }));
jest.mock('../lib/logger', () => ({ logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

// Test-only catalog: 30 rows per gender, interleaved by created_at order.
const GENDERS = ['kadin', 'erkek', 'unisex'] as const;
const rows = Array.from({ length: 90 }, (_, index) => ({
  id: `pref-${String(index).padStart(3, '0')}`,
  provider: 'defacto', external_id: String(index), title: `Siyah Ürün ${index}`,
  brand: 'DeFacto', price: 100, currency: 'TRY',
  image_url: MOCK_PRODUCTS[0].imageUrl, images: [MOCK_PRODUCTS[0].imageUrl],
  product_url: 'https://example.com/product', affiliate_url: null,
  category: 'upper_body', created_at: '2026-01-01', feed_eligible: true, gender: GENDERS[index % 3],
}));
const genderOf = new Map(rows.map(row => [row.id, row.gender]));

const genderFilters: unknown[][] = [];
let productQueries = 0;
const backend = {
  auth: { getSession: jest.fn(async () => ({ data: { session: null as { access_token: string } | null }, error: null })) },
  from: (table: string) => {
    let excluded = new Set<string>();
    let genders: readonly string[] | null = null;
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      not: (_column: string, _operator: string, value: string) => { excluded = new Set(value.match(/pref-\d+/g) ?? []); return query; },
      in: (column: string, values: string[]) => {
        if (table === 'products' && column === 'gender') { genders = values; genderFilters.push(values); return query; }
        return Promise.resolve({ data: [], error: null });
      },
      range: (start: number, end: number) => {
        productQueries += 1;
        const data = rows.filter(row => !excluded.has(row.id) && (genders === null || genders.includes(row.gender)));
        return Promise.resolve({ data: data.slice(start, end + 1), error: null });
      },
    };
    return query;
  },
};

const resetStore = () => useAppStore.setState({ currentProducts: [], likedProducts: [], passedProductIds: [],
  passedStack: [], sessionUserId: null, feedStatus: 'idle', hasMore: true, isFetchingNext: false,
  feedMode: 'personal', productPref: null });

describe('product preference on the client feed', () => {
  beforeEach(() => {
    genderFilters.length = 0;
    productQueries = 0;
    backend.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    jest.mocked(buildIntent).mockImplementation(emptySessionIntent);
    jest.mocked(getSupabaseClient).mockReturnValue({ ...backend } as never);
    resetStore();
  });
  afterEach(() => { delete process.env.EXPO_PUBLIC_RECS_FEED_URL; jest.restoreAllMocks(); });

  it('filters the direct catalog path by the preference set; NULL reads the full 3-gender set like hepsi', async () => {
    const kadin = await fetchFeedProducts(20, null, 'personal', {}, undefined, [], 'kadin');
    expect(kadin.products.every(product => genderOf.get(product.id) !== 'erkek')).toBe(true);
    expect(genderFilters).toContainEqual(['kadin', 'unisex']);
    const none = await fetchFeedProducts(20, null);
    expect(genderFilters).toContainEqual(['kadin', 'erkek', 'unisex']);
    expect(none.products.map(product => product.id)).toEqual(rows.slice(0, 20).map(row => row.id));
    const hepsi = await fetchFeedProducts(20, null, 'personal', {}, undefined, [], 'hepsi');
    expect(hepsi.products.map(product => product.id)).toEqual(none.products.map(product => product.id));
  });

  it('keys catalog pages and the 60s recommendation pool by preference', async () => {
    const hepsi = await fetchRecommendationCatalog(null);
    expect(hepsi.some(product => genderOf.get(product.id) === 'erkek')).toBe(true);
    const queries = productQueries;
    const kadin = await fetchRecommendationCatalog('kadin');
    expect(productQueries).toBeGreaterThan(queries);
    expect(kadin.length).toBeGreaterThan(0);
    expect(kadin.some(product => genderOf.get(product.id) === 'erkek')).toBe(false);
    const erkek = await fetchRecommendationCatalog('erkek');
    expect(erkek.some(product => genderOf.get(product.id) === 'kadin')).toBe(false);
  });

  it('sends the effective preference to recs-feed as gender_pref (NULL is hepsi)', async () => {
    const products = (await fetchFeedProducts(20, null)).products;
    process.env.EXPO_PUBLIC_RECS_FEED_URL = 'https://example.com/recs-feed';
    backend.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'test-token' } }, error: null });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({
      recommendation_id: 'r', score_id: 's', config_version: 'v1', has_more: false,
      items: products.map(product => ({ product, score: 1, reasons: [], position: 1 })),
    }) } as Response);
    await fetchFeedProducts(20, 'user-1');
    await fetchFeedProducts(20, 'user-1', 'personal', {}, undefined, [], 'erkek');
    const bodies = fetchMock.mock.calls.map(call => JSON.parse(String(call[1]?.body)));
    expect(bodies.map(body => body.gender_pref)).toEqual(['hepsi', 'erkek']);
  });

  it('resets the deck on a preference change, never returns old IDs, and keeps likes and passes', async () => {
    await useAppStore.getState().loadFeed(null);
    const [liked, passed, ...rest] = useAppStore.getState().currentProducts;
    useAppStore.getState().swipeRight(liked);
    useAppStore.getState().swipeLeft(passed);
    const likedBefore = useAppStore.getState().likedProducts;
    expect(useAppStore.getState().passedStack).toHaveLength(1);
    useAppStore.getState().setProductPref('kadin');
    expect(useAppStore.getState().currentProducts).toEqual([]);
    expect(useAppStore.getState().passedStack).toEqual([]);
    await new Promise(resolve => setTimeout(resolve, 0));
    for (let i = 0; i < 20 && useAppStore.getState().feedStatus !== 'success'; i++) await new Promise(r => setTimeout(r, 0));
    const state = useAppStore.getState();
    expect(state.feedStatus).toBe('success');
    expect(state.currentProducts.length).toBeGreaterThan(0);
    expect(state.currentProducts.every(product => genderOf.get(product.id) !== 'erkek')).toBe(true);
    const old = new Set(rest.filter(product => genderOf.get(product.id) === 'erkek').map(product => product.id));
    expect(state.currentProducts.some(product => old.has(product.id))).toBe(false);
    expect(state.likedProducts).toBe(likedBefore);
    expect(state.passedProductIds).toEqual([passed.id]);
    expect(state.currentProducts.some(product => product.id === liked.id || product.id === passed.id)).toBe(false);
  });

  it('a no-op preference change (NULL to hepsi) keeps the deck as today', async () => {
    await useAppStore.getState().loadFeed(null);
    const deck = useAppStore.getState().currentProducts;
    useAppStore.getState().setProductPref('hepsi');
    expect(useAppStore.getState().currentProducts).toBe(deck);
    expect(useAppStore.getState().productPref).toBe('hepsi');
  });
});

describe('Discover cache leak across a preference change', () => {
  const base: Product = { id: 'k-top', title: 'Top', price: 100, brand: 'Brand', category: 'upper_body',
    outfitRole: 'top', imageUrl: 'top.jpg', garmentDescription: 'Top' };
  const kadinPool: Product[] = [base, { ...base, id: 'k-bottom', category: 'lower_body', outfitRole: 'bottom' },
    { ...base, id: 'u-shoes', category: 'shoes', outfitRole: 'shoes' }];
  const erkek: Product[] = [{ ...base, id: 'e-bottom', category: 'lower_body', outfitRole: 'bottom' },
    { ...base, id: 'e-shoes', category: 'shoes', outfitRole: 'shoes' }, { ...base, id: 'e-bag', category: 'bags', outfitRole: 'bag' }];

  afterEach(() => jest.restoreAllMocks());

  it('a hepsi-era cached final cannot surface an erkek product in a kadin session', async () => {
    const repository = getProductRepository();
    const hepsiPool = repository.register([...kadinPool, ...erkek].map(product => ({ ...product })));
    const hepsiContext = anchorContext(hepsiPool, hepsiPool[0], [], new Map());
    const hepsiFinal = engine.getDiscoverRecommendations(hepsiContext.input);
    expect(complementaryProductsForDisplay(hepsiFinal, 'k-top').some(product => product.id.startsWith('e-'))).toBe(true);
    // The user-scoped backend row was written while the preference was hepsi.
    const query: Record<string, jest.Mock> = {};
    for (const name of ['select', 'eq', 'gt', 'in', 'abortSignal']) query[name] = jest.fn(() => query);
    query.limit = jest.fn().mockResolvedValue({ data: [{ anchor_product_id: 'k-top', catalog_version: null,
      payload: serializeFinal(hepsiFinal, hepsiContext) }], error: null });
    jest.mocked(getSupabaseClient).mockReturnValue({ from: jest.fn(() => query) } as never);

    const pool = repository.register(kadinPool.map(product => ({ ...product })));
    const hepsiSession = new DiscoverRecommendationCache(pool, [], 'owner');
    const session = new DiscoverRecommendationCache(pool, [], 'owner', 'kadin');
    expect(session.contextFingerprint).not.toBe(hepsiSession.contextFingerprint);
    const request = session.request([pool[0]], 1);
    expect(request.productPref).toBe('kadin');
    const packets: RecommendationFeedPacket[] = [];
    await loadDiscoverRecommendationPacket(request, 'owner', new AbortController().signal, packet => {
      packets.push(packet);
      expect(session.accept(packet, [pool[0]])).toBe(true);
      // A packet prepared for the hepsi session is never accepted by the kadin one.
      expect(hepsiSession.accept(packet, [pool[0]])).toBe(false);
    });
    expect(packets).toHaveLength(1);
    expect(query.in).toHaveBeenCalledWith('scope', ['owner']);
    const shown = complementaryProductsForDisplay(session.lookup(pool[0])!, 'k-top');
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.some(product => product.id.startsWith('e-'))).toBe(false);
  });

  it('NULL preference keeps the session fingerprint and request as today', () => {
    const pool = getProductRepository().register(kadinPool.map(product => ({ ...product })));
    const legacy = new DiscoverRecommendationCache(pool, [], 'owner');
    expect(new DiscoverRecommendationCache(pool, [], 'owner', null).contextFingerprint).toBe(legacy.contextFingerprint);
    expect(new DiscoverRecommendationCache(pool, [], 'owner', 'hepsi').contextFingerprint).toBe(legacy.contextFingerprint);
    expect(legacy.request([pool[0]], 1).productPref).toBe('hepsi');
  });
});

describe('preference never reaches saved-product reads', () => {
  const source = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8');
  // Favoriler/Beğeniler (liked), Dolap (wardrobe) and try-on history.
  it.each(['services/productRepository.ts', 'store/favoritesSlice.ts', 'app/(tabs)/liked.tsx',
    'app/wardrobe/[section].tsx', 'app/wardrobe/create.tsx', 'services/likeService.ts',
    'services/vtonHistoryService.ts', 'components/TryOnHistorySheet.tsx'])('%s does not read productPref', file => {
    expect(source(file)).not.toMatch(/productPref|gender_pref|allowedGendersFor/);
  });
});

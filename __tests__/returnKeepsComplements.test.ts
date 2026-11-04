import { useAppStore } from '../store/useAppStore';
import { DiscoverRecommendationCache } from '../lib/discoverRecommendationCache';
import { prepareRecommendationFeedPacket } from '../scripts/lib/supabaseRecommendationCache';
import { RecommendationCacheWorker } from '../scripts/lib/recommendationCacheWorker';
import { insertLikedProduct, insertPassedProduct, deletePassedProduct } from '../services/likeService';
import type { LikedProduct, Product } from '../types/product';

jest.mock('../services/productService', () => ({ fetchFeedProducts: jest.fn() }));
jest.mock('../services/likeService', () => ({
  fetchLikedProducts: jest.fn(), fetchPassedProductIds: jest.fn(), insertLikedProduct: jest.fn(),
  insertPassedProduct: jest.fn(), deleteLikedProduct: jest.fn(), deletePassedProduct: jest.fn(), updateLikedProductAlert: jest.fn(),
}));
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../lib/sessionIntent', () => ({ recordSessionProductAction: jest.fn(), resetSessionIntent: jest.fn() }));
jest.mock('../lib/recsFeedState', () => ({ setLastFeedMode: jest.fn() }));
jest.mock('../lib/logger', () => ({ logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

// The complements cache looks cards up by object identity (entry.product === product), so a card that
// comes back through the return stack must be the very same object, or its panel reloads.
const top: Product = { id: 'top', title: 'Top', category: 'upper_body', outfitRole: 'top', price: 100,
  brand: 'Brand', imageUrl: 'top.jpg', garmentDescription: 'Top', gender: 'women' };
const bottom: Product = { ...top, id: 'bottom', title: 'Bottom', category: 'lower_body', outfitRole: 'bottom' };
const bag: Product = { ...top, id: 'bag', title: 'Bag', category: 'bags', outfitRole: 'bag' };
const stranger: Product = { ...top, id: 'stranger', title: 'Never prepared' };
const catalog = [top, bottom, bag];
const likedEntry = (product: Product): LikedProduct => ({ product, notifyOnPriceDrop: true, likedAt: '2026-01-01T00:00:00.000Z' });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const rows = () => {
  const map = new Map<string, string>();
  return { read: async (key: { fingerprint: string }) => map.get(key.fingerprint),
    write: async (key: { fingerprint: string }, payload: string) => { map.set(key.fingerprint, payload); } };
};
async function preparedCache(anchors: Product[]) {
  const cache = new DiscoverRecommendationCache(catalog, [], 'u');
  const packet = await prepareRecommendationFeedPacket(new RecommendationCacheWorker(rows()), cache.request(anchors, 1));
  expect(cache.accept(packet, anchors)).toBe(true);
  cache.activate(anchors[0]);
  return cache;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(insertLikedProduct).mockResolvedValue(undefined);
  jest.mocked(insertPassedProduct).mockResolvedValue(undefined);
  jest.mocked(deletePassedProduct).mockResolvedValue(undefined);
  useAppStore.setState({
    currentProducts: [bag, top, bottom], likedProducts: [], passedProductIds: [], passedStack: [],
    sessionUserId: 'user-1', sessionSyncStatus: 'success',
  });
});

describe('a card that comes back keeps its prepared complements', () => {
  test('passed card: the same object returns, the cache answers instantly, no new request', async () => {
    const cache = await preparedCache([bag, top, bottom]);
    const request = jest.spyOn(cache, 'request');
    const before = cache.lookup(bag);
    expect(before).toBeDefined();

    useAppStore.getState().swipeLeft(bag);
    await flush();
    const parked = useAppStore.getState().passedStack.at(-1);
    expect(parked?.product).toBe(bag);
    expect(cache.lookup(parked!.product)).toBe(before); // the -1 page also reads the cache

    await useAppStore.getState().undoPass();
    const returned = useAppStore.getState().currentProducts[0];
    expect(returned).toBe(bag);
    expect(cache.lookup(returned)).toBe(before);
    expect(request).not.toHaveBeenCalled();
  });
  test('liked card: same guarantee for the view-only return', async () => {
    const cache = await preparedCache([bag, top, bottom]);
    const request = jest.spyOn(cache, 'request');
    const before = cache.lookup(bag);
    useAppStore.setState({ likedProducts: [likedEntry(bag)] });

    useAppStore.getState().swipeLeft(bag);
    expect(useAppStore.getState().passedStack.at(-1)).toMatchObject({ kind: 'liked' });
    expect(useAppStore.getState().passedStack.at(-1)?.product).toBe(bag);
    expect(useAppStore.getState().undoPass()).toBe(true);

    const returned = useAppStore.getState().currentProducts[0];
    expect(returned).toBe(bag);
    expect(cache.lookup(returned)).toBe(before);
    expect(request).not.toHaveBeenCalled();
    expect(insertPassedProduct).not.toHaveBeenCalled();
  });
  test('a card the cache never prepared still misses (the old loading flow is untouched)', async () => {
    const cache = await preparedCache([bag, top, bottom]);
    useAppStore.setState({ currentProducts: [stranger] });
    useAppStore.getState().swipeLeft(stranger);
    await flush();
    await useAppStore.getState().undoPass();
    expect(cache.lookup(useAppStore.getState().currentProducts[0])).toBeUndefined();
  });
  test('a copy of the product is not the cached card (documents why identity must be kept)', async () => {
    const cache = await preparedCache([bag, top, bottom]);
    expect(cache.lookup({ ...bag })).toBeUndefined();
  });
  test('the card shown on the -1 page is the stack top itself, not a copy', async () => {
    useAppStore.getState().swipeLeft(top);
    await flush();
    const stack = useAppStore.getState().passedStack;
    expect(stack[stack.length - 1].product).toBe(top);
  });
});

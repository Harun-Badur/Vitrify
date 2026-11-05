import { MOCK_PRODUCTS } from '../data/mockProducts';
import { useAppStore } from '../store/useAppStore';
import { track } from '../lib/analytics';
import { detourConfig } from '../lib/detourConfig';
import { fetchFeedProducts } from '../services/productService';
import { deleteLikedProduct, deletePassedProduct, insertLikedProduct, insertPassedProduct } from '../services/likeService';
import { selectUserSnapshotInput } from '../src/intelligence/user/userSnapshotSource';
import type { LikedProduct, Product } from '../types/product';

jest.mock('../services/productService', () => {
  const actual = jest.requireActual<typeof import('../services/productService')>('../services/productService');
  return { ...actual, fetchFeedProducts: jest.fn() };
});
jest.mock('../services/likeService', () => ({
  fetchLikedProducts: jest.fn(), fetchPassedProductIds: jest.fn(), insertLikedProduct: jest.fn(),
  insertPassedProduct: jest.fn(), deleteLikedProduct: jest.fn(), deletePassedProduct: jest.fn(), updateLikedProductAlert: jest.fn(),
}));
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../lib/sessionIntent', () => ({ recordSessionProductAction: jest.fn(), resetSessionIntent: jest.fn() }));
jest.mock('../lib/recsFeedState', () => ({ setLastFeedMode: jest.fn() }));
jest.mock('../lib/logger', () => ({ logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const mk = (id: string): Product => ({ ...MOCK_PRODUCTS[0], id });
const feed = (): Product[] => ['a', 'a1', 'a2', 'a3'].map(mk);
const tracked = (event: string) => jest.mocked(track).mock.calls.filter(call => call[0] === event);
const deckIds = () => useAppStore.getState().currentProducts.map(p => p.id);
const stackOf = () => useAppStore.getState().passedStack.map(e => `${e.product.id}:${e.kind}`);
const st = () => useAppStore.getState();
const likedEntry = (product: Product): LikedProduct => ({ product, notifyOnPriceDrop: true, likedAt: '2026-01-01T00:00:00.000Z' });

beforeEach(() => {
  jest.clearAllMocks();
  detourConfig.complementOpenTracking = false;
  jest.mocked(insertLikedProduct).mockResolvedValue(undefined);
  jest.mocked(insertPassedProduct).mockResolvedValue(undefined);
  jest.mocked(deleteLikedProduct).mockResolvedValue(undefined);
  jest.mocked(deletePassedProduct).mockResolvedValue(undefined);
  useAppStore.setState({
    currentProducts: feed(), likedProducts: [], passedProductIds: [], passedStack: [], detourIds: [],
    sessionUserId: 'user-1', sessionSyncStatus: 'success', feedStatus: 'success', hasMore: true, isFetchingNext: false,
  });
});

describe('openDetour in the store', () => {
  test('single depth: X is the same object at [0], A is a detour entry, no pass/like write or event', async () => {
    const [a] = st().currentProducts;
    const x = mk('x');
    expect(st().openDetour(a, x)).toBe(true);
    await flush();
    expect(st().currentProducts[0]).toBe(x);
    expect(deckIds()).toEqual(['x', 'a1', 'a2', 'a3']);
    expect(stackOf()).toEqual(['a:detour']);
    expect(st().passedProductIds).toEqual([]);
    expect(st().likedProducts).toEqual([]);
    expect(insertPassedProduct).not.toHaveBeenCalled();
    expect(insertLikedProduct).not.toHaveBeenCalled();
    expect(tracked('pass')).toHaveLength(0);
    expect(tracked('like')).toHaveLength(0);
    expect(fetchFeedProducts).not.toHaveBeenCalled();
  });
  test('refused when the source is not the front card', () => {
    expect(st().openDetour(st().currentProducts[1], mk('x'))).toBe(false);
    expect(deckIds()).toEqual(['a', 'a1', 'a2', 'a3']);
  });
  test('depth limit: the 21st detour is refused', () => {
    let opened = 0;
    for (let i = 0; i < 25; i++) if (st().openDetour(st().currentProducts[0], mk(`x${i}`))) opened++;
    expect(opened).toBe(20);
    expect(st().currentProducts[0].id).toBe('x19');
  });
});

describe('swipes around a detour', () => {
  test('chain A→X→Y, up from Y: no pass event/write, passedProductIds untouched, A stays, A+1 comes', async () => {
    const [a] = st().currentProducts;
    st().openDetour(a, mk('x'));
    st().openDetour(st().currentProducts[0], mk('y'));
    st().swipeLeft(st().currentProducts[0]);
    await flush();
    expect(deckIds()).toEqual(['a1', 'a2', 'a3']);
    expect(stackOf()).toEqual(['a:detour']);
    expect(st().passedProductIds).toEqual([]);
    expect(insertPassedProduct).not.toHaveBeenCalled();
    expect(tracked('pass')).toHaveLength(0);
    await st().undoPass();
    expect(deckIds()).toEqual(['a', 'a1', 'a2', 'a3']);
  });
  test('up from the source A with a normal card is a normal pass', async () => {
    const [a] = st().currentProducts;
    st().openDetour(a, mk('x'));
    st().swipeLeft(st().currentProducts[0]);
    await flush();
    st().swipeLeft(st().currentProducts[0]);
    await flush();
    expect(insertPassedProduct).toHaveBeenCalledTimes(1);
    expect(st().passedProductIds).toEqual(['a1']);
    expect(stackOf()).toEqual(['a:detour', 'a1:passed']);
  });
  test('down swipe from a detour is view only: no network, no events, likes untouched', async () => {
    const liked = likedEntry(mk('l1'));
    useAppStore.setState({ likedProducts: [liked] });
    st().openDetour(st().currentProducts[0], mk('x'));
    jest.clearAllMocks();
    expect(await st().undoPass()).toBe(true);
    await flush();
    expect(deckIds()).toEqual(['a', 'a1', 'a2', 'a3']);
    expect(st().detourIds).toEqual([]);
    expect(st().likedProducts).toEqual([liked]);
    expect(fetchFeedProducts).not.toHaveBeenCalled();
    for (const fn of [insertPassedProduct, deletePassedProduct, insertLikedProduct, deleteLikedProduct]) expect(fn).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });
  test('liking X keeps the normal like flow; swiping X up afterwards keeps the like and writes no pass', async () => {
    const x = mk('x');
    st().openDetour(st().currentProducts[0], x);
    st().swipeRight(x, 'button', { keepInDeck: true });
    await flush();
    expect(insertLikedProduct).toHaveBeenCalledTimes(1);
    expect(tracked('like')).toHaveLength(1);
    st().swipeLeft(x);
    await flush();
    expect(st().likedProducts.map(i => i.product.id)).toEqual(['x']);
    expect(insertPassedProduct).not.toHaveBeenCalled();
    expect(stackOf()).toEqual(['a:detour']);
  });
  test('liking the source product from a mini card does not drop its way back', async () => {
    const a = st().currentProducts[0];
    st().openDetour(a, mk('x'));
    st().swipeRight(a, 'button', { keepInDeck: true });
    await flush();
    expect(stackOf()).toEqual(['a:detour']);
  });
});

describe('X is not shown again in the normal flow', () => {
  test('X ahead in the feed leaves its canonical slot', () => {
    const x = st().currentProducts[2];
    st().openDetour(st().currentProducts[0], x);
    expect(deckIds()).toEqual(['a2', 'a1', 'a3']);
    st().swipeLeft(x);
    expect(deckIds()).toEqual(['a1', 'a3']);
  });
  test('a later page that contains X does not bring it back, and X is in the exclusion list', async () => {
    const x = mk('x');
    jest.mocked(fetchFeedProducts).mockResolvedValue({ products: [mk('n1')], hasMore: true, source: 'edge', isPersonalized: true });
    await st().loadFeed(null);
    useAppStore.setState({ currentProducts: feed(), detourIds: [], passedStack: [] });
    st().openDetour(st().currentProducts[0], x);
    st().swipeLeft(x);
    jest.mocked(fetchFeedProducts).mockClear();
    jest.mocked(fetchFeedProducts).mockResolvedValue({ products: [x, mk('n2')], hasMore: true, source: 'edge', isPersonalized: true });
    await st().loadMoreFeed();
    expect(deckIds()).not.toContain('x');
    expect(deckIds()).toContain('n2');
    expect(jest.mocked(fetchFeedProducts).mock.calls[0][5]).toEqual(expect.arrayContaining(['x']));
  });
});

describe('stack readers', () => {
  test('userSnapshotSource ignores detour entries', () => {
    st().openDetour(st().currentProducts[0], mk('x'));
    const input = selectUserSnapshotInput({ state: st(), profile: null, attributeContexts: null });
    expect(input.passedProducts).toEqual([]);
  });
});

describe('complement_open event', () => {
  test('off by default: nothing is tracked', async () => {
    st().openDetour(st().currentProducts[0], mk('x'));
    await flush();
    expect(tracked('complement_open')).toHaveLength(0);
  });
  test('flag on: one event per opened card with source, opened and depth; no like/pass/impression events', async () => {
    detourConfig.complementOpenTracking = true;
    st().openDetour(st().currentProducts[0], mk('x'));
    st().openDetour(st().currentProducts[0], mk('y'));
    await flush();
    const calls = tracked('complement_open');
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toBe('x');
    expect(calls[0][2]).toEqual({ source_product_id: 'a', opened_product_id: 'x', depth: 1 });
    expect(calls[1][2]).toEqual({ source_product_id: 'x', opened_product_id: 'y', depth: 2 });
    expect(jest.mocked(track).mock.calls.map(c => c[0])).toEqual(['complement_open', 'complement_open']);
  });
  test('a refused detour tracks nothing', () => {
    detourConfig.complementOpenTracking = true;
    st().openDetour(st().currentProducts[1], mk('x'));
    expect(track).not.toHaveBeenCalled();
  });
});

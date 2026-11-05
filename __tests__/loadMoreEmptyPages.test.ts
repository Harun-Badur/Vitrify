import { MOCK_PRODUCTS } from '../data/mockProducts';
import { useAppStore } from '../store/useAppStore';
import { FeedServiceError, fetchFeedProducts, type FetchFeedProductsResult } from '../services/productService';

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

const [a, b] = MOCK_PRODUCTS;
const fetchMock = jest.mocked(fetchFeedProducts);
const page = (products: typeof MOCK_PRODUCTS, patch: Partial<FetchFeedProductsResult> = {}): FetchFeedProductsResult =>
  ({ products, hasMore: true, source: 'edge', isPersonalized: true, ...patch });
const emptyRejected = (...ids: string[]) => page([], { rejectedIds: ids });

/** Mirrors the Discover screen effect (useFocusEffect): load more whenever the deck is small and idle. */
const runScreenEffect = async (maxTicks: number): Promise<number> => {
  let ticks = 0;
  for (; ticks < maxTicks; ticks++) {
    const { feedStatus, hasMore, isFetchingNext, currentProducts, loadMoreFeed } = useAppStore.getState();
    if (!(feedStatus === 'success' && hasMore && !isFetchingNext && currentProducts.length <= 5)) break;
    await loadMoreFeed();
  }
  return ticks;
};

beforeEach(() => {
  jest.clearAllMocks();
  useAppStore.setState({
    currentProducts: [], likedProducts: [], passedProductIds: [], passedStack: [],
    feedStatus: 'idle', hasMore: true, isFetchingNext: false, sessionUserId: null,
  });
});

describe('a page whose products are all filtered out by the client', () => {
  test('does not repeat forever: the screen effect stops after a bounded number of requests', async () => {
    fetchMock.mockResolvedValue(emptyRejected('x1'));
    await useAppStore.getState().loadFeed(null, { filters: { category: 'upper_body', color: 'siyah' }, searchMode: true });
    await runScreenEffect(25);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4); // loadFeed + at most 3 more
    expect(useAppStore.getState().hasMore).toBe(false);
  });
  test('loadFeed with an empty page and hasMore retries once, then ends', async () => {
    fetchMock.mockResolvedValue(emptyRejected('x1'));
    await useAppStore.getState().loadFeed(null);
    expect(useAppStore.getState().hasMore).toBe(true);
    await runScreenEffect(25);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().hasMore).toBe(false);
  });
  test('the rejected ids join the exclusion list so the next request can advance', async () => {
    fetchMock.mockResolvedValue(emptyRejected('x1', 'x2'));
    await useAppStore.getState().loadFeed(null);
    await useAppStore.getState().loadMoreFeed();
    const excludeIds = fetchMock.mock.calls[1][5] as string[];
    expect(excludeIds).toEqual(expect.arrayContaining(['x1', 'x2']));
  });
  test('three consecutive empty pages end the feed; a product resets the counter', async () => {
    fetchMock.mockResolvedValueOnce(page([a]));
    await useAppStore.getState().loadFeed(null);
    fetchMock.mockResolvedValueOnce(emptyRejected('r1'));
    await useAppStore.getState().loadMoreFeed();
    fetchMock.mockResolvedValueOnce(emptyRejected('r2'));
    await useAppStore.getState().loadMoreFeed();
    expect(useAppStore.getState().hasMore).toBe(true); // two empty pages are tolerated
    fetchMock.mockResolvedValueOnce(page([b]));
    await useAppStore.getState().loadMoreFeed();
    expect(useAppStore.getState().currentProducts.map(item => item.id)).toEqual([a.id, b.id]);
    for (const id of ['r3', 'r4']) {
      fetchMock.mockResolvedValueOnce(emptyRejected(id));
      await useAppStore.getState().loadMoreFeed();
      expect(useAppStore.getState().hasMore).toBe(true); // counter restarted after the product
    }
    fetchMock.mockResolvedValueOnce(emptyRejected('r5'));
    await useAppStore.getState().loadMoreFeed();
    expect(useAppStore.getState().hasMore).toBe(false);
  });
  test('normal pagination is unchanged: products append and hasMore follows the server', async () => {
    fetchMock.mockResolvedValueOnce(page([a], { hasMore: true }));
    await useAppStore.getState().loadFeed(null);
    fetchMock.mockResolvedValueOnce(page([b], { hasMore: false }));
    await useAppStore.getState().loadMoreFeed();
    const state = useAppStore.getState();
    expect(state.currentProducts.map(item => item.id)).toEqual([a.id, b.id]);
    expect(state.hasMore).toBe(false);
    expect(state.feedStatus).toBe('success');
  });
  test('a network error is not exhaustion: hasMore stays, status is error, the counter is untouched', async () => {
    fetchMock.mockResolvedValueOnce(page([a]));
    await useAppStore.getState().loadFeed(null);
    fetchMock.mockResolvedValueOnce(emptyRejected('r1'));
    await useAppStore.getState().loadMoreFeed();
    fetchMock.mockRejectedValueOnce(new FeedServiceError('FEED_NETWORK'));
    await useAppStore.getState().loadMoreFeed();
    expect(useAppStore.getState()).toMatchObject({ hasMore: true, feedStatus: 'error', isFetchingNext: false });
  });
});

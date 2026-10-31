import { create } from 'zustand';
import { createDiscoverySlice } from '../store/discoverySlice';
import type { AppState } from '../store/useAppStore';
import { FeedServiceError, fetchFeedProducts } from '../services/productService';
import { logger } from '../lib/logger';
import { captureFeedTimeout } from '../lib/sentry';
import type { Product } from '../types/product';

jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../lib/recsFeedState', () => ({ setLastFeedMode: jest.fn() }));
jest.mock('../lib/sessionIntent', () => ({ recordSessionProductAction: jest.fn() }));
jest.mock('../services/likeService', () => ({ insertPassedProduct: jest.fn(), deletePassedProduct: jest.fn() }));
jest.mock('../lib/logger', () => ({ logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../lib/sentry', () => ({ captureFeedTimeout: jest.fn() }));
jest.mock('../services/preferenceTransactionAdapter', () => ({ isPreferenceOutcomeUnknown: () => false }));
jest.mock('../services/productService', () => ({
  fetchFeedProducts: jest.fn(),
  FeedServiceError: class FeedServiceError extends Error {
    code: string;
    constructor(code: string) { super(code); this.code = code; }
  },
}));

const product = (id: string) => ({ id, title: id }) as unknown as Product;
const result = (list: string[]) => ({ products: list.map(product), source: 'edge', isPersonalized: true, hasMore: true });
const makeStore = () => create<AppState>()((set, get, api) => ({
  ...createDiscoverySlice(set, get, api), sessionUserId: null, likedProducts: [],
}) as unknown as AppState);
const fetchMock = jest.mocked(fetchFeedProducts);

beforeEach(() => { jest.useFakeTimers(); fetchMock.mockReset(); jest.clearAllMocks(); });
afterEach(() => jest.useRealTimers());

test('a stalled feed call ends at the 12 s deadline and shows a retryable error on an empty deck', async () => {
  fetchMock.mockReturnValue(new Promise(() => undefined) as never);
  const store = makeStore();
  const loading = store.getState().loadFeed(null);
  await jest.advanceTimersByTimeAsync(11_900);
  expect(store.getState().feedStatus).toBe('loading');
  await jest.advanceTimersByTimeAsync(200);
  await loading;
  expect(store.getState().feedStatus).toBe('error');
  expect(store.getState().feedWarning).toBe('FEED_TIMEOUT');
  expect(logger.warn).toHaveBeenCalledWith('Feed zaman aşımı', { code: 'FEED_TIMEOUT' });
  expect(captureFeedTimeout).toHaveBeenCalledWith(12_000);
});

test('on timeout the deck already on screen stays usable', async () => {
  fetchMock.mockResolvedValueOnce(result(['a', 'b', 'c']) as never);
  const store = makeStore();
  await store.getState().loadFeed(null);
  fetchMock.mockReturnValueOnce(new Promise(() => undefined) as never);
  const loading = store.getState().loadFeed(null);
  await jest.advanceTimersByTimeAsync(12_100);
  await loading;
  expect(store.getState().feedStatus).toBe('success');
  expect(store.getState().feedWarning).toBe('FEED_TIMEOUT');
  expect(store.getState().currentProducts.map(item => item.id)).toEqual(['a', 'b', 'c']);
});

test('search results never fall back to the unrelated current deck', async () => {
  fetchMock.mockResolvedValueOnce(result(['a']) as never);
  const store = makeStore();
  await store.getState().loadFeed(null);
  fetchMock.mockReturnValueOnce(new Promise(() => undefined) as never);
  const loading = store.getState().loadFeed(null, { searchMode: true });
  await jest.advanceTimersByTimeAsync(12_100);
  await loading;
  expect(store.getState().feedStatus).toBe('error');
});

test('the service-level edge timeout is handled the same way', async () => {
  fetchMock.mockRejectedValueOnce(new FeedServiceError('FEED_TIMEOUT'));
  const store = makeStore();
  await store.getState().loadFeed(null);
  expect(store.getState().feedStatus).toBe('error');
  expect(store.getState().feedWarning).toBe('FEED_TIMEOUT');
  expect(captureFeedTimeout).toHaveBeenCalled();
});

test('a fast result clears the timer and publishes normally', async () => {
  fetchMock.mockResolvedValueOnce(result(['a']) as never);
  const store = makeStore();
  await store.getState().loadFeed(null);
  expect(store.getState().feedStatus).toBe('success');
  expect(store.getState().feedWarning).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
});

test('a late rejection after the deadline is not an unhandled rejection', async () => {
  let rejectLate!: (error: Error) => void;
  fetchMock.mockReturnValue(new Promise((_resolve, reject) => { rejectLate = reject; }) as never);
  const store = makeStore();
  const loading = store.getState().loadFeed(null);
  await jest.advanceTimersByTimeAsync(12_100);
  await loading;
  rejectLate(new Error('late'));
  await jest.advanceTimersByTimeAsync(0);
  expect(store.getState().feedStatus).toBe('error');
});

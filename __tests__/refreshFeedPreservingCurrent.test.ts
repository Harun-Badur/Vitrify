import { create } from 'zustand';
import { createDiscoverySlice } from '../store/discoverySlice';
import type { AppState } from '../store/useAppStore';
import { fetchFeedProducts } from '../services/productService';
import type { Product } from '../types/product';

jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../lib/recsFeedState', () => ({ setLastFeedMode: jest.fn() }));
jest.mock('../lib/sessionIntent', () => ({ recordSessionProductAction: jest.fn() }));
jest.mock('../services/likeService', () => ({ insertPassedProduct: jest.fn(), deletePassedProduct: jest.fn() }));
jest.mock('../lib/logger', () => ({ logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../services/preferenceTransactionAdapter', () => ({ isPreferenceOutcomeUnknown: () => false }));
jest.mock('../services/productService', () => ({
  fetchFeedProducts: jest.fn(),
  FeedServiceError: class FeedServiceError extends Error { code = 'X'; },
}));

const product = (id: string) => ({ id, title: id }) as unknown as Product;
const ids = (items: readonly Product[]) => items.map(item => item.id);
const result = (list: string[], extra: Record<string, unknown> = {}) => ({
  products: list.map(product), source: 'edge', isPersonalized: true, hasMore: true, ...extra,
});
const makeStore = () => create<AppState>()((set, get, api) => ({
  ...createDiscoverySlice(set, get, api), sessionUserId: null, likedProducts: [],
}) as unknown as AppState);
const fetchMock = jest.mocked(fetchFeedProducts);
const initial = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

const seeded = async () => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValueOnce(result(initial) as never);
  const store = makeStore();
  await store.getState().loadFeed(null);
  fetchMock.mockClear();
  return store;
};

test('keeps the current card and the prepared window, replaces only the back with the new ranking', async () => {
  const store = await seeded();
  fetchMock.mockResolvedValueOnce(result(['p7', 'p6', 'n1', 'p0', 'p5', 'n2']) as never);
  await store.getState().refreshFeedPreservingCurrent();
  expect(ids(store.getState().currentProducts)).toEqual(['p0', 'p1', 'p2', 'p7', 'p6', 'n1', 'p5', 'n2']);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('never shows a loading state and leaves status and warning alone', async () => {
  const store = await seeded();
  const seen: string[] = [];
  store.subscribe(state => { seen.push(state.feedStatus); });
  fetchMock.mockResolvedValueOnce(result(['n1', 'n2']) as never);
  await store.getState().refreshFeedPreservingCurrent();
  expect(seen).not.toContain('loading');
  expect(store.getState().feedStatus).toBe('success');
});

test('a swipe during the refresh is respected: result applies after the new position', async () => {
  const store = await seeded();
  let finish!: (value: never) => void;
  fetchMock.mockReturnValueOnce(new Promise<never>(resolve => { finish = resolve; }));
  const refreshing = store.getState().refreshFeedPreservingCurrent();
  store.setState(state => ({ currentProducts: state.currentProducts.slice(1), passedProductIds: ['p0'] }));
  finish(result(['p0', 'p7', 'n1', 'p3', 'n2']) as never);
  await refreshing;
  const after = ids(store.getState().currentProducts);
  expect(after.slice(0, 3)).toEqual(['p1', 'p2', 'p3']);
  expect(after).not.toContain('p0');
  expect(new Set(after).size).toBe(after.length);
  expect(after.slice(3)).toEqual(['p7', 'n1', 'n2']);
});

test('a failed refresh silently keeps the existing deck', async () => {
  const store = await seeded();
  fetchMock.mockRejectedValueOnce(new Error('network'));
  await expect(store.getState().refreshFeedPreservingCurrent()).resolves.toBeUndefined();
  expect(ids(store.getState().currentProducts)).toEqual(initial);
  expect(store.getState().feedStatus).toBe('success');
});

test('does nothing before a feed was loaded', async () => {
  fetchMock.mockReset();
  const store = makeStore();
  await store.getState().refreshFeedPreservingCurrent();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('a reload that starts meanwhile wins; the stale refresh result is discarded', async () => {
  const store = await seeded();
  let finish!: (value: never) => void;
  fetchMock.mockReturnValueOnce(new Promise<never>(resolve => { finish = resolve; }));
  const refreshing = store.getState().refreshFeedPreservingCurrent();
  fetchMock.mockResolvedValueOnce(result(['r0', 'r1']) as never);
  await store.getState().loadFeed(null);
  finish(result(['stale']) as never);
  await refreshing;
  expect(ids(store.getState().currentProducts)).toEqual(['r0', 'r1']);
});

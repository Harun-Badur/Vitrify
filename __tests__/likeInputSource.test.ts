import { create } from 'zustand';
import { createFavoritesSlice } from '../store/favoritesSlice';
import { MOCK_PRODUCTS } from '../data/mockProducts';
import { insertLikedProduct } from '../services/likeService';
import { track } from '../lib/analytics';

jest.mock('../services/likeService', () => ({
  deleteLikedProduct: jest.fn(), fetchLikedProducts: jest.fn(),
  insertLikedProduct: jest.fn(), updateLikedProductAlert: jest.fn(),
}));
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../lib/sessionIntent', () => ({ recordSessionProductAction: jest.fn() }));
jest.mock('../lib/logger', () => ({ logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const p = MOCK_PRODUCTS[0];
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
let store: any;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(insertLikedProduct).mockResolvedValue(undefined);
  store = create((set, get, api) => ({
    ...createFavoritesSlice(set as never, get as never, api as never),
    sessionUserId: 'alice', currentProducts: [p], passedProductIds: [], passedStack: [],
  }));
});

const likePayload = (): Record<string, unknown> =>
  jest.mocked(track).mock.calls.find(call => call[0] === 'like')![2] as Record<string, unknown>;

test.each(['button', 'double_tap'] as const)('like event carries the %s input', async input => {
  store.getState().swipeRight(p, input);
  await flush();
  expect(likePayload()).toEqual({ source: 'feed', like_input: input });
});

test('callers without an input keep the exact previous payload', async () => {
  store.getState().swipeRight(p);
  await flush();
  expect(likePayload()).toEqual({ source: 'feed' });
});

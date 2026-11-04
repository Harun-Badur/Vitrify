import { MOCK_PRODUCTS } from '../data/mockProducts';
import { useAppStore } from '../store/useAppStore';
import { track } from '../lib/analytics';
import { deleteLikedProduct, insertLikedProduct, insertPassedProduct } from '../services/likeService';
import { likedIdSet } from '../lib/likedIds';
import { decideLikeTap } from '../lib/likeTap';
import type { LikedProduct } from '../types/product';
import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('../services/productService', () => ({ fetchFeedProducts: jest.fn() }));
jest.mock('../services/likeService', () => ({
  fetchLikedProducts: jest.fn(), fetchPassedProductIds: jest.fn(), insertLikedProduct: jest.fn(),
  insertPassedProduct: jest.fn(), deleteLikedProduct: jest.fn(), updateLikedProductAlert: jest.fn(),
}));
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../lib/sessionIntent', () => ({ recordSessionProductAction: jest.fn(), resetSessionIntent: jest.fn() }));
jest.mock('../lib/recsFeedState', () => ({ setLastFeedMode: jest.fn() }));
jest.mock('../lib/logger', () => ({ logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const [first, second] = MOCK_PRODUCTS;
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const likedEntry = (product = first): LikedProduct => ({ product, notifyOnPriceDrop: true, likedAt: '2026-01-01T00:00:00.000Z' });
const tracked = (event: string) => jest.mocked(track).mock.calls.filter(call => call[0] === event);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(insertLikedProduct).mockResolvedValue(undefined);
  jest.mocked(insertPassedProduct).mockResolvedValue(undefined);
  jest.mocked(deleteLikedProduct).mockResolvedValue(undefined);
  useAppStore.setState({
    currentProducts: [first, second], likedProducts: [], passedProductIds: [], passedStack: [],
    sessionUserId: 'user-1', sessionSyncStatus: 'success',
  });
});

describe('like from the card (double tap / heart button)', () => {
  test('the product is favourited but the card stays on the deck', async () => {
    useAppStore.getState().swipeRight(first, 'double_tap', { keepInDeck: true });
    await flush();
    const state = useAppStore.getState();
    expect(state.likedProducts.map(item => item.product.id)).toEqual([first.id]);
    expect(state.currentProducts.map(item => item.id)).toEqual([first.id, second.id]);
    expect(insertLikedProduct).toHaveBeenCalledTimes(1);
    expect(tracked('like')).toHaveLength(1);
    expect(tracked('dolap_add')).toHaveLength(1);
  });
  test('a second like on the same card produces one write and one event', async () => {
    useAppStore.getState().swipeRight(first, 'double_tap', { keepInDeck: true });
    useAppStore.getState().swipeRight(first, 'button', { keepInDeck: true });
    await flush();
    expect(insertLikedProduct).toHaveBeenCalledTimes(1);
    expect(tracked('like')).toHaveLength(1);
    expect(useAppStore.getState().likedProducts).toHaveLength(1);
  });
  test('the old behaviour without the option still removes the card (outfit builder path)', async () => {
    useAppStore.getState().swipeRight(first);
    await flush();
    expect(useAppStore.getState().currentProducts.map(item => item.id)).toEqual([second.id]);
  });
  test('a failed write rolls the favourite back and keeps exactly one copy of the card', async () => {
    jest.mocked(insertLikedProduct).mockRejectedValueOnce(new Error('offline'));
    useAppStore.getState().swipeRight(first, 'button', { keepInDeck: true });
    await flush();
    const state = useAppStore.getState();
    expect(state.likedProducts).toEqual([]);
    expect(state.currentProducts.map(item => item.id)).toEqual([first.id, second.id]);
  });
  test('pressing the heart again unlikes through the existing flow and the card stays', async () => {
    useAppStore.getState().swipeRight(first, 'button', { keepInDeck: true });
    await flush();
    await useAppStore.getState().unlikeProduct(first.id);
    const state = useAppStore.getState();
    expect(deleteLikedProduct).toHaveBeenCalledTimes(1);
    expect(state.likedProducts).toEqual([]);
    expect(state.currentProducts.map(item => item.id)).toEqual([first.id, second.id]);
  });
});

describe('swiping a liked card away', () => {
  test('sends no pass, keeps the like and only advances the deck', async () => {
    useAppStore.setState({ likedProducts: [likedEntry()] });
    useAppStore.getState().swipeLeft(first);
    await flush();
    const state = useAppStore.getState();
    expect(insertPassedProduct).not.toHaveBeenCalled();
    expect(tracked('pass')).toHaveLength(0);
    expect(deleteLikedProduct).not.toHaveBeenCalled();
    expect(state.likedProducts.map(item => item.product.id)).toEqual([first.id]);
    expect(state.passedProductIds).toEqual([]);
    expect(state.passedStack).toEqual([]);
    expect(state.currentProducts.map(item => item.id)).toEqual([second.id]);
  });
  test('an unliked card still records its pass exactly as before', async () => {
    useAppStore.getState().swipeLeft(first);
    await flush();
    expect(insertPassedProduct).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().passedProductIds).toEqual([first.id]);
  });
});

describe('liked state lookup', () => {
  test('is an O(1) Set built once per likedProducts array', () => {
    const list = [likedEntry(first)];
    const set = likedIdSet(list);
    expect(set.has(first.id)).toBe(true);
    expect(set.has(second.id)).toBe(false);
    expect(likedIdSet(list)).toBe(set);
    expect(likedIdSet([...list, likedEntry(second)]).has(second.id)).toBe(true);
  });
  test('a product that returns to the deck already liked reads as liked', () => {
    useAppStore.setState({ likedProducts: [likedEntry()], currentProducts: [first] });
    expect(likedIdSet(useAppStore.getState().likedProducts).has(useAppStore.getState().currentProducts[0].id)).toBe(true);
  });
});

describe('decideLikeTap', () => {
  test('signed-out users are sent to sign in', () => {
    expect(decideLikeTap({ canLike: false, liked: false, source: 'button' })).toBe('require_auth');
    expect(decideLikeTap({ canLike: false, liked: true, source: 'double_tap' })).toBe('require_auth');
  });
  test('unliked: both inputs like', () => {
    expect(decideLikeTap({ canLike: true, liked: false, source: 'button' })).toBe('like');
    expect(decideLikeTap({ canLike: true, liked: false, source: 'double_tap' })).toBe('like');
  });
  test('liked: the heart button unlikes, a double tap only plays the heart (no second event)', () => {
    expect(decideLikeTap({ canLike: true, liked: true, source: 'button' })).toBe('unlike');
    expect(decideLikeTap({ canLike: true, liked: true, source: 'double_tap' })).toBe('none');
  });
});

describe('card wiring (source contract)', () => {
  const read = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8');
  const card = read('components/SwipeCard.tsx');
  const screen = read('app/(tabs)/index.tsx');
  test('the card reads liked state from a narrow per-id selector, not local state', () => {
    expect(card).toContain('useIsLiked(product.id)');
    expect(card).not.toContain('isLikedLocal');
    expect(card).toContain('liked={liked}');
  });
  test('like paths no longer lock or throw the card away', () => {
    const likeBlock = card.slice(card.indexOf('const handleLikeInput'), card.indexOf('const snapHome'));
    expect(likeBlock).not.toContain('hasExited');
    expect(likeBlock).not.toContain('dragOffset');
    expect(card).not.toContain('playHeartThenLike');
  });
  test('Discover keeps the card on a like and unlikes through the store action', () => {
    expect(screen).toContain('swipeRight(product, input, { keepInDeck: true })');
    expect(screen).toContain('unlikeProduct(product.id)');
    expect(screen).toContain('onUnlike={handleUnlike}');
  });
  test('the rail heart pop is a single sequence with no loop', () => {
    const rail = read('components/DiscoverActionRail.tsx');
    expect(rail).toContain('withSequence');
    expect(rail).not.toMatch(/withRepeat|Animated\.loop/);
  });
});

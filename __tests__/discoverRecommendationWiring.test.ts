import { createElement, type ElementType, type ReactElement } from 'react';
import { Platform, TextInput } from 'react-native';
import { Image } from 'expo-image';
import FeedScreen from '../app/(tabs)/index';
import { complementaryProductsForDisplay } from '../components/DiscoverRecommendations';
import { loadDiscoverRecommendationPacket } from '../services/discoverRecommendationCacheService';
import { anchorContext } from '../src/recommendationCache/feedPacket';
import { serializeFinal } from '../src/recommendationCache/codec';
const getDiscoverRecommendations = jest.fn<Promise<ReturnType<typeof realService.getDiscoverRecommendations>>, [Parameters<typeof realService.getDiscoverRecommendations>[0], unknown?]>();
import { loadWardrobe } from '../services/wardrobeService';
jest.mock('../components/TouchClaim', () => ({ __esModule: true, default: ({ children }: { children: unknown }) => children }));
jest.mock('../services/wardrobeService', () => ({ loadWardrobe: jest.fn(() => new Promise(() => {})) }));
import { fetchRecommendationCatalog } from '../services/productService';
import { getSupabaseClient } from '../lib/supabase';
import { getProductRepository } from '../services/productRepository';
import { MOCK_PRODUCTS } from '../data/mockProducts';
import type { Product } from '../types/product';

const createdSessions = (jest.requireMock('../lib/discoverRecommendationCache') as { __created: { catalogIds: string[]; productPref: unknown }[] }).__created;
const mockLoadFeed = jest.fn();
const mockLoadMoreFeed = jest.fn();
const mockSwipeLeft = jest.fn();
const mockSwipeRight = jest.fn();
const mockUndoPass = jest.fn();
const mockSwipeCardRender = jest.fn();
const mockRouter = { push: jest.fn() };
const mockState = {
  sessionUserId: null as string | null,
  sessionSyncStatus: 'idle',
  currentProducts: [] as Product[],
  feedStatus: 'success',
  likedProducts: [],
  passedProductIds: [],
  passedStack: [],
  feedMode: 'personal',
  productPref: null as string | null,
  feedFallback: false,
  feedRelaxed: [],
  loadFeed: mockLoadFeed,
  loadMoreFeed: mockLoadMoreFeed,
  hasMore: false,
  isFetchingNext: false,
  setFeedMode: jest.fn(),
  swipeRight: mockSwipeRight,
  swipeLeft: mockSwipeLeft,
  undoPass: mockUndoPass,
};
let mockFocused = true;
let mockUser: { id: string } | null = null;
const mockIdleTasks = new Map<number, () => void>();
let mockIdleId = 0;

jest.mock('lucide-react-native', () => ({
  Search: () => null,
  SlidersHorizontal: () => null,
  X: () => null,
  Check: () => null,
  Plus: () => null,
}));
jest.mock('expo-image', () => ({
  Image: Object.assign('Image', { prefetch: jest.fn().mockResolvedValue(true) }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useFocusEffect: (callback: () => void | (() => void)) =>
    jest
      .requireActual<typeof import('react')>('react')
      .useEffect(() => mockFocused ? callback() : undefined, [callback, mockFocused]),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }),
}));
jest.mock('react-native-reanimated', () => ({
  useSharedValue: (value: number) => jest.requireActual<typeof import('react')>('react').useRef({ value }).current,
  runOnUI: (callback: () => void) => callback,
}));
jest.mock('../hooks/useAuthContext', () => ({
  useAuthContext: () => ({ user: mockUser }),
}));
jest.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));
jest.mock('../lib/onboarding', () => ({
  hasSeenSwipeHint: jest.fn().mockResolvedValue(true),
  markSwipeHintSeen: jest.fn(),
}));
jest.mock('../lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));
jest.mock('../lib/supabase', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('../services/productService', () => ({
  fetchRecommendationCatalog: jest.fn(),
}));
jest.mock(
  '../src/intelligence/recommendations/getDiscoverRecommendations',
  () => ({
    getDiscoverRecommendationsAsync: jest.fn(), prepareDiscoverRankingAsync: jest.fn(), completeDiscoverRecommendationsAsync: jest.fn(),
  }),
);
jest.mock('../components/DiscoverRecommendations', () => ({
  __esModule: true,
  default: 'DiscoverRecommendations',
  complementaryProductsForDisplay: jest.requireActual('../src/intelligence/recommendations/complementaryProductsForDisplay').complementaryProductsForDisplay,
}));
jest.mock('../components/SwipeCard', () => ({
  __esModule: true,
  default: jest.requireActual<typeof import('react')>('react').memo((props: { product: Product; pageIndex: number; recommendations: readonly unknown[];
    selectedRecommendationProductIds: readonly string[]; onSelectRecommendation: (product: Product) => void }) => {
    mockSwipeCardRender(props.product.id);
    const react = jest.requireActual<typeof import('react')>('react');
    return react.createElement('SwipeCard', props, props.pageIndex === 0
      ? react.createElement('DiscoverRecommendations', {
        currentProductId: props.product.id, recommendations: props.recommendations,
        selectedProductIds: props.selectedRecommendationProductIds, onSelectProduct: props.onSelectRecommendation,
      }) : null);
  }),
  SWIPE_CARD_HEIGHT: 300,
  SWIPE_CARD_WIDTH: 320,
}));
jest.mock('../lib/discoverRecommendationCache', () => {
  const actual = jest.requireActual<typeof import('../lib/discoverRecommendationCache')>('../lib/discoverRecommendationCache');
  const created: { catalogIds: string[]; productPref: unknown }[] = [];
  class CountingSession extends actual.DiscoverRecommendationCache {
    constructor(...args: ConstructorParameters<typeof actual.DiscoverRecommendationCache>) {
      super(...args);
      created.push({ catalogIds: args[0].map(product => product.id), productPref: args[3] });
    }
  }
  return { ...actual, DiscoverRecommendationCache: CountingSession, __created: created };
});
jest.mock('../components/FeedModeSegment', () => 'FeedModeSegment');
jest.mock('../components/PressableScale', () => 'PressableScale');
jest.mock('../components/FilterSheet', () => 'FilterSheet');
jest.mock('../components/SkeletonShimmer', () => 'SkeletonShimmer');
jest.mock('../components/SwipeHintOverlay', () => 'SwipeHintOverlay');
jest.mock('../components/VirtualTryOnModal', () => 'VirtualTryOnModal');

interface TestNode {
  props: Record<string, unknown>;
  parent: TestNode | null;
}

const renderer = jest.requireActual('react-test-renderer') as {
  act: (callback: () => void | Promise<void>) => Promise<void>;
  create: (element: ReactElement) => {
    root: {
      findByType: (type: ElementType | string) => TestNode;
      findAllByType: (type: string) => TestNode[];
    };
    update: (element: ReactElement) => void;
    unmount: () => void;
  };
};

// Faz 4 S3b: complements need a known gender; the mock catalog has none.
const top = { ...MOCK_PRODUCTS[0], id: 'real-top', outfitRole: 'top' as const, gender: 'women' as const };
const bottom = {
  ...MOCK_PRODUCTS[1],
  id: 'real-bottom',
  gender: 'women' as const,
  category: 'lower_body' as const,
  outfitRole: 'bottom' as const,
};
const shoes = {
  ...MOCK_PRODUCTS[2],
  id: 'real-shoes',
  gender: 'women' as const,
  category: 'shoes' as const,
  outfitRole: 'shoes' as const,
};
const jacket = {
  ...MOCK_PRODUCTS[3],
  id: 'real-jacket',
  gender: 'women' as const,
  outfitRole: 'outerwear' as const,
};
const bag = {
  ...MOCK_PRODUCTS[3],
  id: 'real-bag',
  gender: 'women' as const,
  category: 'bags' as const,
  outfitRole: 'bag' as const,
};
const catalog = [top, bottom, shoes, jacket, bag];
jest.mock('../services/discoverRecommendationCacheService', () => ({ loadDiscoverRecommendationPacket: jest.fn() }));
const realService = jest.requireActual<
  typeof import('../src/intelligence/recommendations/getDiscoverRecommendations')
>('../src/intelligence/recommendations/getDiscoverRecommendations');

describe('Discover recommendation wiring', () => {
  let tree: ReturnType<typeof renderer.create> | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    createdSessions.length = 0;
    jest.mocked(loadDiscoverRecommendationPacket).mockImplementation(async (request, _owner, signal, publish) => {
      const exposure = new Map(request.exposure);
      const entries = [];
      for (const anchor of request.anchors) {
        if (request.shownAnchorIds.includes(anchor.id)) continue;
        const context = anchorContext(request.candidatePool, anchor, request.wardrobeItems, exposure);
        const result = await getDiscoverRecommendations(context.input, { signal });
        entries.push({ anchorProductId: anchor.id, exposure: [...exposure], serialized: serializeFinal(result, context) });
        for (const product of complementaryProductsForDisplay(result, anchor.id)) exposure.set(product.id, (exposure.get(product.id) ?? 0) + 1);
      }
      publish({ sessionId: request.sessionId, generation: request.generation, contextFingerprint: request.contextFingerprint, entries });
    });
    jest.mocked(Image.prefetch).mockResolvedValue(true);
    mockIdleTasks.clear();
    global.requestIdleCallback = jest.fn(callback => {
      const id = ++mockIdleId;
      mockIdleTasks.set(id, () => callback({ didTimeout: false, timeRemaining: () => 50 }));
      return id;
    });
    global.cancelIdleCallback = jest.fn(id => { mockIdleTasks.delete(id as number); });
    mockFocused = true;
    mockUser = null;
    mockState.sessionUserId = null; mockState.sessionSyncStatus = 'idle';
    mockState.feedStatus = 'success';
    mockState.productPref = null;
    mockState.hasMore = false;
    mockState.isFetchingNext = false;
    mockState.currentProducts = catalog;
    jest.mocked(getSupabaseClient).mockReturnValue(null);
    jest.mocked(fetchRecommendationCatalog).mockResolvedValue(catalog);
    jest
      .mocked(getDiscoverRecommendations)
      .mockImplementation(async input => realService.getDiscoverRecommendations(input));
  });

  afterEach(async () => {
    if (tree)
      await renderer.act(() => {
        tree?.unmount();
      });
    tree = null;
  });
  it('starts the initial feed once after same-owner hydration and never during another owner session', async () => {
    mockUser = { id: 'A' };
    await renderer.act(() => { tree = renderer.create(createElement(FeedScreen)); });
    expect(mockLoadFeed).not.toHaveBeenCalled();
    mockState.sessionUserId = 'A'; mockState.sessionSyncStatus = 'loading';
    await renderer.act(() => { tree!.update(createElement(FeedScreen)); });
    expect(mockLoadFeed).not.toHaveBeenCalled();
    mockState.sessionSyncStatus = 'success';
    await renderer.act(() => { tree!.update(createElement(FeedScreen)); });
    expect(mockLoadFeed).toHaveBeenCalledTimes(1);
    mockState.sessionSyncStatus = 'loading';
    await renderer.act(() => { tree!.update(createElement(FeedScreen)); });
    mockState.sessionSyncStatus = 'success';
    await renderer.act(() => { tree!.update(createElement(FeedScreen)); });
    expect(mockLoadFeed).toHaveBeenCalledTimes(1);
    mockUser = { id: 'B' };
    await renderer.act(() => { tree!.update(createElement(FeedScreen)); });
    expect(mockLoadFeed).toHaveBeenCalledTimes(1);
    mockState.sessionUserId = 'B';
    await renderer.act(() => { tree!.update(createElement(FeedScreen)); });
    expect(mockLoadFeed).toHaveBeenCalledTimes(2);
    mockUser = null;
    await renderer.act(() => { tree!.update(createElement(FeedScreen)); });
    expect(mockLoadFeed).toHaveBeenCalledTimes(2);
    mockState.sessionUserId = null; mockState.sessionSyncStatus = 'idle';
    await renderer.act(() => { tree!.update(createElement(FeedScreen)); });
    expect(mockLoadFeed).toHaveBeenCalledTimes(3);
  });

  const flushIdle = async (): Promise<void> => {
    while (mockIdleTasks.size > 0) {
      await renderer.act(async () => {
        const [id, callback] = [...mockIdleTasks][0];
        mockIdleTasks.delete(id);
        callback();
        await Promise.resolve();
        await Promise.resolve();
      });
    }
  };

  const mount = async (prepare = true): Promise<ReturnType<typeof renderer.create>> => {
    await renderer.act(async () => {
      tree = renderer.create(createElement(FeedScreen));
      await Promise.resolve();
      await Promise.resolve();
    });
    if (prepare) await flushIdle();
    return tree!;
  };

  it('does not start the optional catalog while the initial feed is loading', async () => {
    mockState.feedStatus = 'loading';
    await mount(false);
    expect(fetchRecommendationCatalog).not.toHaveBeenCalled();
    expect(getDiscoverRecommendations).not.toHaveBeenCalled();
    mockState.feedStatus = 'success';
  });

  it('starts no continuation while blurred and retains the five-product trigger on focus', async () => {
    mockFocused = false;
    mockState.hasMore = true;
    mockState.currentProducts = [bottom];
    const view = await mount(false);
    expect(mockLoadMoreFeed).not.toHaveBeenCalled();
    mockFocused = true;
    await renderer.act(() => { view.update(createElement(FeedScreen)); });
    expect(mockLoadMoreFeed).toHaveBeenCalledTimes(1);
  });

  it('passes complete ranked recommendations and three real catalog references to the UI', async () => {
    const view = await mount();
    const props = view.root.findByType('DiscoverRecommendations').props;
    const result = props.recommendations as ReturnType<
      typeof realService.getDiscoverRecommendations
    >;
    expect(getDiscoverRecommendations).toHaveBeenCalledWith({
      wardrobeItems: [],
      catalogProducts: catalog,
      requiredCatalogProductId: top.id,
      firstOnly: true,
      recommendationExposure: new Map(),
    }, { signal: expect.objectContaining({ aborted: expect.any(Boolean) }) });
    expect(props.currentProductId).toBe(top.id);
    expect(result[0]).toMatchObject({
      type: 'outfit',
      rank: 1,
      rankingValue: { coreComplete: true },
      sources: ['catalog'],
    });
    expect(result[0].reasons).toContainEqual({
      code: 'core_complete',
      form: 'two_piece',
    });
    expect(result[0].candidate.items.some((item) => item.product === top)).toBe(
      true,
    );
    expect(complementaryProductsForDisplay(result, top.id)).toHaveLength(3);
    expect(
      result[0].candidate.items.every((item) => item.sourceType === 'catalog'),
    ).toBe(true);
  });

  it('delivers three canonical complements to SwipeCard through the real service when the cache misses', async () => {
    const query = { select: jest.fn(), eq: jest.fn(), gt: jest.fn(), in: jest.fn(), abortSignal: jest.fn(),
      limit: jest.fn().mockResolvedValue({ data: [], error: null }) };
    for (const method of [query.select, query.eq, query.gt, query.in, query.abortSignal]) method.mockReturnValue(query);
    const client = { from: jest.fn(() => query), rpc: jest.fn(), channel: jest.fn() };
    jest.mocked(getSupabaseClient).mockReturnValue(client as never);
    mockState.currentProducts = [top];
    const actualTransport = jest.requireActual<typeof import('../services/discoverRecommendationCacheService')>(
      '../services/discoverRecommendationCacheService');
    const mockedEngine = jest.requireMock<typeof import('../src/intelligence/recommendations/getDiscoverRecommendations')>(
      '../src/intelligence/recommendations/getDiscoverRecommendations');
    jest.mocked(mockedEngine.getDiscoverRecommendationsAsync).mockImplementation(async input => realService.getDiscoverRecommendations(input));
    jest.mocked(mockedEngine.prepareDiscoverRankingAsync).mockImplementation(async input => ({
      ...await realService.prepareDiscoverRankingAsync(input, {}),
    }));
    jest.mocked(mockedEngine.completeDiscoverRecommendationsAsync).mockImplementation(realService.completeDiscoverRecommendationsAsync);
    jest.mocked(loadDiscoverRecommendationPacket).mockImplementation(actualTransport.loadDiscoverRecommendationPacket);
    const view = await mount();
    const deadline = Date.now() + 5000;
    while (!(view.root.findAllByType('SwipeCard')[0].props.recommendations as unknown[]).length && Date.now() < deadline) {
      // The real cooperative engine yields through host timers, not just microtasks.
      await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
      await flushIdle();
    }
    const swipeCard = view.root.findAllByType('SwipeCard')[0];
    const recommendations = swipeCard.props.recommendations as ReturnType<typeof realService.getDiscoverRecommendations>;
    const expected = realService.getDiscoverRecommendations(anchorContext(catalog, top, [], new Map()).input);
    expect(recommendations).toStrictEqual(expected);
    expect(recommendations[0].displayProducts).toHaveLength(3);
    const products = complementaryProductsForDisplay(recommendations, top.id);
    const resolved = await getProductRepository().productsById(products.map(product => product.id));
    products.forEach(product => expect(product).toBe(resolved.get(product.id)));
    expect(view.root.findByType('DiscoverRecommendations').props.recommendations).toBe(recommendations);
    expect(client.rpc).not.toHaveBeenCalled(); expect(client.channel).not.toHaveBeenCalled();
  });

  it('does not overwrite an in-flight swipe offset when pagination appends behind the same active card', async () => {
    const view = await mount();
    const drag = view.root.findAllByType('SwipeCard')[0].props.dragOffset as { value: number };
    const writeOffset = jest.fn();
    Object.defineProperty(drag, 'value', { configurable: true, get: () => -650, set: writeOffset });
    mockState.currentProducts = [...catalog, { ...top, id: 'pagination-appended' }];
    await renderer.act(() => { view.update(createElement(FeedScreen)); });
    expect(writeOffset).not.toHaveBeenCalled();
    expect(view.root.findAllByType('SwipeCard')[0].props.product).toBe(top);
    mockState.currentProducts = catalog.slice(1);
    await renderer.act(() => { view.update(createElement(FeedScreen)); });
    expect(writeOffset).toHaveBeenCalledTimes(1);
  });

  it('warms Android cards through mounted images without full-resolution native prefetch jobs', async () => {
    const platform = Platform.OS;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    try {
      const view = await mount();
      const result = view.root.findByType('DiscoverRecommendations').props.recommendations as ReturnType<typeof realService.getDiscoverRecommendations>;
      expect(complementaryProductsForDisplay(result, top.id)).toHaveLength(3);
      expect(view.root.findAllByType('SwipeCard')).toHaveLength(3);
      expect(Image.prefetch).not.toHaveBeenCalled();
    } finally { Object.defineProperty(Platform, 'OS', { configurable: true, value: platform }); }
  });

  it('finds a catalog bottom when the visible feed contains only a top', async () => {
    mockState.currentProducts = [top];
    const view = await mount();
    const result = view.root.findByType('DiscoverRecommendations').props
      .recommendations as ReturnType<
      typeof realService.getDiscoverRecommendations
    >;
    expect(complementaryProductsForDisplay(result, top.id)).toContain(bottom);
    expect(
      jest.mocked(getDiscoverRecommendations).mock.lastCall?.[0]
        .catalogProducts,
    ).toEqual(catalog);
    expect(view.root.findAllByType('SwipeCard')[0].props.product).toBe(top);
    expect(mockState.currentProducts).toEqual([top]);
  });

  it('finds a catalog top when the visible feed contains only a bottom', async () => {
    mockState.currentProducts = [bottom];
    const view = await mount();
    const result = view.root.findByType('DiscoverRecommendations').props
      .recommendations as ReturnType<
      typeof realService.getDiscoverRecommendations
    >;
    expect(complementaryProductsForDisplay(result, bottom.id)).toContain(top);
    expect(view.root.findAllByType('SwipeCard')[0].props.product).toBe(bottom);
  });

  it('prepares exactly three catalog complements for a signed-in user without reading wardrobe', async () => {
    mockUser = { id: 'user-1' };
    mockState.currentProducts = [top];
    const from = jest.fn(() => { throw new Error('wardrobe must not be read'); });
    jest.mocked(getSupabaseClient).mockReturnValue({ from } as never);
    const view = await mount();
    expect(from).not.toHaveBeenCalled();
    expect(loadWardrobe).not.toHaveBeenCalled();
    const result = view.root.findByType('DiscoverRecommendations').props.recommendations as ReturnType<typeof realService.getDiscoverRecommendations>;
    const products = complementaryProductsForDisplay(result, top.id);
    expect(products).toHaveLength(3);
    expect(new Set(products.map(product => product.id)).size).toBe(3);
    expect(products.every(product => product.id !== top.id && catalog.some(candidate => candidate === product))).toBe(true);
    expect(getDiscoverRecommendations).toHaveBeenCalledWith(expect.objectContaining({ wardrobeItems: [] }), expect.anything());
    expect(result[0].sources).toEqual(['catalog']);
  });

  it('keeps the empty result and main product card when there is no recommendation', async () => {
    jest.mocked(getDiscoverRecommendations).mockResolvedValue([]);
    const view = await mount();
    expect(
      view.root.findByType('DiscoverRecommendations').props.recommendations,
    ).toEqual([]);
    expect(view.root.findAllByType('SwipeCard')[0].props.recommendationStatus).toBe('ready');
    expect(view.root.findAllByType('SwipeCard')).toHaveLength(3);
  });

  it('keeps the empty result and feed when the catalog candidate pool is empty', async () => {
    jest.mocked(fetchRecommendationCatalog).mockResolvedValue([]);
    const view = await mount();
    expect(
      view.root.findByType('DiscoverRecommendations').props.recommendations,
    ).toEqual([]);
    expect(getDiscoverRecommendations).not.toHaveBeenCalled();
    expect(view.root.findAllByType('SwipeCard')[0].props.product).toBe(top);
  });

  it('keeps the feed available when the candidate catalog request fails', async () => {
    jest
      .mocked(fetchRecommendationCatalog)
      .mockRejectedValue(new Error('catalog unavailable'));
    const view = await mount();
    expect(
      view.root.findByType('DiscoverRecommendations').props.recommendations,
    ).toEqual([]);
    expect(view.root.findAllByType('SwipeCard')[0].props.product).toBe(top);
  });

  it('isolates recommendation errors from the current feed and interactions', async () => {
    jest.mocked(getDiscoverRecommendations).mockImplementation(() => {
      throw new Error('test failure');
    });
    const view = await mount();
    expect(
      view.root.findByType('DiscoverRecommendations').props.recommendations,
    ).toEqual([]);
    const card = view.root.findAllByType('SwipeCard')[0];
    expect(card.props.product).toBe(top);
    (card.props.onPass as (product: Product) => void)(top);
    expect(mockSwipeLeft).toHaveBeenCalledWith(top);
    expect(card.props.onUndoPass).toEqual(expect.any(Function));
    expect(card.props.onVirtualTryOn).toEqual(expect.any(Function));
    expect(card.props.onBuy).toEqual(expect.any(Function));
  });

  it('does not rerender product pages or calculate recommendations when search input alone changes', async () => {
    const view = await mount();
    const calls = jest.mocked(getDiscoverRecommendations).mock.calls.length;
    const cardRenders = mockSwipeCardRender.mock.calls.length;
    await renderer.act(() => {
      (view.root.findByType(TextInput).props.onChangeText as (value: string) => void)('tişört');
    });
    expect(getDiscoverRecommendations).toHaveBeenCalledTimes(calls);
    expect(mockSwipeCardRender).toHaveBeenCalledTimes(cardRenders);
  });

  it('binds recommendations inside the product page rather than a separate stationary section', async () => {
    const view = await mount();
    const card = view.root.findAllByType('SwipeCard')[0];
    const section = view.root.findByType('DiscoverRecommendations');
    let ancestor = card.parent;
    let deck: TestNode | null = null;
    while (ancestor) {
      if (
        typeof ancestor.props.onLayout === 'function' &&
        ancestor.props.collapsable === false
      ) {
        deck = ancestor;
        break;
      }
      ancestor = ancestor.parent;
    }
    expect(deck).not.toBeNull();
    ancestor = section.parent;
    let insideProduct = false;
    while (ancestor) {
      if (ancestor === card) insideProduct = true;
      ancestor = ancestor.parent;
    }
    expect(insideProduct).toBe(true);
    expect(card.props.dragOffset).toBeDefined();
    expect(section.props.dragOffset).toBeUndefined();
    expect(section.props.pageHeight).toBeUndefined();
  });

  describe('product preference change', () => {
    const erkekTop = { ...top, id: 'erkek-top' };
    const erkekBottom = { ...bottom, id: 'erkek-bottom' };
    const kadinTop = { ...top, id: 'kadin-top' };
    const kadinBottom = { ...bottom, id: 'kadin-bottom' };
    const change = async (view: NonNullable<typeof tree>, pref: string | null) => {
      mockState.productPref = pref;
      await renderer.act(async () => { view.update(createElement(FeedScreen)); await Promise.resolve(); });
    };
    const settle = async () => { await renderer.act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); }); await flushIdle(); };

    it('builds exactly one new session, only once the new pool is ready, and never with an empty pool', async () => {
      mockState.currentProducts = [kadinTop, kadinBottom];
      jest.mocked(fetchRecommendationCatalog).mockResolvedValue([kadinTop, kadinBottom]);
      const view = await mount();
      const before = createdSessions.length;
      let release!: (products: Product[]) => void;
      jest.mocked(fetchRecommendationCatalog).mockImplementation(() => new Promise(resolve => { release = resolve; }));
      mockState.currentProducts = [erkekTop, erkekBottom];
      await change(view, 'erkek');
      await settle();
      expect(createdSessions.length).toBe(before);
      await renderer.act(async () => { release([erkekTop, erkekBottom]); await Promise.resolve(); });
      await settle();
      expect(createdSessions.length).toBe(before + 1);
      expect(createdSessions[before]).toEqual({ catalogIds: ['erkek-top', 'erkek-bottom'], productPref: 'erkek' });
      expect(createdSessions.slice(before).some(session => session.catalogIds.length === 0)).toBe(false);
    });

    it('never shows the old preference products while the new pool is pending', async () => {
      mockState.currentProducts = [kadinTop, kadinBottom];
      jest.mocked(fetchRecommendationCatalog).mockResolvedValue([kadinTop, kadinBottom]);
      const view = await mount();
      expect(view.root.findByType('DiscoverRecommendations').props.recommendations).not.toBeUndefined();
      jest.mocked(fetchRecommendationCatalog).mockImplementation(() => new Promise(() => {}));
      await change(view, 'erkek');
      await settle();
      const shown = view.root.findAllByType('SwipeCard')[0].props.recommendations as unknown;
      expect(shown === undefined || (Array.isArray(shown) && shown.length === 0)).toBe(true);
    });

    it('lets only the last of two quick changes win; a late result of the first is ignored', async () => {
      mockState.currentProducts = [kadinTop, kadinBottom];
      const view = await mount();
      const resolvers: Record<string, (products: Product[]) => void> = {};
      jest.mocked(fetchRecommendationCatalog).mockImplementation(pref => new Promise(resolve => { resolvers[String(pref)] = resolve; }));
      mockState.currentProducts = [erkekTop, erkekBottom];
      await change(view, 'erkek');
      await change(view, 'hepsi');
      await renderer.act(async () => { resolvers.hepsi([erkekTop, erkekBottom]); await Promise.resolve(); });
      await settle();
      const after = createdSessions.length;
      expect(createdSessions[after - 1]).toEqual({ catalogIds: ['erkek-top', 'erkek-bottom'], productPref: 'hepsi' });
      await renderer.act(async () => { resolvers.erkek([{ ...kadinTop, id: 'stale-erkek' }]); await Promise.resolve(); });
      await settle();
      expect(createdSessions.length).toBe(after);
      expect(createdSessions.some(session => session.catalogIds.includes('stale-erkek'))).toBe(false);
    });
  });

  it('shows the empty state for B when its recommendation is unavailable, never A cards', async () => {
    mockState.currentProducts = [top, bottom];
    jest.mocked(getDiscoverRecommendations).mockImplementation(async (input) =>
      input.requiredCatalogProductId === bottom.id ? [] : realService.getDiscoverRecommendations(input));
    const view = await mount();
    const firstProps = view.root.findByType('DiscoverRecommendations').props;
    expect(
      complementaryProductsForDisplay(
        firstProps.recommendations as ReturnType<
          typeof realService.getDiscoverRecommendations
        >,
        firstProps.currentProductId as string,
      ).length,
    ).toBeGreaterThan(0);
    jest
      .mocked(getDiscoverRecommendations)
      .mockImplementation(async (input) =>
        input.requiredCatalogProductId === bottom.id
          ? []
          : realService.getDiscoverRecommendations(input),
      );
    mockState.currentProducts = [bottom];
    await renderer.act(() => {
      view.update(createElement(FeedScreen));
    });
    const props = view.root.findByType('DiscoverRecommendations').props;
    expect(props.currentProductId).toBe(bottom.id);
    expect(props.recommendations).toEqual([]);
    expect(view.root.findAllByType('SwipeCard')[0].props.product).toBe(bottom);
  });

  it('retains the same product recommendations and avoids a replacement worker for an unchanged catalog on refocus', async () => {
    const view = await mount();
    const ready = view.root.findByType('DiscoverRecommendations').props.recommendations;
    expect(ready).not.toEqual([]);
    const renders = mockSwipeCardRender.mock.calls.length;
    expect(loadDiscoverRecommendationPacket).toHaveBeenCalledTimes(1);
    mockFocused = false;
    await renderer.act(() => { view.update(createElement(FeedScreen)); });
    // A fresh catalog fetch returns a new array/objects with identical content.
    jest.mocked(fetchRecommendationCatalog).mockResolvedValue(catalog.map(product => ({ ...product })));
    jest.mocked(loadDiscoverRecommendationPacket).mockImplementation(() => new Promise(() => {}));
    mockFocused = true;
    await renderer.act(async () => {
      view.update(createElement(FeedScreen));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect({
      sameRecommendations: view.root.findByType('DiscoverRecommendations').props.recommendations === ready,
      workerStarts: jest.mocked(loadDiscoverRecommendationPacket).mock.calls.length,
      catalogReads: jest.mocked(fetchRecommendationCatalog).mock.calls.length,
      additionalCardRenders: mockSwipeCardRender.mock.calls.length - renders,
    }).toEqual({ sameRecommendations: true, workerStarts: 2, catalogReads: 2, additionalCardRenders: 0 });
  });

  it('keeps valid recommendations through a slow or failed catalog refresh', async () => {
    const view = await mount();
    const ready = view.root.findByType('DiscoverRecommendations').props.recommendations;
    let fail!: (reason: Error) => void;
    jest.mocked(fetchRecommendationCatalog).mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
    mockFocused = false;
    await renderer.act(() => { view.update(createElement(FeedScreen)); });
    mockFocused = true;
    await renderer.act(() => { view.update(createElement(FeedScreen)); });
    expect(view.root.findByType('DiscoverRecommendations').props.recommendations).toBe(ready);
    await renderer.act(async () => { fail(new Error('slow network failed')); });
    expect(view.root.findByType('DiscoverRecommendations').props.recommendations).toBe(ready);
  });

  it('ignores packets from an old focus during fast product changes and undo', async () => {
    const delayed: Array<() => void> = [];
    jest.mocked(loadDiscoverRecommendationPacket).mockImplementation(async (request, _owner, _signal, publish) => {
      delayed.push(() => {
        const anchor = request.anchors[0];
        const context = anchorContext(request.candidatePool, anchor, [], new Map(request.exposure));
        publish({ ...request, entries: [{ anchorProductId: anchor.id, exposure: request.exposure,
          serialized: serializeFinal(realService.getDiscoverRecommendations(context.input), context) }] });
      });
    });
    const view = await mount();
    mockState.currentProducts = [bottom, shoes];
    await renderer.act(() => { view.update(createElement(FeedScreen)); });
    mockFocused = false;
    await renderer.act(() => { view.update(createElement(FeedScreen)); });
    mockFocused = true;
    await renderer.act(() => { view.update(createElement(FeedScreen)); });
    await renderer.act(() => { delayed[0](); });
    expect(view.root.findByType('DiscoverRecommendations').props.currentProductId).toBe(bottom.id);
    expect(view.root.findByType('DiscoverRecommendations').props.recommendations).toEqual([]);
    await renderer.act(() => { delayed[1](); });
    const readyB = view.root.findByType('DiscoverRecommendations').props.recommendations;
    expect(readyB).not.toEqual([]);
    mockState.currentProducts = [top, bottom, shoes];
    await renderer.act(() => { view.update(createElement(FeedScreen)); });
    expect(view.root.findByType('DiscoverRecommendations').props.recommendations).toEqual([]);
    mockState.currentProducts = [bottom, shoes];
    await renderer.act(() => { view.update(createElement(FeedScreen)); });
    expect(view.root.findByType('DiscoverRecommendations').props.recommendations).toBe(readyB);
    expect(loadDiscoverRecommendationPacket).toHaveBeenCalledTimes(2);
  });


  it.each(['replacement', 'in-place'] as const)('invalidates real catalog changes (%s), even if product references are reused', async kind => {
    const refreshed = catalog.map(product => ({ ...product }));
    jest.mocked(fetchRecommendationCatalog).mockResolvedValue(refreshed);
    const view = await mount();
    const initialSession = jest.mocked(loadDiscoverRecommendationPacket).mock.calls[0][0].sessionId;
    mockFocused = false;
    await renderer.act(() => { view.update(createElement(FeedScreen)); });
    if (kind === 'replacement') {
      jest.mocked(fetchRecommendationCatalog).mockResolvedValue(refreshed.map((product, index) =>
        index === 1 ? { ...product, price: product.price + 1 } : product));
    } else refreshed[1].price += 1;
    jest.mocked(loadDiscoverRecommendationPacket).mockImplementation(() => new Promise(() => {}));
    mockFocused = true;
    await renderer.act(async () => { view.update(createElement(FeedScreen)); await Promise.resolve(); });
    const calls = jest.mocked(loadDiscoverRecommendationPacket).mock.calls;
    expect(calls.at(-1)![0].sessionId).not.toBe(initialSession);
    expect(view.root.findByType('DiscoverRecommendations').props.recommendations).toEqual([]);
    expect(view.root.findAllByType('SwipeCard')[0].props.recommendationStatus).toBe('loading');
  });

  it('distinguishes pending, successful empty and failed preparation without hiding the feed', async () => {
    let fail!: (reason: Error) => void;
    jest.mocked(loadDiscoverRecommendationPacket).mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
    const view = await mount();
    expect(view.root.findAllByType('SwipeCard')[0].props.recommendationStatus).toBe('loading');
    await renderer.act(async () => { fail(new Error('preparation failed')); });
    expect(view.root.findAllByType('SwipeCard')[0].props.recommendationStatus).toBe('error');
    expect(view.root.findAllByType('SwipeCard')[0].props.product).toBe(top);
  });


  it('reopens after unmount without publishing a previous screen packet under the new product', async () => {
    const deliveries: Array<() => void> = [];
    jest.mocked(loadDiscoverRecommendationPacket).mockImplementation(async (request, _owner, _signal, publish) => {
      deliveries.push(() => {
        const anchor = request.anchors[0];
        const context = anchorContext(request.candidatePool, anchor, [], new Map(request.exposure));
        publish({ ...request, entries: [{ anchorProductId: anchor.id, exposure: request.exposure,
          serialized: serializeFinal(realService.getDiscoverRecommendations(context.input), context) }] });
      });
    });
    const old = await mount();
    await renderer.act(() => { old.unmount(); });
    tree = null;
    mockState.currentProducts = [bottom, shoes];
    const view = await mount();
    await renderer.act(() => { deliveries[0](); });
    expect(view.root.findByType('DiscoverRecommendations').props.currentProductId).toBe(bottom.id);
    expect(view.root.findAllByType('SwipeCard')[0].props.recommendationStatus).toBe('loading');
    await renderer.act(() => { deliveries[1](); });
    expect(view.root.findAllByType('SwipeCard')[0].props.recommendationStatus).toBe('ready');
    expect(view.root.findByType('DiscoverRecommendations').props.recommendations).not.toEqual([]);
    expect(loadDiscoverRecommendationPacket).toHaveBeenCalledTimes(2);
  });

});

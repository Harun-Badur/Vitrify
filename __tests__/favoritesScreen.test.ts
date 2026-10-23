import { createElement, type ElementType, type ReactElement } from 'react';
import { Alert, FlatList, Modal, ScrollView, TextInput } from 'react-native';
import FavoritesScreen from '../app/(tabs)/style';
import { MOCK_PRODUCTS } from '../data/mockProducts';
import type { LikedProduct } from '../types/product';
import { withSpring } from 'react-native-reanimated';

interface TestNode {
  props: {
    data: LikedProduct[];
    numColumns: number;
    onPress: () => void;
    onChangeText: (value: string) => void;
  };
}
interface TestTree {
  root: {
    findByType: (type: ElementType) => TestNode;
    findByProps: (props: Record<string, unknown>) => TestNode;
    findAllByProps: (props: Record<string, unknown>) => TestNode[];
  };
  unmount: () => void;
  update: (element: ReactElement) => void;
}
const renderer = jest.requireActual('react-test-renderer') as {
  create: (element: ReactElement) => TestTree;
  act: (callback: () => void | Promise<void>) => Promise<void>;
};

// RN exports these through lazy getters. Resolve the real components once during
// suite setup, so the first mount hook measures rendering rather than Babel's
// cold transformation of their native dependency graph. No components are mocked.
const nativeComponents = { FlatList, Modal, ScrollView };

const mockRemove = jest.fn().mockResolvedValue(undefined);
const mockRefresh = jest.fn().mockResolvedValue(undefined);
const mockState = {
  favoritesOwner: 'alice' as string | null,
  favoritesStatus: 'success' as 'idle' | 'loading' | 'success' | 'error',
  favoritesError: null as string | null,
  sessionUserId: 'alice' as string | null,
  likedProducts: [] as LikedProduct[],
  unlikeProduct: mockRemove,
  refreshLikedProducts: mockRefresh,
};
jest.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: typeof mockState) => unknown) =>
    selector(mockState),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }),
}));
jest.mock('lucide-react-native', () => ({
  ChevronDown: () => null,
  Heart: () => null,
  MoreVertical: () => null,
  Trash2: () => null,
  Search: () => null,
  SlidersHorizontal: () => null,
  X: () => null,
}));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('../components/PressableScale', () => 'PressableScale');
jest.mock('../components/VirtualTryOnModal', () => 'VirtualTryOnModal');
const mockGestures: Array<{
  update?: (event: { translationX: number }) => void;
  end?: () => void;
}> = [];
jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: 'GestureDetector',
  Gesture: {
    Pan: () => {
      const handlers: (typeof mockGestures)[number] = {};
      mockGestures.push(handlers);
      const chain = {
        activeOffsetX: jest.fn().mockReturnThis(),
        failOffsetY: jest.fn().mockReturnThis(),
        onUpdate: (callback: typeof handlers.update) => {
          handlers.update = callback;
          return chain;
        },
        onEnd: (callback: typeof handlers.end) => {
          handlers.end = callback;
          return chain;
        },
      };
      return chain;
    },
  },
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  cancelAnimation: jest.fn(),
  Extrapolation: { CLAMP: 'clamp' },
  interpolate: () => 0,
  runOnJS: (callback: () => void) => callback,
  useAnimatedStyle: (callback: () => unknown) => callback(),
  useSharedValue: (value: number) => {
    const React = jest.requireActual('react') as typeof import('react');
    return React.useRef({ value }).current;
  },
  withSpring: jest.fn((value: number) => value),
  withTiming: (
    value: number,
    _config: unknown,
    callback?: (finished: boolean) => void,
  ) => {
    callback?.(true);
    return value;
  },
}));
jest.mock('../services/deeplinkService', () => ({
  openProductPage: jest.fn().mockResolvedValue(undefined),
}));

describe('Favorites screen', () => {
  let view: TestTree;
  beforeEach(async () => {
    jest.clearAllMocks();
    mockState.favoritesOwner = 'alice';
    mockState.favoritesStatus = 'success';
    mockState.favoritesError = null;
    mockState.sessionUserId = 'alice';
    mockGestures.length = 0;
    mockState.likedProducts = MOCK_PRODUCTS.slice(0, 3).map(
      (product, index) => ({
        product,
        likedAt: `2026-09-${20 + index}T00:00:00Z`,
        notifyOnPriceDrop: true,
      }),
    );
    await renderer.act(async () => {
      view = renderer.create(createElement(FavoritesScreen));
    });
  });
  afterEach(async () => {
    await renderer.act(async () => { view?.unmount(); });
    jest.restoreAllMocks();
  });

  it('distinguishes first loading and failed reads from a genuinely empty collection', async () => {
    mockState.likedProducts = [];
    mockState.favoritesStatus = 'loading';
    await renderer.act(() => view.update(createElement(FavoritesScreen)));
    expect(view.root.findByProps({ accessibilityLabel: 'Favoriler yükleniyor' })).toBeDefined();
    expect(view.root.findAllByProps({ children: 'Henüz favori ürün yok.' })).toHaveLength(0);
    mockState.favoritesStatus = 'error';
    mockState.favoritesError = 'Bağlantı kurulamadı.';
    await renderer.act(() => view.update(createElement(FavoritesScreen)));
    expect(view.root.findByProps({ accessibilityLabel: 'Favorileri yeniden yükle' })).toBeDefined();
    expect(view.root.findAllByProps({ children: 'Henüz favori ürün yok.' })).toHaveLength(0);
  });

  it('keeps cached favorites visible during a refresh failure', async () => {
    mockState.favoritesStatus = 'error';
    mockState.favoritesError = 'Bağlantı kurulamadı.';
    await renderer.act(() => view.update(createElement(FavoritesScreen)));
    expect(view.root.findByType(FlatList).props.data).toHaveLength(3);
    expect(view.root.findByProps({ accessibilityLabel: 'Favorileri yeniden yükle' })).toBeDefined();
  });

  it('uses existing favorite references in a wardrobe list and sorts without mutating state', async () => {
    const before = [...mockState.likedProducts];
    const list = (): TestNode => view.root.findByType(nativeComponents.FlatList);
    expect(list().props.numColumns).toBeUndefined();
    expect(list().props.data).toEqual([...before].reverse());
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await renderer.act(() =>
      view.root
        .findByProps({ accessibilityLabel: 'Favorileri sırala' })
        .props.onPress(),
    );
    const option = alert.mock.lastCall?.[2]?.find(
      (button) => button.text === 'Fiyat: Artan',
    );
    await renderer.act(() => option?.onPress?.());
    expect(
      list().props.data.map((item: LikedProduct) => item.product.price),
    ).toEqual(before.map((item) => item.product.price).sort((a, b) => a - b));
    expect(mockState.likedProducts).toEqual(before);
  });

  it('searches existing products and displays no invented saved outfits', async () => {
    await renderer.act(() =>
      view.root
        .findByProps({ accessibilityLabel: 'Favorilerde ara' })
        .props.onPress(),
    );
    await renderer.act(() =>
      view.root.findByType(TextInput).props.onChangeText('no-matching-product'),
    );
    expect(view.root.findByType(FlatList).props.data).toEqual([]);
    const tabs = view.root.findAllByProps({ accessibilityRole: 'tab' });
    await renderer.act(() => tabs[2].props.onPress());
    expect(view.root.findByType(FlatList).props.data).toEqual([]);
  });

  it('removes a favorite through the existing action and reports removal failure', async () => {
    const product = mockState.likedProducts[0].product;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockRemove.mockRejectedValueOnce(new Error('offline'));
    await renderer.act(() =>
      view.root
        .findByProps({
          accessibilityLabel: `${product.title} favorilerden çıkar`,
        })
        .props.onPress(),
    );
    expect(mockRemove).toHaveBeenCalledWith(product.id);
    expect(alert).toHaveBeenCalledWith(
      'Favori kaldırılamadı',
      'Kayıt korundu. Lütfen tekrar dene.',
    );
  });

  it('removes only after a left swipe reaches the wardrobe threshold', async () => {
    const gesture = mockGestures[0];
    for (const translationX of [90, -71]) {
      await renderer.act(() => {
        gesture.update?.({ translationX });
        gesture.end?.();
      });
    }
    expect(mockRemove).not.toHaveBeenCalled();
    await renderer.act(() => {
      gesture.update?.({ translationX: -72 });
      gesture.end?.();
    });
    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockRemove).toHaveBeenCalledWith(
      mockState.likedProducts[2].product.id,
    );
  });

  it('restores the swiped card when favorite removal fails', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockRemove.mockRejectedValueOnce(new Error('offline'));
    await renderer.act(() => {
      mockGestures[0].update?.({ translationX: -100 });
      mockGestures[0].end?.();
    });
    expect(withSpring).toHaveBeenCalledWith(0, { damping: 18, stiffness: 180 });
    expect(alert).toHaveBeenCalledWith(
      'Favori kaldırılamadı',
      'Kayıt korundu. Lütfen tekrar dene.',
    );
  });
  it('old owner removal does not alert or animate a new owner card', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    let reject!: (error: Error) => void;
    mockRemove.mockReturnValueOnce(new Promise<void>((_, r) => { reject = r; }));
    await renderer.act(() => {
      mockGestures[0].update?.({ translationX: -100 });mockGestures[0].end?.();
    });
    mockState.sessionUserId = 'bob';
    await renderer.act(async () => { view.update(createElement(FavoritesScreen)); });
    const before = jest.mocked(withSpring).mock.calls.length;
    await renderer.act(() => reject(new Error('old owner')));
    expect(alert).not.toHaveBeenCalled();
    expect(jest.mocked(withSpring).mock.calls.length).toBe(before);
  });
  it('reloads on mount and owner change through the existing refresh action', async () => {
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    mockState.sessionUserId = 'bob';
    await renderer.act(async () => { view.update(createElement(FavoritesScreen)); });
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });
});

import { createElement, type ReactElement } from 'react';
import { FlatList } from 'react-native';
import LikedScreen from '../app/(tabs)/liked';
import { getProductImages } from '../types/product';
import type { SavedOutfit, WardrobeItem } from '../types/wardrobe';

interface TestNode { props: Record<string, unknown> & { onPress: () => void; data: unknown } }
interface TestTree {
  root: {
    findAllByType: (type: unknown) => TestNode[];
    findAllByProps: (props: Record<string, unknown>) => TestNode[];
  };
  unmount: () => void;
}
const renderer = jest.requireActual('react-test-renderer') as {
  create: (element: ReactElement) => TestTree;
  act: (callback: () => void | Promise<void>) => Promise<void>;
};

const mockState = {
  wardrobeStatus: 'ready' as const,
  sessionSyncStatus: 'ready',
  sessionUserId: 'alice',
  likedProducts: [],
  wardrobeItems: Array.from({ length: 6 }, (_, index): WardrobeItem => ({
    id: `owned-${index}`, title: `Kıyafet ${index}`, category: 'upper_body',
    brand: '', imageUrl: `file:///wardrobe/${index}.jpg`, createdAt: '2026-09-28',
  })),
  savedOutfits: [
    { id: 'o1', title: 'Kombin 1', wardrobeItemIds: ['owned-0'], catalogProductIds: [] },
    { id: 'o2', title: 'Kombin 2', wardrobeItemIds: ['owned-1'], catalogProductIds: [] },
  ] as unknown as SavedOutfit[],
  removeWardrobeItem: jest.fn().mockResolvedValue(undefined),
  refreshLikedProducts: jest.fn().mockResolvedValue(undefined),
  refreshWardrobe: jest.fn().mockResolvedValue(undefined),
  wardrobeSync: undefined,
};
jest.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: typeof mockState) => unknown) => selector(mockState),
}));
jest.mock('../types/product', () => {
  const actual = jest.requireActual<typeof import('../types/product')>('../types/product');
  return { ...actual, getProductImages: jest.fn(actual.getProductImages) };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }),
}));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('../components/PressableScale', () => 'PressableScale');
jest.mock('../components/OutfitCover', () => 'OutfitCover');
jest.mock('../components/WardrobeItemSheet', () => 'WardrobeItemSheet');
jest.mock('react-native-gesture-handler', () => {
  const chain: Record<string, unknown> = {};
  for (const name of ['enabled', 'activeOffsetX', 'failOffsetY', 'onUpdate', 'onEnd']) chain[name] = () => chain;
  return { GestureDetector: 'GestureDetector', Gesture: { Pan: () => chain } };
});
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
  withSpring: (value: number) => value,
  withTiming: (value: number) => value,
}));
jest.mock('../services/deeplinkService', () => ({ openProductPage: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-router', () => ({
  router: { navigate: jest.fn(), push: jest.fn() },
  useFocusEffect: (callback: () => void) => {
    const React = jest.requireActual('react') as typeof import('react');
    React.useEffect(callback, [callback]);
  },
}));
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../lib/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn() } }));

const imageCalls = jest.mocked(getProductImages);
let view: TestTree;
beforeEach(async () => {
  await renderer.act(async () => { view = renderer.create(createElement(LikedScreen)); });
});
afterEach(async () => {
  await renderer.act(async () => view.unmount());
});
const openSearch = () => renderer.act(async () => {
  view.root.findAllByType('PressableScale').find(node => node.props.accessibilityLabel === 'Dolapta ara')?.props.onPress();
});

test('an unrelated screen re-render does not re-render the wardrobe cards', async () => {
  expect(imageCalls.mock.calls.length).toBeGreaterThan(0);
  imageCalls.mockClear();
  await openSearch();
  expect(view.root.findAllByProps({ accessibilityLabel: 'Dolap araması' }).length).toBeGreaterThan(0);
  expect(imageCalls).not.toHaveBeenCalled();
});

test('both grids keep their data and renderItem references across an unrelated re-render', async () => {
  const grids = () => view.root.findAllByType(FlatList).map(grid => grid.props);
  const before = grids();
  expect(before).toHaveLength(2);
  await openSearch();
  const after = grids();
  for (const index of [0, 1]) {
    expect(after[index].data).toBe(before[index].data);
    expect(after[index].renderItem).toBe(before[index].renderItem);
  }
});

test('grid contents are unchanged: the add card stays after three clothes and two outfits', () => {
  const [clothes, outfits] = view.root.findAllByType(FlatList).map(grid => grid.props.data as unknown[]);
  expect(clothes).toHaveLength(7);
  expect(clothes[3]).toBeNull();
  expect(outfits).toHaveLength(3);
  expect(outfits[2]).toBeNull();
});

import { createElement, type ReactElement } from 'react';
import DiscoverRecommendations from '../components/DiscoverRecommendations';
import { stripLatency } from '../lib/stripLatency';
import type { DiscoverRecommendation } from '../src/intelligence/recommendations/discoverRecommendation';
import type { Product } from '../types/product';

// As if the bundle was started with EXPO_PUBLIC_PERF_BISECT defined.
jest.mock('../lib/perfBisect', () => ({ ...jest.requireActual('../lib/perfBisect'), perfBisectActive: true }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));
jest.mock('lucide-react-native', () => ({ Check: 'Check', Heart: 'Heart' }));
jest.mock('../components/PressableScale', () => 'PressableScale');
jest.mock('../components/DiscoverProductImage', () => 'DiscoverProductImage');

interface TestNode { props: Record<string, unknown> }
interface TestTree { root: { findAllByType: (type: string) => TestNode[] }; update: (element: ReactElement) => void; unmount: () => void }
const renderer = jest.requireActual('react-test-renderer') as {
  act: (callback: () => void) => Promise<void>;
  create: (element: ReactElement) => TestTree;
};

const product = (id: string, role: Product['outfitRole'], category: Product['category']): Product => ({
  id, brand: 'B', title: id, price: 100, imageUrl: `https://example.com/${id}.jpg`, category, outfitRole: role,
  garmentDescription: id, gender: 'women' });
const anchor = product('anchor', 'top', 'upper_body');
const recommendations = [{ type: 'outfit', candidate: { items: [anchor, product('bottom', 'bottom', 'lower_body'),
  product('shoes', 'shoes', 'shoes')].map(item => ({ sourceType: 'catalog', sourceId: item.id, product: item })) } }] as unknown as DiscoverRecommendation[];

afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

it('the rendered strip reports loading → ready and every cover onLoad, logging one strip line (fake clock)', async () => {
  jest.useFakeTimers({ now: 0 });
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  const tracker = stripLatency!;
  expect(tracker).not.toBeNull();
  tracker.deck([anchor.id]);
  let tree: TestTree | undefined;
  await renderer.act(() => {
    tree = renderer.create(createElement(DiscoverRecommendations, { currentProductId: anchor.id, status: 'loading', recommendations: [] }));
  });
  jest.advanceTimersByTime(40);
  await renderer.act(() => {
    tree!.update(createElement(DiscoverRecommendations, { currentProductId: anchor.id, status: 'ready', recommendations }));
  });
  jest.advanceTimersByTime(25);
  const images = tree!.root.findAllByType('DiscoverProductImage');
  expect(images).toHaveLength(2);
  await renderer.act(() => (images[0].props.onLoad as () => void)());
  expect(log).not.toHaveBeenCalled();
  jest.advanceTimersByTime(10);
  await renderer.act(() => (images[1].props.onLoad as () => void)());
  expect(log.mock.calls.map(call => call[0])).toEqual([
    '[BISECT] strip role=current swipe_to_ready_ms=40 ready_to_images_ms=35 queue_wait_ms=- prepare_ms=- cold=true']);
  await renderer.act(() => tree!.unmount());
});

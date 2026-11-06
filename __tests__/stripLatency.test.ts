import { createElement, type ReactElement } from 'react';
import DiscoverRecommendations from '../components/DiscoverRecommendations';
import { createStripLatencyTracker, stripLatency } from '../lib/stripLatency';
import type { DiscoverRecommendation } from '../src/intelligence/recommendations/discoverRecommendation';
import type { Product } from '../types/product';

// Fake clock: every timestamp comes from `now`, advanced explicitly by the test.
function harness(summaryEvery = 10) {
  let now = 0;
  const lines: string[] = [];
  const tracker = createStripLatencyTracker({ now: () => now, log: line => lines.push(line), summaryEvery });
  return { tracker, lines, at: (ms: number) => { now = ms; } };
}
const strips = (lines: string[]) => lines.filter(line => line.startsWith('[BISECT] strip '));

describe('createStripLatencyTracker', () => {
  it('measures swipe → ready strip → all cover images per role, with queue wait and prepare time', () => {
    const { tracker, lines, at } = harness();
    // Cold open: no swipe yet, so the deck appearing is the start.
    tracker.deck(['a', 'b', 'c']);
    at(5); tracker.strip('a', 'ready', ['a1', 'a2', 'a3']);
    at(9); ['a1', 'a2', 'a3'].forEach(uri => tracker.imageLoaded('a', uri));
    expect(strips(lines)).toEqual(['[BISECT] strip role=current swipe_to_ready_ms=5 ready_to_images_ms=4 queue_wait_ms=- prepare_ms=- cold=true']);

    at(20); tracker.prepareStart('b');
    at(70); tracker.prepareEnd('b');
    at(80); tracker.strip('b', 'ready', ['b1', 'b2']);
    at(100); tracker.imageLoaded('b', 'b1'); tracker.imageLoaded('b', 'b2');
    at(1000); tracker.swipe();
    at(1004); tracker.deck(['b', 'c', 'd']);
    // b was ready with loaded images before the swipe; c and d were not.
    at(1010); tracker.prepareStart('d');
    at(1030); tracker.strip('c', 'ready', ['c1']);
    at(1100); tracker.imageLoaded('c', 'c1');
    at(1250); tracker.prepareEnd('d');
    at(1260); tracker.strip('d', 'ready', ['d1']);
    at(1300); tracker.imageLoaded('d', 'd1');
    expect(strips(lines).slice(1)).toEqual([
      // The next card finished before the swipe; the unfinished +2 closes at the swipe with ">elapsed".
      '[BISECT] strip role=next swipe_to_ready_ms=80 ready_to_images_ms=20 queue_wait_ms=20 prepare_ms=50 cold=true',
      '[BISECT] strip role=+2 swipe_to_ready_ms=>1000 ready_to_images_ms=- queue_wait_ms=- prepare_ms=- cold=true',
      '[BISECT] strip role=current swipe_to_ready_ms=0 ready_to_images_ms=0 queue_wait_ms=pre prepare_ms=50 cold=false',
      '[BISECT] strip role=next swipe_to_ready_ms=30 ready_to_images_ms=70 queue_wait_ms=- prepare_ms=- cold=false',
      '[BISECT] strip role=+2 swipe_to_ready_ms=260 ready_to_images_ms=40 queue_wait_ms=10 prepare_ms=240 cold=false',
    ]);
  });

  it('reports a strip still loading at the next swipe, and images still loading, as >elapsed', () => {
    const { tracker, lines, at } = harness();
    tracker.deck(['a', 'b']);
    at(10); tracker.swipe(); tracker.deck(['b', 'c']);
    at(15); tracker.strip('b', 'loading', []);
    at(40); tracker.prepareStart('c');
    at(60); tracker.strip('c', 'ready', ['c1', 'c2']);
    at(70); tracker.imageLoaded('c', 'c1');
    at(500); tracker.swipe(); tracker.deck(['c', 'd']);
    expect(strips(lines).slice(-2)).toEqual([
      '[BISECT] strip role=current swipe_to_ready_ms=>490 ready_to_images_ms=- queue_wait_ms=- prepare_ms=- cold=false',
      '[BISECT] strip role=next swipe_to_ready_ms=50 ready_to_images_ms=>440 queue_wait_ms=30 prepare_ms=>460 cold=false',
    ]);
  });

  it('uses the swipe time, not the later deck commit, as the start', () => {
    const { tracker, lines, at } = harness();
    tracker.deck(['a']);
    at(100); tracker.swipe();
    at(130); tracker.deck(['b']);
    at(130); tracker.strip('b', 'ready', []);
    expect(strips(lines).at(-1)).toBe('[BISECT] strip role=current swipe_to_ready_ms=30 ready_to_images_ms=- queue_wait_ms=- prepare_ms=- cold=false');
  });

  it('marks an error strip or a failed cover image as err', () => {
    const { tracker, lines, at } = harness();
    tracker.deck(['a', 'b']);
    at(10); tracker.strip('a', 'error', []);
    at(20); tracker.strip('b', 'ready', ['b1', 'b2']);
    at(30); tracker.imageLoaded('b', 'b1'); tracker.imageFailed('b', 'b2');
    expect(strips(lines)).toEqual([
      '[BISECT] strip role=current swipe_to_ready_ms=err ready_to_images_ms=- queue_wait_ms=- prepare_ms=- cold=true',
      '[BISECT] strip role=next swipe_to_ready_ms=20 ready_to_images_ms=err queue_wait_ms=- prepare_ms=- cold=true',
    ]);
  });

  it('waits again when the ready strip swaps to different covers', () => {
    const { tracker, lines, at } = harness();
    tracker.deck(['a']);
    at(10); tracker.strip('a', 'ready', ['a1']);
    at(20); tracker.strip('a', 'ready', ['a2']);
    at(25); tracker.imageLoaded('a', 'a1');
    expect(strips(lines)).toEqual([]);
    at(40); tracker.imageLoaded('a', 'a2');
    expect(strips(lines)).toEqual(['[BISECT] strip role=current swipe_to_ready_ms=10 ready_to_images_ms=30 queue_wait_ms=- prepare_ms=- cold=true']);
  });

  it('keeps the round when only a later deck slot changes, timing the new card from then', () => {
    const { tracker, lines, at } = harness();
    tracker.deck(['a']);
    at(10); tracker.strip('a', 'ready', []);
    at(50); tracker.deck(['a', 'b']);
    at(80); tracker.strip('b', 'ready', []);
    expect(strips(lines)).toEqual([
      '[BISECT] strip role=current swipe_to_ready_ms=10 ready_to_images_ms=- queue_wait_ms=- prepare_ms=- cold=true',
      '[BISECT] strip role=next swipe_to_ready_ms=30 ready_to_images_ms=- queue_wait_ms=- prepare_ms=- cold=true',
    ]);
  });

  it('summarizes every 10 swiped rounds per role with nearest-rank median and p90; cold rounds are excluded', () => {
    const { tracker, lines, at } = harness();
    tracker.deck(['p0', 'q0']);
    at(1); tracker.strip('p0', 'ready', []);
    let clock = 1000;
    for (let swipe = 1; swipe <= 10; swipe++) {
      at(clock); tracker.swipe(); tracker.deck([`p${swipe}`, `q${swipe}`]);
      at(clock + swipe); tracker.strip(`p${swipe}`, 'ready', []);
      if (swipe <= 9) { at(clock + 10 * swipe); tracker.strip(`q${swipe}`, 'ready', []); }
      clock += 1000;
    }
    expect(lines.filter(line => line.startsWith('[BISECT] strip_summary'))).toEqual([]);
    at(clock); tracker.swipe(); tracker.deck(['p11']);
    expect(lines.filter(line => line.startsWith('[BISECT] strip_summary'))).toEqual([
      '[BISECT] strip_summary swipes=10 role=current n=10 swipe_to_ready_ms=p50:5/p90:9 ready_to_images_ms=- queue_wait_ms=- prepare_ms=- incomplete=0',
      '[BISECT] strip_summary swipes=10 role=next n=10 swipe_to_ready_ms=p50:50/p90:90 ready_to_images_ms=- queue_wait_ms=- prepare_ms=- incomplete=1',
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Wiring: inactive without EXPO_PUBLIC_PERF_BISECT, reporting with it. */
/* ------------------------------------------------------------------ */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));
jest.mock('lucide-react-native', () => ({ Check: 'Check', Heart: 'Heart' }));
jest.mock('../components/PressableScale', () => 'PressableScale');
jest.mock('../components/DiscoverProductImage', () => 'DiscoverProductImage');

interface TestNode { props: Record<string, unknown> }
interface TestTree { root: { findAllByType: (type: string) => TestNode[] }; unmount: () => void }
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

describe('strip latency wiring', () => {
  const original = process.env.EXPO_PUBLIC_PERF_BISECT;
  afterEach(() => {
    if (original === undefined) delete process.env.EXPO_PUBLIC_PERF_BISECT;
    else process.env.EXPO_PUBLIC_PERF_BISECT = original;
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('without the variable there is no tracker and strip images get no extra load handlers', async () => {
    expect(process.env.EXPO_PUBLIC_PERF_BISECT).toBeUndefined();
    expect(stripLatency).toBeNull();
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    let tree: TestTree | undefined;
    await renderer.act(() => {
      tree = renderer.create(createElement(DiscoverRecommendations, { currentProductId: anchor.id, status: 'ready', recommendations }));
    });
    const images = tree!.root.findAllByType('DiscoverProductImage');
    expect(images).toHaveLength(2);
    expect(images.every(node => !('onLoad' in node.props) && !('onError' in node.props))).toBe(true);
    expect(log).not.toHaveBeenCalled();
    await renderer.act(() => tree!.unmount());
  });

  it('with the variable the worker reports ranking.prepare start and end for the anchor', async () => {
    process.env.EXPO_PUBLIC_PERF_BISECT = 'on';
    let modules: { strip: typeof import('../lib/stripLatency'); service: typeof import('../services/discoverRecommendationCacheService');
      cache: typeof import('../lib/discoverRecommendationCache'); repo: typeof import('../services/productRepository') } | undefined;
    jest.isolateModules(() => {
      jest.doMock('../lib/supabase', () => ({ getSupabaseClient: jest.fn(() => null) }));
      modules = { strip: require('../lib/stripLatency'), service: require('../services/discoverRecommendationCacheService'),
        cache: require('../lib/discoverRecommendationCache'), repo: require('../services/productRepository') };
    });
    const { strip, service, cache, repo } = modules!;
    const started = jest.spyOn(strip.stripLatency!, 'prepareStart');
    const ended = jest.spyOn(strip.stripLatency!, 'prepareEnd');
    const products = repo.getProductRepository().register([anchor, product('bottom', 'bottom', 'lower_body'),
      product('shoes', 'shoes', 'shoes')]);
    const session = new cache.DiscoverRecommendationCache(products, [], null);
    session.setPreparationWindow(products.slice(0, 1));
    const controller = new AbortController();
    let published = false;
    const done = service.loadDiscoverRecommendationPacket(session.request(products, 1), null, controller.signal, packet => {
      session.accept(packet, products); published = true;
    }, session);
    const deadline = Date.now() + 5000;
    while (!published && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    expect(published).toBe(true);
    expect(started.mock.calls).toEqual([[anchor.id]]);
    expect(ended.mock.calls).toEqual([[anchor.id]]);
    controller.abort(); await done;
  });
});

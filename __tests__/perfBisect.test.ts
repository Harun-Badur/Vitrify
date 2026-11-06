import { createStallMonitor, parsePerfBisect } from '../lib/perfBisect';

describe('parsePerfBisect', () => {
  it('is inactive when the variable is not defined', () => {
    expect(parsePerfBisect(undefined)).toEqual({ active: false, flags: new Set(), unknown: [] });
  });

  it('is inactive when the variable is empty or only whitespace', () => {
    for (const raw of ['', ' ', ' \t\n ']) expect(parsePerfBisect(raw)).toEqual({ active: false, flags: new Set(), unknown: [] });
  });

  it('parses a comma list, trims, ignores case-sensitive unknowns and keeps the monitor on for "on"', () => {
    expect(parsePerfBisect(' noRanking, noPublish ,,noranking,bogus')).toEqual({
      active: true, flags: new Set(['noRanking', 'noPublish']), unknown: ['noranking', 'bogus'] });
    expect(parsePerfBisect('on')).toEqual({ active: true, flags: new Set(), unknown: [] });
    expect(parsePerfBisect('noRanking,noPublish,noImagePrefetch,noAnalytics,noProfile,noSentryPerf').flags.size).toBe(6);
  });
});

function harness() {
  let now = 0;
  const lines: string[] = [];
  const monitor = createStallMonitor({ now: () => now, log: line => lines.push(line), flagsLabel: 'noRanking',
    schedule: () => () => {} });
  // Advance the clock and deliver the 50 ms tick at `at` (a late tick simulates a stalled JS thread).
  const tickAt = (at: number) => { now = at; monitor.tick(); };
  const run = (from: number, to: number) => { for (let at = from; at <= to; at += 50) tickAt(at); };
  return { monitor, lines, tickAt, run, setNow: (at: number) => { now = at; } };
}

describe('createStallMonitor', () => {
  it('counts only ticks more than 100 ms late as stalls and logs duration with ms since the last swipe', () => {
    const { monitor, lines, tickAt, setNow } = harness();
    monitor.start();
    tickAt(50); tickAt(100); tickAt(250); // 100 ms late: not a stall
    setNow(300); monitor.markSwipe();
    tickAt(520); // expected 300, 220 ms late
    expect(lines).toEqual(['[BISECT] stall ms=220 since_swipe=220 flags=noRanking']);
  });

  it('reports since_swipe=none before any swipe', () => {
    const { monitor, lines, tickAt } = harness();
    monitor.start();
    tickAt(50); tickAt(300);
    expect(lines).toEqual(['[BISECT] stall ms=200 since_swipe=none flags=noRanking']);
  });

  it('writes the total stall ms within 1 s after each swipe', () => {
    const { monitor, lines, tickAt, run, setNow } = harness();
    monitor.start();
    monitor.markSwipe();
    tickAt(200); // 150 late
    tickAt(250); tickAt(500); // 200 late
    run(550, 1050);
    expect(lines.filter(line => line.includes('swipe_stall'))).toEqual(['[BISECT] swipe_stall total_ms=350 count=2 flags=noRanking']);
    // A swipe with no stalls still reports 0.
    run(1100, 2000);
    setNow(2000); monitor.markSwipe();
    run(2050, 3050);
    expect(lines.filter(line => line.includes('swipe_stall')).at(-1)).toBe('[BISECT] swipe_stall total_ms=0 count=0 flags=noRanking');
  });

  it('closes the previous swipe window early when a new swipe starts', () => {
    const { monitor, lines, tickAt, setNow } = harness();
    monitor.start();
    setNow(0); monitor.markSwipe();
    tickAt(300); // 250 late
    setNow(400); monitor.markSwipe();
    expect(lines.at(-1)).toBe('[BISECT] swipe_stall total_ms=250 count=1 flags=noRanking');
  });

  it('summarizes every 10 s: stall count, total ms and the longest stall', () => {
    const { monitor, lines, tickAt, run } = harness();
    monitor.start();
    tickAt(50); tickAt(300); // 200
    tickAt(350); tickAt(800); // 400
    run(850, 10_000);
    expect(lines.filter(line => line.includes('summary'))).toEqual(['[BISECT] summary window_s=10 stalls=2 total_ms=600 max_ms=400 flags=noRanking']);
    run(10_050, 20_000);
    expect(lines.filter(line => line.includes('summary')).at(-1)).toBe('[BISECT] summary window_s=10 stalls=0 total_ms=0 max_ms=0 flags=noRanking');
  });

  it('start returns a stop function and is idempotent', () => {
    const { monitor } = harness();
    const stop = monitor.start();
    expect(monitor.start()).toBe(stop);
    stop();
  });
});

describe('bisect flags switch off their subsystem only when set', () => {
  const original = process.env.EXPO_PUBLIC_PERF_BISECT;
  afterEach(() => {
    if (original === undefined) delete process.env.EXPO_PUBLIC_PERF_BISECT;
    else process.env.EXPO_PUBLIC_PERF_BISECT = original;
    jest.resetModules();
  });
  const load = <T,>(flags: string | undefined, path: string): T => {
    if (flags === undefined) delete process.env.EXPO_PUBLIC_PERF_BISECT;
    else process.env.EXPO_PUBLIC_PERF_BISECT = flags;
    let module: T | undefined;
    jest.isolateModules(() => { module = require(path) as T; });
    return module!;
  };

  it('is off by default', () => {
    expect(load<typeof import('../lib/perfBisect')>(undefined, '../lib/perfBisect').perfBisect('noRanking')).toBe(false);
    expect(load<typeof import('../lib/perfBisect')>(undefined, '../lib/perfBisect').startPerfBisectMonitor()).toEqual(expect.any(Function));
  });

  it('noRanking: the recommendation packet loader returns without publishing or reading', async () => {
    const service = load<typeof import('../services/discoverRecommendationCacheService')>('noRanking', '../services/discoverRecommendationCacheService');
    const onPacket = jest.fn();
    await service.loadDiscoverRecommendationPacket({ sessionId: 's', generation: 1, contextFingerprint: 'c', candidatePool: [],
      anchors: [{ id: 'a' } as never], wardrobeItems: [], exposure: [], shownAnchorIds: [] }, null, new AbortController().signal, onPacket);
    expect(onPacket).not.toHaveBeenCalled();
  });

  it('noAnalytics: init does not read the queue from AsyncStorage and track enqueues nothing', async () => {
    process.env.EXPO_PUBLIC_PERF_BISECT = 'noAnalytics';
    let analytics: typeof import('../lib/analytics') | undefined;
    let storage: { getItem: (...args: unknown[]) => Promise<unknown>; setItem: (...args: unknown[]) => Promise<void> } | undefined;
    jest.isolateModules(() => {
      const mocked = require('@react-native-async-storage/async-storage');
      storage = mocked.default ?? mocked;
      analytics = require('../lib/analytics');
    });
    if (!analytics || !storage) throw new Error('analytics not loaded');
    const getItem = jest.spyOn(storage, 'getItem'), setItem = jest.spyOn(storage, 'setItem');
    analytics.initAnalytics();
    analytics.track('impression', 'p', {}, { actionId: 'a', userId: 'u', origin: 'pass', occurredAt: new Date(0).toISOString() });
    await analytics.flushAnalytics();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
});

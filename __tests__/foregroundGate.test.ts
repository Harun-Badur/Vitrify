import {
  FOREGROUND_BURST_MS,
  FOREGROUND_MAX_WAIT_MS,
  FOREGROUND_PRIORITY_MAX_WAIT_MS,
  foregroundBegin,
  foregroundEnd,
  foregroundSettle,
  isForegroundBusy,
  resetForegroundGate,
  waitForForeground,
} from '../lib/foregroundGate';
import { runCooperatively } from '../src/intelligence/cooperativeWork';

const settled = (promise: Promise<void>): { done: boolean } => {
  const state = { done: false };
  void promise.then(() => { state.done = true; });
  return state;
};
const flush = async (ms = 0): Promise<void> => { await jest.advanceTimersByTimeAsync(ms); };

describe('foreground gate (pause engine slices while the UI is busy)', () => {
  beforeEach(() => { jest.useFakeTimers(); resetForegroundGate(); });
  afterEach(() => { resetForegroundGate(); jest.useRealTimers(); });

  it('never delays work while nothing is happening in the foreground', async () => {
    const timers = jest.getTimerCount();
    const state = settled(waitForForeground());
    await flush(0);
    expect(state.done).toBe(true);
    expect(jest.getTimerCount()).toBe(timers);
    expect(isForegroundBusy()).toBe(false);
  });

  it('holds work during a touch and releases it after the settle window', async () => {
    foregroundBegin();
    const state = settled(waitForForeground());
    await flush(300);
    expect(state.done).toBe(false);
    foregroundEnd(100);
    await flush(60);
    expect(state.done).toBe(false);
    await flush(100);
    expect(state.done).toBe(true);
  });

  it('settle extends the busy window and never shortens it', async () => {
    foregroundSettle(300);
    foregroundSettle(50);
    const state = settled(waitForForeground());
    await flush(200);
    expect(state.done).toBe(false);
    await flush(150);
    expect(state.done).toBe(true);
  });

  it('starvation guard: continuous activity delays work by at most ~400 ms, then a burst may run', async () => {
    foregroundBegin();
    const first = settled(waitForForeground());
    await flush(FOREGROUND_MAX_WAIT_MS - 20);
    expect(first.done).toBe(false);
    await flush(60);
    expect(first.done).toBe(true);
    // The released engine keeps going for a short burst instead of re-waiting 400 ms per 4 ms slice.
    const during = settled(waitForForeground());
    await flush(0);
    expect(during.done).toBe(true);
    await flush(FOREGROUND_BURST_MS + 20);
    const after = settled(waitForForeground());
    await flush(FOREGROUND_MAX_WAIT_MS - 20);
    expect(after.done).toBe(false);
    await flush(60);
    expect(after.done).toBe(true);
  });

  it('keeps total progress under constant swiping: at least one burst per cap window', async () => {
    foregroundBegin();
    let slices = 0;
    const engine = (async () => {
      for (let i = 0; i < 40; i++) { await waitForForeground(); slices++; await new Promise(resolve => setTimeout(resolve, 4)); }
    })();
    await flush(2_000);
    foregroundEnd(0);
    await flush(1_000);
    await engine;
    expect(slices).toBe(40);
  });

  it('priority work (current/next anchor) waits at most the shorter cap', async () => {
    foregroundBegin();
    const state = settled(waitForForeground(undefined, FOREGROUND_PRIORITY_MAX_WAIT_MS));
    await flush(FOREGROUND_PRIORITY_MAX_WAIT_MS - 20);
    expect(state.done).toBe(false);
    await flush(60);
    expect(state.done).toBe(true);
  });

  it('a touch whose end never arrives cannot hold the engine forever', async () => {
    foregroundBegin();
    await flush(6_000);
    expect(isForegroundBusy()).toBe(false);
    const state = settled(waitForForeground());
    await flush(0);
    expect(state.done).toBe(true);
  });

  it('releases immediately on abort and leaves no timer behind', async () => {
    foregroundBegin();
    const controller = new AbortController();
    const state = settled(waitForForeground(controller.signal));
    await flush(50);
    expect(state.done).toBe(false);
    controller.abort();
    await flush(0);
    expect(state.done).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('is transparent to cooperative work: same result, only later', async () => {
    function* work(): Generator<void, number, void> { let sum = 0; for (let i = 0; i < 50; i++) { sum += i; yield; } return sum; }
    let immediate: number | undefined;
    void runCooperatively(work(), { budgetMs: 1_000_000 }).then(value => { immediate = value; });
    await flush(100);
    expect(immediate).toBe(1225);
    foregroundBegin();
    let gated: number | undefined;
    void runCooperatively(work(), { budgetMs: 1_000_000, waitForTurn: () => waitForForeground() }).then(value => { gated = value; });
    await flush(100);
    expect(gated).toBeUndefined();
    foregroundEnd(0);
    await flush(100);
    expect(gated).toBe(immediate);
  });
});

describe('foreground gate wiring', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const read = (file: string): string => require('fs').readFileSync(require('path').join(__dirname, '..', file), 'utf8');

  it('the card pan gesture marks begin/finalize and pass/undo settle the render window', () => {
    const source = read('components/SwipeCard.tsx');
    expect(source).toMatch(/\.onBegin\(\(\) => \{\s*runOnJS\(foregroundBegin\)\(\);/);
    expect(source).toMatch(/\.onFinalize\(\(\) => \{\s*runOnJS\(foregroundEnd\)\(FOREGROUND_SWIPE_SETTLE_MS\);/);
    expect(source.match(/foregroundSettle\(FOREGROUND_RENDER_SETTLE_MS\)/g)).toHaveLength(2);
  });

  it('only the ranking and selection stages yield; the catalog stage and the scheduler stay untouched', () => {
    const service = read('services/discoverRecommendationCacheService.ts');
    expect(service.match(/waitForForeground\(/g)).toHaveLength(2);
    expect(service).toMatch(/waitForForeground\(rankingSignal, foregroundCap\(product\)\)/);
    expect(service).toMatch(/waitForForeground\(controller\.signal, foregroundCap\(product\)\)/);
    expect(read('src/intelligence/cooperativeWork.ts')).not.toMatch(/foregroundGate/);
    expect(read('services/productService.ts')).not.toMatch(/foregroundGate/);
  });
});

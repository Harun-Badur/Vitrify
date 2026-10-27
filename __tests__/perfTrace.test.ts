import {
  PERF_TRACE_CAPACITY,
  begin,
  formatPerfSummary,
  logPerfSummary,
  mark,
  perfTraceEntries,
  perfTraceEnabled,
  recordMs,
  resetPerfTrace,
  setPerfTraceOverrideForTests,
  span,
  startLongTaskWatch,
  stopLongTaskWatch,
  summarizePerfTrace,
} from '../lib/perfTrace';

const scriptedNow = (...values: number[]) => {
  const spy = jest.spyOn(performance, 'now');
  for (const value of values) spy.mockReturnValueOnce(value);
  return spy;
};

beforeEach(() => {
  resetPerfTrace();
  setPerfTraceOverrideForTests(true);
});
afterEach(() => {
  stopLongTaskWatch();
  setPerfTraceOverrideForTests(null);
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('flag', () => {
  it('follows the override, then falls back to __DEV__ or EXPO_PUBLIC_PERF_TRACE', () => {
    setPerfTraceOverrideForTests(false);
    expect(perfTraceEnabled()).toBe(false);
    setPerfTraceOverrideForTests(true);
    expect(perfTraceEnabled()).toBe(true);
    setPerfTraceOverrideForTests(null);
    expect(typeof perfTraceEnabled()).toBe('boolean');
  });

  it('costs nothing and records nothing while disabled', () => {
    setPerfTraceOverrideForTests(false);
    const now = jest.spyOn(performance, 'now');
    const timers = jest.spyOn(global, 'setTimeout');
    now.mockClear();
    timers.mockClear();
    expect(span('feed_fetch_total', () => 42)).toBe(42);
    expect(begin('combo_compute')).toBe(begin('feed_edge_rank'));
    begin('combo_compute')();
    mark('cache_read_timeout');
    recordMs('js_long_task', 80);
    startLongTaskWatch();
    expect(now).not.toHaveBeenCalled();
    expect(timers).not.toHaveBeenCalled();
    expect(perfTraceEntries()).toEqual([]);
    expect(summarizePerfTrace()).toEqual([]);
    expect(logPerfSummary()).toBe('');
  });

  it('still returns or throws what the wrapped work does while disabled', async () => {
    setPerfTraceOverrideForTests(false);
    await expect(span('feed_fetch_total', async () => 'ok')).resolves.toBe('ok');
    expect(() => span('feed_fetch_total', () => { throw new Error('boom'); })).toThrow('boom');
  });
});

describe('measuring', () => {
  it('span records the elapsed milliseconds of synchronous work and returns its value', () => {
    scriptedNow(100, 142.5);
    expect(span('feed_local_rank', () => 'ranked')).toBe('ranked');
    expect(perfTraceEntries()).toMatchObject([{ label: 'feed_local_rank', ms: 42.5 }]);
  });

  it('span records async work after it settles, including rejections', async () => {
    scriptedNow(10, 70, 100, 130);
    await expect(span('feed_edge_rank', async () => 'edge')).resolves.toBe('edge');
    await expect(span('feed_edge_rank', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    expect(perfTraceEntries().map(entry => [entry.label, entry.ms])).toEqual([['feed_edge_rank', 60], ['feed_edge_rank', 30]]);
  });

  it('begin returns an end function that records once', () => {
    scriptedNow(5, 25);
    const end = begin('combo_compute');
    end();
    end();
    expect(perfTraceEntries()).toMatchObject([{ label: 'combo_compute', ms: 20 }]);
  });

  it('mark records a counted zero-duration event', () => {
    mark('cache_read_timeout');
    mark('cache_read_timeout');
    expect(summarizePerfTrace()).toEqual([{ label: 'cache_read_timeout', n: 2, medianMs: 0, p95Ms: 0, maxMs: 0 }]);
  });
});

describe('summary', () => {
  it('reports n, median, p95 and max per label with an odd and an even sample', () => {
    for (const ms of [10, 20, 30, 40, 50]) recordMs('feed_fetch_total', ms);
    for (const ms of [1, 2, 3, 4]) recordMs('cache_read', ms);
    const rows = summarizePerfTrace();
    expect(rows.find(row => row.label === 'feed_fetch_total')).toEqual({ label: 'feed_fetch_total', n: 5, medianMs: 30, p95Ms: 50, maxMs: 50 });
    expect(rows.find(row => row.label === 'cache_read')).toEqual({ label: 'cache_read', n: 4, medianMs: 2.5, p95Ms: 4, maxMs: 4 });
  });

  it('uses nearest-rank p95 over 100 samples', () => {
    for (let ms = 1; ms <= 100; ms++) recordMs('combo_compute', ms);
    expect(summarizePerfTrace()[0]).toMatchObject({ n: 100, medianMs: 50.5, p95Ms: 95, maxMs: 100 });
  });

  it('renders one readable line per label and logs the same text', () => {
    recordMs('feed_fetch_total', 120);
    const text = formatPerfSummary(summarizePerfTrace());
    expect(text).toBe('feed_fetch_total n=1 med=120 p95=120 max=120');
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    expect(logPerfSummary()).toBe(text);
    expect(info).toHaveBeenCalledTimes(1);
  });
});

describe('ring buffer', () => {
  it('keeps only the newest entries', () => {
    for (let index = 0; index < PERF_TRACE_CAPACITY + 100; index++) recordMs('feed_fetch_total', index);
    const entries = perfTraceEntries();
    expect(entries).toHaveLength(PERF_TRACE_CAPACITY);
    expect(entries[0].ms).toBe(100);
    expect(entries[entries.length - 1].ms).toBe(PERF_TRACE_CAPACITY + 99);
    expect(summarizePerfTrace()[0].n).toBe(PERF_TRACE_CAPACITY);
  });
});

describe('privacy', () => {
  it('stores only a fixed label, a duration and a time, and drops any other label', () => {
    // A caller cannot smuggle an identifier or product name in through the label.
    (recordMs as (label: string, ms: number) => void)('user-1234-product-Siyah-Gomlek', 5);
    (mark as (label: string) => void)('title: Lacivert gömlek');
    recordMs('feed_fetch_total', 5);
    const entries = perfTraceEntries();
    expect(entries).toHaveLength(1);
    expect(Object.keys(entries[0]).sort()).toEqual(['at', 'label', 'ms']);
    expect(JSON.stringify(entries) + formatPerfSummary(summarizePerfTrace())).not.toMatch(/user|product|Siyah|gömlek/i);
  });

  it('ignores non-finite durations', () => {
    recordMs('feed_fetch_total', Number.NaN);
    recordMs('feed_fetch_total', Number.POSITIVE_INFINITY);
    expect(perfTraceEntries()).toEqual([]);
  });
});

describe('long task watch (timer drift)', () => {
  it('records drift above 50 ms, once per watch, and stops cleanly', () => {
    jest.useFakeTimers();
    // start, tick on time, tick 200 ms late, tick 30 ms late (below threshold).
    scriptedNow(1000, 1050, 1300, 1380);
    startLongTaskWatch();
    startLongTaskWatch();
    jest.advanceTimersByTime(50);
    jest.advanceTimersByTime(50);
    jest.advanceTimersByTime(50);
    expect(perfTraceEntries().map(entry => [entry.label, entry.ms])).toEqual([['js_long_task', 200]]);
    stopLongTaskWatch();
    expect(jest.getTimerCount()).toBe(0);
  });
});

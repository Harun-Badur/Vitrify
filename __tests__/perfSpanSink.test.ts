import { perfGenderLabel, perfLog, perfMarkSwipe, perfNow, perfSetSpanSink, perfTakeSwipe } from '../lib/perfLog';

describe('perf span sink (Sentry bridge)', () => {
  const g = global as { __DEV__?: boolean };
  const originalDev = g.__DEV__;
  const originalFlag = process.env.EXPO_PUBLIC_PERF_LOG;
  beforeEach(() => {
    g.__DEV__ = false;
    delete process.env.EXPO_PUBLIC_PERF_LOG;
  });
  afterEach(() => {
    perfSetSpanSink(null);
    g.__DEV__ = originalDev;
    if (originalFlag === undefined) delete process.env.EXPO_PUBLIC_PERF_LOG;
    else process.env.EXPO_PUBLIC_PERF_LOG = originalFlag;
    jest.restoreAllMocks();
  });

  it('does nothing without a sink: no console output and no timing', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    perfLog('feed_call', { ms: 5, n: 3 });
    perfMarkSwipe();
    expect(log).not.toHaveBeenCalled();
    expect(perfNow()).toBe(0);
    expect(perfTakeSwipe()).toBeNull();
  });

  it('forwards only the four mapped tags, with whitelisted attributes, without printing [PERF]', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const sink = jest.fn();
    perfSetSpanSink(sink);
    perfLog('feed_call', { ms: 12.4, n: 20, userId: 'secret' });
    perfLog('deck_refresh', { ms: 30, n: 5 });
    perfLog('rec_ranking_prepare', { ms: 8, gender: 'kadin' });
    perfLog('swipe_to_next_image', { ms: 40, cached: true, r_card: 3 });
    perfLog('nav_to_render', { ms: 99 });
    expect(sink.mock.calls).toEqual([
      ['feed_call', 12.4, { n: 20 }],
      ['deck_refresh', 30, { n: 5 }],
      ['rec_ranking_prepare', 8, { gender: 'kadin' }],
      ['swipe_to_next', 40, { cached: true }],
    ]);
    expect(log).not.toHaveBeenCalled();
  });

  it('keeps [PERF] logs unchanged when the log flag is on and a sink exists', () => {
    process.env.EXPO_PUBLIC_PERF_LOG = '1';
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    perfSetSpanSink(jest.fn());
    perfLog('feed_call', { ms: 7, n: 2 });
    expect(log).toHaveBeenCalledWith('[PERF] feed_call ms=7 n=2');
  });

  it('measures time while a sink is installed even with logging off', () => {
    perfSetSpanSink(jest.fn());
    expect(perfNow()).toBeGreaterThan(0);
    perfMarkSwipe();
    expect(perfTakeSwipe()).toEqual(expect.any(Number));
  });

  it('a throwing sink cannot fail work', () => {
    perfSetSpanSink(() => { throw new Error('boom'); });
    expect(() => perfLog('feed_call', { ms: 1, n: 1 })).not.toThrow();
  });

  it('maps product preference to a closed gender label', () => {
    expect(perfGenderLabel('kadin')).toBe('kadin');
    expect(perfGenderLabel('erkek')).toBe('erkek');
    expect(perfGenderLabel('hepsi')).toBe('tumu');
    expect(perfGenderLabel(null)).toBe('tumu');
  });
});

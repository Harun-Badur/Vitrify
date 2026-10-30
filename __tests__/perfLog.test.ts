import { formatPerfLine, perfLog, perfMarkSwipe, perfTakeSwipe, perfNow } from '../lib/perfLog';

describe('perfLog', () => {
  const original = (global as { __DEV__?: boolean }).__DEV__;
  afterEach(() => {
    (global as { __DEV__?: boolean }).__DEV__ = original;
    jest.restoreAllMocks();
  });

  it('formats a single [PERF] line with sorted-free key=value fields', () => {
    expect(formatPerfLine('recs_feed', { ms: 12.34, n: 5, tab: 'personal' })).toBe(
      '[PERF] recs_feed ms=12 n=5 tab=personal',
    );
  });

  it('logs once per call in dev', () => {
    (global as { __DEV__?: boolean }).__DEV__ = true;
    const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    perfLog('refresh', { ms: 3 });
    expect(spy).toHaveBeenCalledWith('[PERF] refresh ms=3');
  });

  it('is silent and returns 0 outside dev', () => {
    (global as { __DEV__?: boolean }).__DEV__ = false;
    const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    perfLog('refresh', { ms: 3 });
    perfMarkSwipe();
    expect(spy).not.toHaveBeenCalled();
    expect(perfNow()).toBe(0);
    expect(perfTakeSwipe()).toBeNull();
  });

  it('measures a swipe once', () => {
    (global as { __DEV__?: boolean }).__DEV__ = true;
    perfMarkSwipe();
    expect(perfTakeSwipe()).toEqual(expect.any(Number));
    expect(perfTakeSwipe()).toBeNull();
  });
});

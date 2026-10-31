import { formatPerfLine, perfLog, perfMarkSwipe, perfPeekSwipe, perfRouteLabel, perfTakeSwipe, perfNow } from '../lib/perfLog';

describe('perfLog', () => {
  const original = (global as { __DEV__?: boolean }).__DEV__;
  const originalFlag = process.env.EXPO_PUBLIC_PERF_LOG;
  afterEach(() => {
    if (originalFlag === undefined) delete process.env.EXPO_PUBLIC_PERF_LOG;
    else process.env.EXPO_PUBLIC_PERF_LOG = originalFlag;
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

  it('logs outside dev only when EXPO_PUBLIC_PERF_LOG is 1', () => {
    (global as { __DEV__?: boolean }).__DEV__ = false;
    const spy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    process.env.EXPO_PUBLIC_PERF_LOG = '0';
    perfLog('refresh', { ms: 3 });
    expect(spy).not.toHaveBeenCalled();
    process.env.EXPO_PUBLIC_PERF_LOG = '1';
    perfLog('refresh', { ms: 3 });
    perfMarkSwipe();
    expect(spy).toHaveBeenCalledWith('[PERF] refresh ms=3');
    expect(perfPeekSwipe()).toEqual(expect.any(Number));
    expect(perfTakeSwipe()).toEqual(expect.any(Number));
  });

  it('measures a swipe once', () => {
    (global as { __DEV__?: boolean }).__DEV__ = true;
    perfMarkSwipe();
    expect(perfTakeSwipe()).toEqual(expect.any(Number));
    expect(perfTakeSwipe()).toBeNull();
  });

  it('maps pathnames to closed route labels without ids', () => {
    expect(perfRouteLabel('/')).toBe('discover');
    expect(perfRouteLabel('/liked')).toBe('favoriler');
    expect(perfRouteLabel('/profile')).toBe('profil');
    expect(perfRouteLabel('/wardrobe/create')).toBe('outfit_olustur');
    expect(perfRouteLabel('/wardrobe/clothes')).toBe('dolap');
    expect(perfRouteLabel('/something/abc-123')).toBe('diger');
  });
});

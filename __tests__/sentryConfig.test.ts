const mockSentry = {
  init: jest.fn(),
  setTags: jest.fn(),
  setUser: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  startInactiveSpan: jest.fn(() => ({ end: jest.fn() })),
  reactNavigationIntegration: jest.fn(() => ({ name: 'nav', registerNavigationContainer: jest.fn() })),
};
jest.mock('@sentry/react-native', () => mockSentry);
jest.mock('expo-device', () => ({ modelName: 'Pixel 7', osVersion: '14', totalMemory: 8 * 1024 ** 3 }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.0.0', android: { versionCode: 3 } } },
  ExecutionEnvironment: { StoreClient: 'storeClient' },
}));

const g = global as { __DEV__?: boolean };
const originalDev = g.__DEV__;
const originalDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

const load = (): typeof import('../lib/sentry') => {
  let mod!: typeof import('../lib/sentry');
  jest.isolateModules(() => { mod = require('../lib/sentry'); });
  return mod;
};

beforeEach(() => {
  jest.clearAllMocks();
  g.__DEV__ = false;
  process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://public@o0.ingest.sentry.io/1';
});
afterAll(() => {
  g.__DEV__ = originalDev;
  if (originalDsn === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  else process.env.EXPO_PUBLIC_SENTRY_DSN = originalDsn;
});

describe('Sentry kapalıyken', () => {
  it.each([
    ['DSN yok', () => { delete process.env.EXPO_PUBLIC_SENTRY_DSN; }],
    ['DSN boş', () => { process.env.EXPO_PUBLIC_SENTRY_DSN = '   '; }],
    ['geliştirme', () => { g.__DEV__ = true; }],
  ])('%s: hiçbir şey başlatılmaz veya gönderilmez', (_label, arrange) => {
    arrange();
    const mod = load();
    mod.captureLoggedError('x', { a: 1 });
    mod.captureUnhandledError(new Error('x'));
    mod.captureFeedTimeout(12000);
    mod.registerSentryNavigation({} as never);
    expect(mod.isSentryEnabled()).toBe(false);
    expect(mockSentry.init).not.toHaveBeenCalled();
    expect(mockSentry.captureException).not.toHaveBeenCalled();
    expect(mockSentry.captureMessage).not.toHaveBeenCalled();
    expect(mockSentry.setTags).not.toHaveBeenCalled();
  });
});

describe('Sentry açıkken', () => {
  it('güvenli seçeneklerle başlar', () => {
    const mod = load();
    expect(mockSentry.init).toHaveBeenCalledTimes(1);
    const options = (mockSentry.init.mock.calls[0] as unknown as [Record<string, any>])[0];
    expect(options.dsn).toBe('https://public@o0.ingest.sentry.io/1');
    expect(options.sendDefaultPii).toBe(false);
    expect(options.tracesSampleRate).toBeGreaterThanOrEqual(0.1);
    expect(options.tracesSampleRate).toBeLessThanOrEqual(0.2);
    expect(mod.TRACES_SAMPLE_RATE).toBe(options.tracesSampleRate);
    expect(options.enableNativeFramesTracking).toBe(true);
    expect(options.enableAppStartTracking).toBe(true);
    expect(typeof options.beforeSend).toBe('function');
    expect(typeof options.beforeSendTransaction).toBe('function');
    expect(typeof options.beforeBreadcrumb).toBe('function');
    expect(options.beforeBreadcrumb({ category: 'console', message: 'a@b.com' })).toBeNull();
    expect(options.beforeSend({ user: { id: 'u', email: 'a@b.com' } }).user).toEqual({ id: 'u' });
  });

  it('cihaz etiketlerini ayarlar', () => {
    load();
    expect(mockSentry.setTags).toHaveBeenCalledWith({
      device_model: 'Pixel 7',
      android_version: '14',
      ram_class: 'yuksek',
      app_version: '1.0.0',
      version_code: '3',
    });
  });

  it('feed zaman aşımını kişisel veri olmadan bildirir', () => {
    const mod = load();
    mod.captureFeedTimeout(12000);
    expect(mockSentry.captureMessage).toHaveBeenCalledWith('feed_timeout', {
      level: 'warning',
      tags: { feed: 'timeout' },
      extra: { ms: 12000 },
    });
  });

  it('oturum örneklemesi tek karardır: örneklenmeyen 0, örneklenen 1', () => {
    const random = jest.spyOn(Math, 'random').mockReturnValue(0.99);
    load();
    const first = (mockSentry.init.mock.calls[0] as unknown as [Record<string, any>])[0];
    expect(first.tracesSampler()).toBe(0);
    random.mockReturnValue(0.01);
    load();
    const second = (mockSentry.init.mock.calls[1] as unknown as [Record<string, any>])[0];
    expect(second.tracesSampler()).toBe(1);
    random.mockRestore();
  });
});

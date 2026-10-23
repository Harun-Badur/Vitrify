let mockConfigured = false;
const mockSdk = {
  setLogHandler: jest.fn(),
  isConfigured: jest.fn(async () => mockConfigured),
  configure: jest.fn(() => {
    mockConfigured = true;
  }),
  getCustomerInfo: jest.fn(async () => ({
    originalAppUserId:'opaque',
    managementURL: 'https://evil.invalid',
    entitlements: { active: { untrusted: true } },
  })),
  getAppUserID: jest.fn(async () => 'opaque'),
  logIn: jest.fn(async () => undefined),
  logOut: jest.fn(async () => undefined),
  isAnonymous: jest.fn(async () => false),
  getOfferings: jest.fn(),
  purchasePackage: jest.fn(async () => ({
    customerInfo: { entitlements: { active: { untrusted: true } } },
  })),
  restorePurchases: jest.fn(async () => ({})),
};
const mockOpen = jest.fn();
const mockConstants = { appOwnership: 'standalone' };
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Linking: { openURL: mockOpen },
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: mockConstants,
}));
jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: mockSdk,
}));
jest.mock('../lib/supabase', () => ({
  getSupabaseClient: () => ({
    auth: {
      getSession: async () => ({
        data: {
          session: { user: { id: 'owner' }, access_token: 'fixture-jwt' },
        },
        error: null,
      }),
    },
  }),
}));
const pack = () => ({
  identifier: 'store-package',
  packageType: 'MONTHLY',
  product: {
    identifier: 'fixture-month',
    introPrice: null,
    defaultOption: null,
    subscriptionPeriod: 'P1M',
    priceString: 'localized-store-price',
  },
});
const envNames = [
  'EXPO_PUBLIC_PREMIUM_ENABLED',
  'EXPO_PUBLIC_REVENUECAT_IOS_KEY',
  'EXPO_PUBLIC_PREMIUM_TERMS_URL',
  'EXPO_PUBLIC_PREMIUM_SUPPORT_URL',
  'EXPO_PUBLIC_SUPABASE_URL',
];
let previous: Record<string, string | undefined>;
const originalFetch = global.fetch;
describe('native RevenueCat adapter', () => {
  it('does not connect SDK until the backend confirms the non-transfer restore setup', async () => {
    global.fetch = jest.fn(
      async () =>
        new Response(
          JSON.stringify({ appUserId: 'opaque', sdkAllowed: false }),
          { status: 200 },
        ),
    ) as any;
    const { premiumClient } = jest.requireActual(
      '../services/revenueCatMobile',
    ) as typeof import('../services/revenueCatMobile');
    await premiumClient.setOwner('owner');
    expect(mockSdk.configure).not.toHaveBeenCalled();
    expect(premiumClient.getSnapshot().membership).toBeNull();
  });
  beforeEach(() => {
    mockConfigured = false;
    jest.resetModules();
    jest.clearAllMocks();
    previous = Object.fromEntries(
      envNames.map((key) => [key, process.env[key]]),
    );
    process.env.EXPO_PUBLIC_PREMIUM_ENABLED = 'true';
    process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_fixture';
    process.env.EXPO_PUBLIC_PREMIUM_TERMS_URL = 'https://fixture.invalid/terms';
    process.env.EXPO_PUBLIC_PREMIUM_SUPPORT_URL =
      'https://fixture.invalid/support';
    process.env.EXPO_PUBLIC_SUPABASE_URL =
      'https://abcdefghijklmnopqrst.supabase.co';
    mockConstants.appOwnership = 'standalone';
    mockSdk.getOfferings.mockResolvedValue({
      current: { availablePackages: [pack()] },
    });
    global.fetch = jest.fn(
      async (input: any) =>
        new Response(
          JSON.stringify(
            String(input).endsWith('/identity')
              ? { appUserId: 'opaque', sdkAllowed: true }
              : String(input).endsWith('/admit') ? {admitted:true} : {
                  tier: 'free',
                  expiresAtMs: null,
                  checkedAtMs: Date.now(),
                  quotaPolicyActive: true,
                  vtonDailyLimit: 3,
                  vtonMinuteLimit: 3,
                  storeProducts: {
                    app_store: ['fixture-month'],
                    play_store: [],
                  },
                },
          ),
          { status: 200 },
        ),
    ) as any;
  });
  afterEach(() => {
    for (const key of envNames) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    global.fetch = originalFetch;
  });
  it('configures the SDK with backend identity and forwards the real native package, never SDK entitlement', async () => {
    const { premiumClient } = jest.requireActual(
      '../services/revenueCatMobile',
    ) as typeof import('../services/revenueCatMobile');
    await premiumClient.setOwner('owner');
    expect(mockSdk.configure).toHaveBeenCalledWith({
      apiKey: 'appl_fixture',
      appUserID: 'opaque',
    });
    expect(premiumClient.getSnapshot().membership?.tier).toBe('free');
    expect(premiumClient.getSnapshot().packages[0].price).toBe(
      'localized-store-price',
    );
    await premiumClient.purchase('store-package');
    expect(mockSdk.purchasePackage).toHaveBeenCalledWith(pack());
    expect(premiumClient.getSnapshot().membership?.tier).toBe('free');
    await premiumClient.setOwner(null);
    expect(mockSdk.logOut).toHaveBeenCalled();
    expect(premiumClient.getSnapshot().membership).toBeNull();
  });
  it('does not import/configure preview purchases or call backend in Expo Go', async () => {
    mockConstants.appOwnership = 'expo';
    const { premiumClient } = jest.requireActual(
      '../services/revenueCatMobile',
    ) as typeof import('../services/revenueCatMobile');
    await premiumClient.setOwner('owner');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockSdk.configure).not.toHaveBeenCalled();
  });
  it('blocks native trial offers for the no-trial V1 model', async () => {
    const trial = {
      ...pack(),
      product: { ...pack().product, introPrice: { price: 0 } },
    };
    mockSdk.getOfferings.mockResolvedValue({
      current: { availablePackages: [trial] },
    });
    const { premiumClient } = jest.requireActual(
      '../services/revenueCatMobile',
    ) as typeof import('../services/revenueCatMobile');
    await premiumClient.setOwner('owner');
    expect(premiumClient.getSnapshot().packages).toEqual([]);
    await premiumClient.purchase('store-package');
    expect(mockSdk.purchasePackage).not.toHaveBeenCalled();
  });
  it('does not open arbitrary management URLs supplied by the SDK', async () => {
    const { premiumClient } = jest.requireActual(
      '../services/revenueCatMobile',
    ) as typeof import('../services/revenueCatMobile');
    await premiumClient.setOwner('owner');
    await premiumClient.manage();
    expect(mockOpen).not.toHaveBeenCalled();
  });
});

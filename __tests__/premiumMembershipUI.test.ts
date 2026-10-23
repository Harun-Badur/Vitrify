import { createElement } from 'react';
import PremiumMembership from '../components/PremiumMembership';
import type { PremiumClientState } from '../services/premiumClient';
jest.mock('lucide-react-native', () => ({ Crown: 'Crown', ChevronRight: 'ChevronRight', Sparkles: 'Sparkles' }));
const renderer = jest.requireActual('react-test-renderer') as any;
const mockClient = {
  refresh: jest.fn(async () => undefined),
  purchase: jest.fn(async () => undefined),
  restore: jest.fn(async () => undefined),
  manage: jest.fn(async () => undefined),
};
let mockState: PremiumClientState;
jest.mock('../hooks/usePremium', () => ({
  usePremium: () => ({ state: mockState, client: mockClient }),
}));
jest.mock('../services/revenueCatMobile', () => ({
  premiumLegalLinks: { terms: null, support: null },
}));
jest.mock('expo-router', () => ({ useFocusEffect: () => undefined }));
jest.mock('../components/ProfileSheet', () => ({
  __esModule: true,
  default: ({ children }: any) => children,
}));
describe('Premium profile and paywall', () => {
  beforeEach(() => {
    mockState = {
      owner: 'owner',
      membership: null,
      packages: [],
      configured: false,
      busy: false,
      awaitingVerification: false,
      message: null,
    };
    jest.clearAllMocks();
  });
  const mount = async () => {
    let tree: any;
    await renderer.act(async () => {
      tree = renderer.create(createElement(PremiumMembership));
    });
    return tree;
  };
  it('does not offer a purchase flow or fabricated quota without configuration', async () => {
    const tree = await mount();
    const buttons = tree.root.findAllByProps({
      accessibilityLabel: 'Premium aboneliği satın al',
    });
    expect(buttons).toHaveLength(0);
    const content = JSON.stringify(tree.toJSON());
    expect(content).not.toContain('Günlük sınır: 3');
    expect(content).not.toContain('Satın alımları geri yükle');
    expect(content).not.toContain('Aboneliği mağazada yönet');
    expect(content).not.toContain('otomatik yenilenir');
    expect(content).toContain('Premium satın alma henüz kullanıma hazır değil');
    await renderer.act(async () => tree.unmount());
  });
  it('displays actual monthly and annual store price strings and forwards selected package', async () => {
    mockState = {
      ...mockState,
      configured: true,
      membership: {
        tier: 'free',
        dailyLimit: 3,
        minuteLimit: 3,
        checkedAtMs: Date.now(),
        expiresAtMs: null,
        storeProducts: { app_store: ['month', 'year'], play_store: [] },
      },
      packages: [
        {
          id: 'm',
          productId: 'month',
          store: 'app_store',
          period: 'monthly',
          price: 'store-month-price',
        },
        {
          id: 'y',
          productId: 'year',
          store: 'app_store',
          period: 'annual',
          price: 'store-year-price',
        },
      ],
    };
    const tree = await mount();
    expect(JSON.stringify(tree.toJSON())).toContain('store-month-price');
    expect(JSON.stringify(tree.toJSON())).toContain('store-year-price');
    await renderer.act(async () =>
      tree.root
        .findAllByProps({ accessibilityRole: 'radio' })
        .filter((node: any) => typeof node.props.onPress === 'function')[1]
        .props.onPress(),
    );
    await renderer.act(async () =>
      tree.root
        .findAllByProps({ accessibilityLabel: 'Premium aboneliği satın al' })[0]
        .props.onPress(),
    );
    expect(mockClient.purchase).toHaveBeenCalledWith('y');
    await renderer.act(async () => tree.unmount());
  });
});

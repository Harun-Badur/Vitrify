import {
  createPremiumClient,
  parseVerifiedMembership,
  type PremiumClientPorts,
} from '../services/premiumClient';

const status = (tier: 'free' | 'premium' = 'free') => ({
  tier,
  expiresAtMs: tier === 'premium' ? Date.now() + 3600000 : null,
  checkedAtMs: Date.now(),
  vtonDailyLimit: tier === 'premium' ? 20 : 3,
  vtonMinuteLimit: 3,
  quotaPolicyActive: true,
  storeProducts: { app_store: ['monthly'], play_store: ['yearly'] },
});
function fixture() {
  const ports: PremiumClientPorts = {
    configured: () => true,
    identity: jest.fn(async () => 'opaque'),
    connect: jest.fn(async () => undefined),
    disconnect: jest.fn(async () => undefined),
    verify: jest.fn(async () => parseVerifiedMembership(status())),
    packages: jest.fn(async () => [
      {
        id: 'native-monthly',
        productId: 'monthly',
        store: 'app_store' as const,
        period: 'monthly' as const,
        price: 'store-price',
      },
    ]),
    purchase: jest.fn(async () => undefined),
    restore: jest.fn(async () => undefined),
    management: jest.fn(
      async () => 'https://apps.apple.com/account/subscriptions/',
    ),
    open: jest.fn(async () => undefined),
  };
  return { ports, client: createPremiumClient(ports) };
}
describe('Premium client owner and payment boundaries', () => {
  it('can defer SDK startup until the profile is opened', async () => {
    const { ports, client } = fixture();
    await client.setOwner('a', false);
    expect(ports.identity).not.toHaveBeenCalled();
    expect(ports.connect).not.toHaveBeenCalled();
    await client.refresh();
    expect(ports.connect).toHaveBeenCalledWith('opaque');
  });
  it('does no SDK or backend work when configuration is absent', async () => {
    const { ports, client } = fixture();
    (ports.configured as any) = () => false;
    await client.setOwner('a');
    expect(ports.identity).not.toHaveBeenCalled();
    expect(client.getSnapshot().membership).toBeNull();
  });
  it('loads server identity before connecting and displays only backend quota', async () => {
    const { ports, client } = fixture();
    await client.setOwner('a');
    expect(ports.connect).toHaveBeenCalledWith('opaque');
    expect(client.getSnapshot().membership?.dailyLimit).toBe(3);
  });
  it('does not infer Premium or purchase success if backend fails after store purchase', async () => {
    const { ports, client } = fixture();
    await client.setOwner('a');
    (ports.verify as jest.Mock).mockRejectedValue(new Error('private error'));
    await client.purchase('native-monthly');
    expect(client.getSnapshot().membership).toBeNull();
    expect(client.getSnapshot().awaitingVerification).toBe(true);
    expect(client.getSnapshot().message).not.toContain('private error');
    await client.purchase('native-monthly');
    expect(ports.purchase).toHaveBeenCalledTimes(1);
  });
  it('prevents double taps and never uses a package not returned by the store', async () => {
    const { ports, client } = fixture();
    await client.setOwner('a');
    await client.purchase('invented');
    expect(ports.purchase).not.toHaveBeenCalled();
    await Promise.all([
      client.purchase('native-monthly'),
      client.purchase('native-monthly'),
    ]);
    expect(ports.purchase).toHaveBeenCalledTimes(1);
  });
  it('does not offer a store package that the backend product allowlist would reject after payment', async () => {
    const { ports, client } = fixture();
    (ports.packages as jest.Mock).mockResolvedValue([
      {
        id: 'unapproved',
        productId: 'foreign-product',
        store: 'app_store',
        period: 'monthly',
        price: 'store-price',
      },
    ]);
    await client.setOwner('a');
    await client.purchase('unapproved');
    expect(client.getSnapshot().packages).toEqual([]);
    expect(ports.purchase).not.toHaveBeenCalled();
  });
  it('treats cancellation without a success or entitlement grant', async () => {
    const { ports, client } = fixture();
    await client.setOwner('a');
    (ports.purchase as jest.Mock).mockRejectedValue({ userCancelled: true });
    await client.purchase('native-monthly');
    expect(client.getSnapshot().membership?.tier).toBe('free');
    expect(client.getSnapshot().message).toBe('Satın alma iptal edildi.');
  });
  it('clears immediately and discards an old purchase result on owner switch', async () => {
    const { ports, client } = fixture();
    await client.setOwner('a');
    let finish!: () => void;
    (ports.purchase as jest.Mock).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const purchase = client.purchase('native-monthly');
    await Promise.resolve();
    await Promise.resolve();
    const switching = client.setOwner('b');
    expect(client.getSnapshot().owner).toBe('b');
    expect(client.getSnapshot().membership).toBeNull();
    finish();
    await purchase;
    await switching;
    expect(client.getSnapshot().membership?.tier).toBe('free');
    await client.setOwner(null);
    expect(client.getSnapshot().membership).toBeNull();
    expect(ports.disconnect).toHaveBeenCalled();
  });
  it('verifies restore on the backend and never trusts SDK customer info', async () => {
    const { ports, client } = fixture();
    await client.setOwner('a');
    (ports.verify as jest.Mock).mockResolvedValue(
      parseVerifiedMembership(status('premium')),
    );
    await client.restore();
    expect(client.getSnapshot().membership?.tier).toBe('premium');
    expect(ports.verify).toHaveBeenCalledTimes(2);
  });
  it('blocks purchase after backend validity expires', async () => {
    const { ports, client } = fixture();
    await client.setOwner('a');
    client.invalidate();
    await client.purchase('native-monthly');
    expect(ports.purchase).not.toHaveBeenCalled();
  });
});
describe('server membership presentation contract', () => {
  it('does not display the planned quota if the new backend path is disabled', () => {
    expect(
      parseVerifiedMembership({
        ...status(),
        quotaPolicyActive: false,
        vtonDailyLimit: null,
        vtonMinuteLimit: null,
      }).dailyLimit,
    ).toBeNull();
  });
  it.each([
    { isPremium: true },
    { ...status(), checkedAtMs: 0 },
    { ...status('premium'), expiresAtMs: 0 },
    { ...status(), vtonDailyLimit: 20 },
  ])('rejects malformed, stale or inconsistent evidence', (value) => {
    expect(() => parseVerifiedMembership(value)).toThrow();
  });
});

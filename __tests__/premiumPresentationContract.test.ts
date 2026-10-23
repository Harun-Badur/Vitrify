import { handleMembershipRequest } from '../supabase/functions/_shared/premiumBackend';
describe('membership UI server contract', () => {
  it('does not authorize SDK bootstrap until original-owner restore policy is confirmed', async () => {
    const config = {
      apiKey: 'fixture',
      entitlement: 'fixture',
      products: { app_store: ['m'], play_store: ['y'] },
      sandbox: true,
      webhookAuthorization: 'fixture',
    };
    const ports = {
      admit:async()=>true,authenticate: async () => 'owner',
      binding: async () => 'opaque',
      ownerForBinding: async () => null,
      verify: jest.fn(),
      persist: jest.fn(),
    };
    const request = () =>
      new Request('https://fixture/identity', { method: 'POST' });
    const blocked = await handleMembershipRequest(
      request(),
      ports,
      config,
      false,
      true,
    );
    expect((await blocked.json()).sdkAllowed).toBe(false);
    const allowed = await handleMembershipRequest(
      request(),
      ports,
        { ...config, restorePolicy: 'KEEP_ORIGINAL',a1Ready:true },
      false,
      true,
    );
    expect((await allowed.json()).sdkAllowed).toBe(true);
    expect(ports.verify).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'exposes only explicitly activated quota and server product allowlist: %s',
    async (active) => {
      const config = {
        apiKey: 'fixture',
        entitlement: 'fixture',
        products: {
          app_store: ['fixture-month'],
          play_store: ['fixture-year'],
        },
        sandbox: true,
        webhookAuthorization: 'fixture',
      };
      const ports = {
        admit:async()=>true,authenticate: async () => 'owner',
        binding: async () => 'opaque',
        ownerForBinding: async () => null,
        verify: async () => ({
          tier: 'free' as const,
          expiresAtMs: null,
          sourceMs: Date.now(),
          transaction: null,
          store: null,
        }),
        persist: async () => true,
      };
      const response = await handleMembershipRequest(
        new Request('https://fixture/', { method: 'POST' }),
        ports,
        config,
        false,
        false,
        active,
      );
      const data = await response.json();
      expect(data.vtonDailyLimit).toBe(active ? 3 : null);
      expect(data.vtonMinuteLimit).toBe(active ? 3 : null);
      expect(data.storeProducts).toEqual(config.products);
    },
  );
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createPremiumClient,
  parseVerifiedMembership,
  type PremiumClientPorts,
} from '../services/premiumClient';
import {
  createPremiumA1Lifecycle,
  dispatchPremiumUnderGuard,
} from '../services/premiumA1Lifecycle';
import {
  fenceAccountWrites,
  resetAccountWriteFenceMemoryForTests,
} from '../lib/accountWriteFence';
import {
  ownerWorkEvidence,
  resetDeviceWorkForTests,
  setDeviceSessionOwner,
} from '../lib/accountDeviceWork';
import {
  buildPremiumDeletionNotice,
  subscriptionManagementUrl,
} from '../lib/premiumDeletionNotice';
import { preparePremiumDeletion } from '../supabase/functions/_shared/premiumDeletionCheckpoint';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function ports(): PremiumClientPorts {
  return {
    configured: () => true,
    identity: async () => 'opaque',
    connect: async () => undefined,
    disconnect: async () => undefined,
    verify: async () =>
      parseVerifiedMembership({
        tier: 'free',
        checkedAtMs: Date.now(),
        quotaPolicyActive: true,
        vtonDailyLimit: 3,
        vtonMinuteLimit: 3,
        storeProducts: { app_store: ['product'] },
      }),
    packages: async () => [
      {
        id: 'pack',
        productId: 'product',
        store: 'app_store',
        period: 'monthly',
        price: 'fixture',
      },
    ],
    purchase: jest.fn(async () => undefined),
    restore: jest.fn(async () => undefined),
    management: async () => null,
    open: async () => undefined,
  };
}
beforeEach(async () => {
  await AsyncStorage.clear();
  resetDeviceWorkForTests();
  resetAccountWriteFenceMemoryForTests();
  setDeviceSessionOwner('owner');
});
describe('PA1-04 SDK fence and real drain', () => {
  it('stops purchase and restore after a persisted fence', async () => {
    const p = ports(),
      client = createPremiumClient(p, createPremiumA1Lifecycle());
    await client.setOwner('owner');
    await fenceAccountWrites('owner');
    await client.purchase('pack');
    await client.restore();
    expect(p.purchase).not.toHaveBeenCalled();
    expect(p.restore).not.toHaveBeenCalled();
    expect(client.getSnapshot().membership).toBeNull();
  });
  it('waits for the real native promise and rejects its late entitlement publication', async () => {
    let finish!: () => void;
    const p = ports();
    p.purchase = () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      });
    const client = createPremiumClient(p, createPremiumA1Lifecycle());
    await client.setOwner('owner');
    const purchase = client.purchase('pack');
    await tick();
    expect(finish).toBeDefined();
    let drained = false;
    const deletion = fenceAccountWrites('owner').then(() => {
      drained = true;
    });
    await tick();
    expect(drained).toBe(false);
    expect(ownerWorkEvidence('owner').pending).toBeGreaterThan(0);
    expect(client.getSnapshot().membership).toBeNull();
    finish();
    await purchase;
    await deletion;
    expect(drained).toBe(true);
    expect(client.getSnapshot().membership).toBeNull();
  });
  it('rechecks immediately before dispatch even if fence starts during server admission', async () => {
    let admit!: () => void;
    const work = jest.fn(async () => undefined);
    const dispatch = dispatchPremiumUnderGuard(
      'owner',
      () =>
        new Promise<void>((resolve) => {
          admit = resolve;
        }),
      work,
    );
    await tick();
    const fence = fenceAccountWrites('owner');
    admit();
    await expect(dispatch).rejects.toThrow();
    await fence;
    expect(work).not.toHaveBeenCalled();
  });
});
describe('PA1-05 private checkpoint boundary', () => {
  it('fails closed on missing retention authorization without issuing provider deletion', async () => {
    const rpc = jest.fn(
      async (_name: string, _args: Record<string, unknown>) => ({
        data: { state: 'blocked_policy' },
        error: null,
      }),
    );
    await expect(
      preparePremiumDeletion({ rpc }, 'request', 'lease', null),
    ).rejects.toThrow('PREMIUM_CLEANUP_POLICY_REQUIRED');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('accepts a durable opaque-only handoff; unknown provider procedure stays external', async () => {
    const rpc = jest.fn(
      async (_name: string, _args: Record<string, unknown>) => ({
        data: { state: 'pending_method' },
        error: null,
      }),
    );
    await expect(
      preparePremiumDeletion(
        { rpc },
        'request',
        'lease',
        'fixture-approved-policy',
      ),
    ).resolves.toBeUndefined();
    expect(rpc.mock.calls[0][1]).toEqual({
      p_request: 'request',
      p_lease: 'lease',
      p_retention_policy: 'fixture-approved-policy',
      p_project: null,
      p_environment: null,
    });
  });
  it('stops on checkpoint failure rather than pretending deletion is complete', async () => {
    await expect(
      preparePremiumDeletion(
        { rpc: async () => ({ data: null, error: {} }) },
        'r',
        'l',
        null,
      ),
    ).rejects.toThrow();
  });
});
describe('PA1-06 single confirmation notice', () => {
  it.each(['active', 'inactive', 'unknown', 'pending'] as const)(
    'warns without promising cancellation or gating deletion: %s',
    (state) => {
      const notice = buildPremiumDeletionNotice(state);
      expect(notice).toContain(
        'Hesabınızı silmek App Store/Google Play aboneliğinizi iptal etmez',
      );
      expect(notice).not.toContain('otomatik iptal edildi');
    },
  );
  it('provides store settings without initializing purchases', () => {
    expect(subscriptionManagementUrl('ios')).toBe(
      'https://apps.apple.com/account/subscriptions',
    );
    expect(subscriptionManagementUrl('android')).toBe(
      'https://play.google.com/store/account/subscriptions',
    );
  });
});

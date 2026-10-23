import { handleMembershipRequest } from '../supabase/functions/_shared/premiumBackend';
import {
  deletionHandler,
  type DeletionPort,
} from '../supabase/functions/_shared/accountDeletionCoordinator';
import {
  createDeletionReceipt,
  DELETION_LAYERS,
} from '../supabase/functions/_shared/accountDeletionFoundation';
const config = {
  apiKey: 'fixture',
  entitlement: 'fixture',
  products: { app_store: ['m'], play_store: ['y'] },
  sandbox: true,
  webhookAuthorization: 'fixture-auth',
  appIds: ['app'],
  a1Ready: true,
  restorePolicy: 'KEEP_ORIGINAL' as const,
};
describe('PA1-03 late webhook', () => {
  const ports = () => ({
    admit: jest.fn(async () => false),
    authenticate: async () => 'owner',
    binding: jest.fn(async () => 'opaque'),
    ownerForBinding: jest.fn(async () => 'owner' as string | null),
    verify: jest.fn(),
    persist: jest.fn(),
  });
  const request = () =>
    new Request('https://fixture/', {
      method: 'POST',
      headers: { Authorization: 'fixture-auth' },
      body: JSON.stringify({
        event: {
          id: 'event',
          type: 'RENEWAL',
          app_id: 'app',
          app_user_id: 'opaque',
          environment: 'SANDBOX',
        },
      }),
    });
  it('does not even refresh vendor state after server fence denial', async () => {
    const p = ports();
    expect(
      (await handleMembershipRequest(request(), p, config, true)).status,
    ).toBe(503);
    expect(p.verify).not.toHaveBeenCalled();
    expect(p.persist).not.toHaveBeenCalled();
  });
  it('does not recreate a deleted owner or identity', async () => {
    const p = ports();
    p.ownerForBinding.mockResolvedValue(null);
    expect(
      (await handleMembershipRequest(request(), p, config, true)).status,
    ).toBe(409);
    expect(p.binding).not.toHaveBeenCalled();
    expect(p.persist).not.toHaveBeenCalled();
  });
  it('denies native purchase admission using JWT owner, not request owner', async () => {
    const p = ports();
    const r = new Request('https://fixture/admit', {
      method: 'POST',
      headers: { Authorization: 'Bearer fixture' },
      body: JSON.stringify({ userId: 'victim' }),
    });
    expect(
      (await handleMembershipRequest(r, p, config, false, false, false, true))
        .status,
    ).toBe(503);
    expect(p.admit).toHaveBeenCalledWith('owner');
    expect(p.binding).not.toHaveBeenCalled();
  });
});
describe('PA1-05 coordinator private handoff', () => {
  function fixture(fail: boolean) {
    const receipt = createDeletionReceipt('request', 'owner');
    for (const layer of [
      'queue',
      'async_storage',
      'local_files',
      'memory_cache',
    ] as const)
      receipt.layers[layer] = {
        state: 'VERIFIED',
        attempts: 1,
        evidence: ['fixture'],
      };
    const adapters = jest.fn(() =>
      Object.fromEntries(
        Object.keys(DELETION_LAYERS).map((key) => [
          key,
          {
            idempotent: true as const,
            verify: async () => ({
              complete: true,
              evidence: ['synthetic local proof'],
            }),
            cleanup: jest.fn(),
          },
        ]),
      ),
    );
    const port: DeletionPort = {
      readiness: async () => true,
      authenticate: async () => 'owner',
      begin: async () => ({ receipt, lease: 'lease', drainRemainingMs: 0 }),
      save: jest.fn(async () => undefined),
      release: jest.fn(async () => undefined),
      prepare: async () => {
        if (fail) throw new Error('PREMIUM_CLEANUP_POLICY_REQUIRED');
      },
      adapters,
    };
    const req = () =>
      new Request('https://fixture/', {
        method: 'POST',
        headers: { Authorization: 'Bearer fixture' },
        body: JSON.stringify({
          requestId: 'request',
          recoveryToken: 'a'.repeat(64),
          deviceCheckpoint: receipt,
        }),
      });
    return { port, adapters, req };
  }
  it('does not reach Auth/Storage cleanup if private checkpoint fails', async () => {
    const f = fixture(true);
    expect((await deletionHandler(f.port)(f.req())).status).toBe(503);
    expect(f.adapters).not.toHaveBeenCalled();
    expect(f.port.release).toHaveBeenCalled();
    expect(
      (f.port.save as jest.Mock).mock.calls.at(-1)[1].layers.db.state,
    ).toBe('RETRY_REQUIRED');
  });
  it('does not make UNKNOWN vendor confirmation a new Auth gate', async () => {
    const f = fixture(false);
    const result = await (await deletionHandler(f.port)(f.req())).json();
    expect(result.complete).toBe(true);
    expect(result.receipt.layers.vendor.state).toBe('UNKNOWN');
    expect(result.receipt).not.toHaveProperty('premium_cleanup');
  });
});

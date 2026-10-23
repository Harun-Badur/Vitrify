import { reserveMembershipVton, settleMembershipVton, reconcileMembershipVton } from '../supabase/functions/_shared/premiumVton';
describe('VTON membership integration', () => {
  const ports = () => ({ binding: jest.fn(async () => 'opaque'), verify: jest.fn(async () => ({ tier: 'free' as const, expiresAtMs: null, sourceMs: Date.now(), transaction: null, store: null })), persist: jest.fn(async () => true), rpc: jest.fn(async (_name: string, _args: Record<string, unknown>) => ({ data: { allowed: true, daily_limit: 3 }, error: null })) });
  it('refreshes server membership before atomically reserving with no client tier', async () => {
    const p = ports();
    expect((await reserveMembershipVton(p, 'owner', 'request', 'hash')).allowed).toBe(true);
    expect(p.rpc).toHaveBeenCalledWith('premium_vton_reserve', { p_owner: 'owner', p_request: 'request', p_hash: 'hash' });
  });
  it('stops before consumption if verification or persistence is unavailable', async () => {
    const p = ports(); p.persist.mockResolvedValue(false);
    await expect(reserveMembershipVton(p, 'owner', 'request', 'hash')).rejects.toThrow();
    expect(p.rpc).not.toHaveBeenCalled();
  });
  it('settlement failure remains visible and is never retried', async () => {
    const p = ports(); p.rpc.mockResolvedValue({ data: null, error: {} } as any);
    await expect(settleMembershipVton(p, 'owner', 'r', 'unknown', 'prediction')).rejects.toThrow();
    expect(p.rpc).toHaveBeenCalledTimes(1);
  });
  it('only reconciles a stored provider id and refunds a verified terminal failure', async () => {
    const p = ports(); p.rpc.mockResolvedValue({ data: true, error: null } as any);
    const status = jest.fn(async () => 'failed');
    expect(await reconcileMembershipVton(p, 'owner', 'r', { state: 'unknown', prediction_id: 'stored' }, status)).toBe('failed');
    expect(status).toHaveBeenCalledWith('stored');
    expect(p.rpc).toHaveBeenCalledWith('premium_vton_settle', expect.objectContaining({ p_outcome: 'failed', p_prediction: 'stored' }));
  });
  it('does not refund or dispatch when provider result or prediction is unknown', async () => {
    const p = ports(); const status = jest.fn(async () => 'processing');
    expect(await reconcileMembershipVton(p, 'owner', 'r', { state: 'unknown', prediction_id: null }, status)).toBe('unknown');
    expect(status).not.toHaveBeenCalled();
    expect(await reconcileMembershipVton(p, 'owner', 'r', { state: 'unknown', prediction_id: 'p' }, status)).toBe('unknown');
    expect(p.rpc).not.toHaveBeenCalled();
  });
});

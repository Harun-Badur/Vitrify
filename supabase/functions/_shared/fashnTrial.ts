/** Temporary overlay, independent of permanent membership quotas. No provider calls here. */
export interface TrialPort {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
});
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
export async function readFashnTrialStatus(port: TrialPort, owner: string): Promise<{ enabled: true; used: boolean }> {
  const r = await port.rpc('fashn_trial_gate', { p_owner: owner, p_action: 'status' });
  if (r.error || !record(r.data) || typeof r.data.used !== 'boolean') throw Error('TRIAL_UNVERIFIED');
  return { enabled: true, used: r.data.used };
}
export async function withFashnTrial(
  port: TrialPort, enabled: boolean, owner: string, request: string | null, hash: string,
  work: (claim: () => Promise<void>) => Promise<Response>,
): Promise<Response> {
  if (!enabled) return work(async () => {});
  if (!request || !/^[a-zA-Z0-9-]{1,100}$/.test(request)) return reply(400, { code: 'REQUEST_INVALID', detail: 'Geçersiz deneme kimliği.' });
  const args = { p_owner: owner, p_request: request, p_hash: hash };
  let lease: string | null = null;
  let dispatchPossible = false;
  try {
    const r = await port.rpc('fashn_trial_gate', { ...args, p_action: 'reserve' });
    if (r.error || !record(r.data) || typeof r.data.allowed !== 'boolean') throw Error('TRIAL_UNVERIFIED');
    if (!r.data.allowed) return reply(r.data.reason === 'trial_ineligible' ? 403 : r.data.reason === 'trial_used' ? 429 : 409, {
      code: r.data.reason, state: r.data.state,
      detail: r.data.reason === 'trial_ineligible' ? 'Bu test yalnız aktivasyondan sonra oluşturulan yeni hesaplara açık.' : r.data.reason === 'trial_used' ? 'Deneme hakkını kullandın' : 'Bu işlem zaten kayıtlı. Yeni deneme başlatılmadı.',
    });
    if (typeof r.data.lease !== 'string' || !r.data.lease) throw Error('TRIAL_UNVERIFIED');
    lease = r.data.lease;
    const response = await work(async () => {
      if (dispatchPossible) throw Error('DISPATCH_ALREADY_CLAIMED');
      // Even an RPC timeout may mean its checkpoint committed. Never release after this point.
      dispatchPossible = true;
      const claim = await port.rpc('fashn_trial_gate', { ...args, p_lease: lease, p_action: 'dispatch' });
      if (claim.error || claim.data !== true) throw Error('TRIAL_DISPATCH_UNVERIFIED');
    });
    if (dispatchPossible && response.ok) {
      const completed = await port.rpc('fashn_trial_gate', { ...args, p_lease: lease, p_action: 'complete' });
      if (completed.error || completed.data !== true) throw Error('TRIAL_COMPLETION_UNVERIFIED');
    }
    return response;
  } catch {
    return reply(503, { code: 'TRIAL_UNVERIFIED', detail: 'Deneme durumu doğrulanamadı. Otomatik tekrar yapılmadı.' });
  } finally {
    if (lease && !dispatchPossible) {
      // This invocation alone holds the lease and never crossed the dispatch checkpoint.
      try {
        const released = await port.rpc('fashn_trial_gate', { ...args, p_lease: lease, p_action: 'release' });
        if (released.error || released.data !== true) console.error('FASHN_TRIAL_RELEASE_UNVERIFIED');
      } catch { /* Fail closed: reservation remains durable; no refund assumption. */ }
    }
  }
}

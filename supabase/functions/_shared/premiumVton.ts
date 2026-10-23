import type { MembershipPorts } from './premiumBackend.ts';
export interface QuotaRpcPort {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: unknown }>;
}
export async function reserveMembershipVton(ports: Pick<MembershipPorts, 'binding' | 'verify' | 'persist'> & QuotaRpcPort, owner: string, request: string, hash: string): Promise<{ allowed: boolean; reason?: string; retry_after_seconds?: number; daily_limit?: number }> {
  const binding = await ports.binding(owner);
  const snapshot = await ports.verify(binding);
  if (!await ports.persist(owner, binding, snapshot, null)) throw new Error('MEMBERSHIP_REFRESH_REQUIRED');
  const r = await ports.rpc('premium_vton_reserve', { p_owner: owner, p_request: request, p_hash: hash });
  if (r.error || !r.data || typeof r.data.allowed !== 'boolean') throw new Error('QUOTA_UNVERIFIED');
  return r.data;
}
export async function settleMembershipVton(ports: QuotaRpcPort, owner: string, request: string, outcome: 'not_sent' | 'dispatched' | 'unknown' | 'failed' | 'completed', prediction: string | null = null): Promise<void> {
  const r = await ports.rpc('premium_vton_settle', { p_owner: owner, p_request: request, p_outcome: outcome, p_prediction: prediction });
  if (r.error || r.data !== true) throw new Error('QUOTA_SETTLEMENT_UNVERIFIED');
}

/** Caller loads this ledger row using the verified JWT owner, never client prediction IDs. */
export async function reconcileMembershipVton(ports: QuotaRpcPort, owner: string, request: string, row: { state: string; prediction_id: string | null }, status: (prediction: string) => Promise<string>): Promise<string> {
  if (row.state === 'refunded' || row.state === 'completed') return row.state;
  if (!row.prediction_id) return 'unknown';
  const result = await status(row.prediction_id);
  if (result !== 'completed' && result !== 'failed') return 'unknown';
  await settleMembershipVton(ports, owner, request, result, row.prediction_id);
  return result;
}

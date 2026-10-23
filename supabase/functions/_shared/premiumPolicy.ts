/** Server-only policy. This module does not verify purchases.
 * Call ONLY with evidence produced by a trusted backend verifier, never request JSON
 * or user metadata. Not connected to the live VTON handler until that verifier exists.
 */
export interface VtonMembershipPolicy {
  tier: 'free' | 'premium';
  dailyLimit: 3 | 20;
  minuteLimit: 3;
  adFree: boolean;
}

export function resolveVerifiedVtonPolicy(
  authenticatedOwnerId: string,
  serverEvidence: unknown,
  nowMs: number,
): VtonMembershipPolicy | null {
  if (!authenticatedOwnerId || !Number.isFinite(nowMs) ||
      !serverEvidence || typeof serverEvidence !== 'object') return null;
  const evidence = serverEvidence as Record<string, unknown>;
  if (evidence.ownerId !== authenticatedOwnerId) return null;
  if (evidence.kind === 'free') {
    return { tier: 'free', dailyLimit: 3, minuteLimit: 3, adFree: false };
  }
  if (evidence.kind !== 'premium' || typeof evidence.expiresAtMs !== 'number' ||
      !Number.isFinite(evidence.expiresAtMs)) return null;
  const active = evidence.expiresAtMs > nowMs;
  return active
    ? { tier: 'premium', dailyLimit: 20, minuteLimit: 3, adFree: true }
    : { tier: 'free', dailyLimit: 3, minuteLimit: 3, adFree: false };
}

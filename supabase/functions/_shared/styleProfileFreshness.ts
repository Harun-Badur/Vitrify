/** Timestamp proves cutover eligibility, not producer identity by itself.
 * Caller must also enforce the single-writer/config transition contract.
 * Strict millisecond comparison conservatively rejects ambiguous microseconds.
 */
export function styleProfileFreshness(mode: unknown, computedAt: unknown): 'v1' | 'v2_fresh' | 'stale' | 'unverified' {
  const config = mode && typeof mode === 'object' && !Array.isArray(mode) ? mode as Record<string, unknown> : null;
  if (config?.algorithm !== 'style-preference-v2') return 'v1';
  const cutoff = typeof config.activated_at === 'string' ? Date.parse(config.activated_at) : NaN;
  if (config.legacy_policy !== 'exclude_with_approval' || !Number.isFinite(cutoff)) return 'unverified';
  const computed = typeof computedAt === 'string' ? Date.parse(computedAt) : NaN;
  return Number.isFinite(computed) && computed > cutoff ? 'v2_fresh' : 'stale';
}

// Server-only library. No endpoint, scheduler or automatic invocation.
export const PREMIUM_CLEANUP_POLICY = 'vitrify-rc-lifecycle-20261017';
export function cleanupMilestone(createdAt: number, now: number): string {
  if (!Number.isFinite(createdAt) || !Number.isFinite(now) || now < createdAt)
    throw new Error('CLEANUP_CLOCK_INVALID');
  const hours = (now - createdAt) / 3600000;
  return hours >= 720 ? 'review_required' : hours >= 168 ? 'escalation_required' : hours >= 24 ? 'overdue' : 'within_target';
}
interface Scope { project: string; environment: 'sandbox' | 'production' }
interface Config extends Scope { secret: string }
interface Target extends Scope { appUserId: string }
export async function deleteRevenueCatCustomer(config: Config, target: Target, fetcher: typeof fetch) {
  if (!config.secret || !config.project || !target.appUserId || config.project !== target.project || config.environment !== target.environment)
    throw new Error('CLEANUP_SCOPE_MISMATCH');
  // v2 project-scoped customer DELETE; it can affect both environments of a customer.
  // Environment records provenance, not isolation of the provider's DELETE operation.
  try {
    const response = await fetcher(`https://api.revenuecat.com/v2/projects/${encodeURIComponent(config.project)}/customers/${encodeURIComponent(target.appUserId)}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${config.secret}` },
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    // Do not read/log bodies, URLs, IDs or credentials. No GET-or-create verification.
    if (response.status === 200 || response.status === 404)
      return { state: 'awaiting_verification', errorCode: null, physicalDeletionVerified: false } as const;
    return { state: 'retry_required', errorCode: response.status === 401 || response.status === 403 ? 'RC_AUTH_DENIED' : response.status === 429 ? 'RC_RATE_LIMITED' : 'RC_DELETE_REJECTED', physicalDeletionVerified: false } as const;
  } catch {
    return { state: 'retry_required', errorCode: 'RC_NETWORK_UNKNOWN', physicalDeletionVerified: false } as const;
  }
}

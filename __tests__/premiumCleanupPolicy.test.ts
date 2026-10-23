import { cleanupMilestone, deleteRevenueCatCustomer } from '../supabase/functions/_shared/premiumCleanupPolicy';

const config = { secret: 'fixture-only', project: 'fixture-project', environment: 'sandbox' as const };
describe('approved RC cleanup local delta', () => {
  test.each([200, 404])('%s is an API response, never physical deletion proof', async status => {
    const fetcher = jest.fn(async () => new Response(null, { status }));
    const result = await deleteRevenueCatCustomer(config, { appUserId: 'opaque-id', project: config.project, environment: config.environment }, fetcher);
    expect(result).toEqual({ state: 'awaiting_verification', errorCode: null, physicalDeletionVerified: false });
    expect(fetcher.mock.calls).toHaveLength(1);
  });
  test('scope mismatch performs no request', async () => {
    const fetcher = jest.fn();
    await expect(deleteRevenueCatCustomer(config, { appUserId: 'opaque-id', project: 'other', environment: 'sandbox' }, fetcher)).rejects.toThrow('CLEANUP_SCOPE_MISMATCH');
    expect(fetcher).not.toHaveBeenCalled();
  });
  test('network errors do not expose provider details or retry', async () => {
    const fetcher = jest.fn(async () => { throw new Error('secret-bearing-provider-message'); });
    expect(await deleteRevenueCatCustomer(config, { appUserId: 'opaque-id', project: config.project, environment: 'sandbox' }, fetcher)).toMatchObject({ state: 'retry_required', errorCode: 'RC_NETWORK_UNKNOWN' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  test.each([[0, 'within_target'], [24, 'overdue'], [168, 'escalation_required'], [720, 'review_required'], [1000, 'review_required']])('hour %s has no automatic purge', (hours, expected) => {
    expect(cleanupMilestone(0, hours as number * 3600000)).toBe(expected);
  });
});

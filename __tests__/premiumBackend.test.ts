import { readRevenueCatSnapshot, verifyRevenueCat, handleMembershipRequest } from '../supabase/functions/_shared/premiumBackend';

const config = { apiKey: 'fixture-only', entitlement: 'fixture', products: { app_store: ['monthly'], play_store: ['yearly'] }, sandbox: false, webhookAuthorization: 'fixture-auth' };
const fixture = () => ({ request_date_ms: 1000, subscriber: { original_app_user_id: 'opaque', entitlements: { fixture: { product_identifier: 'monthly', expires_date: '2030-01-01T00:00:00Z' } }, subscriptions: { monthly: { expires_date: '2030-01-01T00:00:00Z', grace_period_expires_date: null, is_sandbox: false, store: 'app_store', store_transaction_id: 'txn', ownership_type: 'PURCHASED', refunded_at: null } } } });
describe('RevenueCat server verification', () => {
  it('uses store verified entitlement, not cancellation flag', () => {
    const value = fixture();
    expect(readRevenueCatSnapshot(value, 'opaque', config, 1000).tier).toBe('premium');
  });
  it('accepts explicit empty entitlements as free', () => {
    const value = fixture(); value.subscriber.entitlements = {} as any;
    expect(readRevenueCatSnapshot(value, 'opaque', config, 1000).tier).toBe('free');
  });
  it.each(['identity', 'sandbox', 'product', 'malformed', 'shared'])('rejects %s rather than opening access', kind => {
    const value = fixture();
    if (kind === 'identity') value.subscriber.original_app_user_id = 'foreign';
    if (kind === 'sandbox') value.subscriber.subscriptions.monthly.is_sandbox = true;
    if (kind === 'product') value.subscriber.entitlements.fixture.product_identifier = 'unapproved';
    if (kind === 'malformed') value.subscriber.entitlements = null as any;
    if (kind === 'shared') value.subscriber.subscriptions.monthly.ownership_type = 'FAMILY_SHARED';
    expect(() => readRevenueCatSnapshot(value, 'opaque', config, 1000)).toThrow();
  });
  it('removes access for a source-verified refunded purchase', () => {
    const value = fixture(); value.subscriber.subscriptions.monthly.refunded_at = '2026-01-01T00:00:00Z' as any;
    expect(readRevenueCatSnapshot(value, 'opaque', config, 1000).tier).toBe('free');
  });
  it('does not turn HTTP errors or redirects into a free subscription', async () => {
    await expect(verifyRevenueCat('opaque', config, async () => new Response('', { status: 404 }), 1000)).rejects.toThrow();
  });
  it('bounds stale responses and accepts verified grace period', () => {
    const value = fixture();
    value.subscriber.entitlements.fixture.expires_date = '1970-01-01T00:00:00Z';
    value.subscriber.subscriptions.monthly.expires_date = '1970-01-01T00:00:00Z';
    value.subscriber.subscriptions.monthly.grace_period_expires_date = '2030-01-01T00:00:00Z' as any;
    expect(readRevenueCatSnapshot(value, 'opaque', config, 1000).tier).toBe('premium');
    expect(() => readRevenueCatSnapshot(value, 'opaque', config, 9999999)).toThrow();
  });
});

describe('membership handler trust boundary', () => {
  const ports = () => ({ admit:async()=>true,authenticate: jest.fn(async () => 'owner' as string | null), binding: jest.fn(async () => 'opaque'), ownerForBinding: jest.fn(async () => 'owner' as string | null), verify: jest.fn(async () => ({ tier: 'free' as const, expiresAtMs: null, sourceMs: 1000, transaction: null, store: null })), persist: jest.fn(async () => true) });
  it('requires a verified JWT before provisioning any identity', async () => {
    const p = ports(); p.authenticate.mockResolvedValue(null);
    expect((await handleMembershipRequest(new Request('https://fixture/', { method: 'POST' }), p, config, false)).status).toBe(401);
    expect(p.binding).not.toHaveBeenCalled();
  });
  it('ignores supplied user and premium flags', async () => {
    const p = ports();
    const response = await handleMembershipRequest(new Request('https://fixture/', { method: 'POST', body: JSON.stringify({ userId: 'victim', isPremium: true }) }), p, config, false);
    expect(response.status).toBe(200); expect(p.binding).toHaveBeenCalledWith('owner');
    expect((await response.json()).tier).toBe('free');
  });
  it('provides a JWT-bound opaque SDK identity without requiring an existing RC customer', async () => {
    const p = ports();
    const response = await handleMembershipRequest(new Request('https://fixture/identity', { method: 'POST' }), p, config, false, true);
    expect(await response.json()).toEqual({ appUserId: 'opaque', sdkAllowed: false });
    expect(p.verify).not.toHaveBeenCalled(); expect(p.persist).not.toHaveBeenCalled();
  });
  it('rejects unauthenticated webhooks before JSON or provider work', async () => {
    const p = ports();
    expect((await handleMembershipRequest(new Request('https://fixture/', { method: 'POST', body: 'bad' }), p, config, true)).status).toBe(401);
    expect(p.verify).not.toHaveBeenCalled();
  });
  it('refreshes current source rather than trusting renewal payload; persists event atomically', async () => {
    const p = ports();
    const response = await handleMembershipRequest(new Request('https://fixture/', { method: 'POST', headers: { Authorization: 'fixture-auth' }, body: JSON.stringify({ event: { id: 'event', type: 'RENEWAL', app_id: 'app', environment: 'PRODUCTION', app_user_id: 'opaque', entitlement_ids: ['fake'] } }) }), p, { ...config, appIds: ['app'] }, true);
    expect(response.status).toBe(200); expect(p.verify).toHaveBeenCalledWith('opaque');
    expect(p.persist.mock.calls[0]).toEqual(['owner', 'opaque', expect.objectContaining({ tier: 'free' }), 'event']);
  });
  it('never transfers or aliases identities from webhook', async () => {
    const p = ports();
    const response = await handleMembershipRequest(new Request('https://fixture/', { method: 'POST', headers: { Authorization: 'fixture-auth' }, body: JSON.stringify({ event: { id: 'e', type: 'TRANSFER', app_id: 'app', environment: 'PRODUCTION' } }) }), p, { ...config, appIds: ['app'] }, true);
    expect(response.status).toBe(409); expect(p.persist).not.toHaveBeenCalled();
  });
});

import { resolveVerifiedVtonPolicy } from '../supabase/functions/_shared/premiumPolicy';

describe('server verified VTON policy', () => {
  const now = 1000;
  it('keeps authenticated free users at 3/day and 3/minute', () => {
    expect(resolveVerifiedVtonPolicy('owner', { kind: 'free', ownerId: 'owner' }, now))
      .toEqual({ tier: 'free', dailyLimit: 3, minuteLimit: 3, adFree: false });
  });
  it('grants premium until verified expiry even when renewal is cancelled', () => {
    expect(resolveVerifiedVtonPolicy('owner', { kind: 'premium', ownerId: 'owner', expiresAtMs: 1001 }, now))
      .toEqual({ tier: 'premium', dailyLimit: 20, minuteLimit: 3, adFree: true });
  });
  it('expires at the exact boundary without resetting quota counters', () => {
    expect(resolveVerifiedVtonPolicy('owner', { kind: 'premium', ownerId: 'owner', expiresAtMs: now }, now)?.dailyLimit).toBe(3);
  });
  it.each([
    { kind: 'unknown', ownerId: 'owner' },
    { kind: 'premium', ownerId: 'other', expiresAtMs: 2000 },
    { kind: 'premium', ownerId: 'owner', expiresAtMs: NaN },
    { kind: 'premium', ownerId: 'owner', expiresAtMs: Infinity },
    { kind: 'premium', ownerId: 'owner' },
    { isPremium: true, ownerId: 'owner' },
    null,
  ])('does not grant access from unavailable, malformed or foreign evidence: %p', evidence => {
    expect(resolveVerifiedVtonPolicy('owner', evidence, now)).toBeNull();
  });
  it('requires an authenticated owner and valid clock', () => {
    expect(resolveVerifiedVtonPolicy('', { kind: 'free', ownerId: '' }, now)).toBeNull();
    expect(resolveVerifiedVtonPolicy('owner', { kind: 'free', ownerId: 'owner' }, NaN)).toBeNull();
  });
});

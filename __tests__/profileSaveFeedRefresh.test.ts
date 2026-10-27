import {
  FEED_REFRESH_DEBOUNCE_MS,
  cancelScheduledFeedRefresh,
  cancelScheduledFeedRefreshOnOwnerChange,
  profileChangeAffectsFeed,
  scheduleFeedRefreshAfterProfileSave,
} from '../lib/profileSaveFeedRefresh';
import type { UserStudioProfile } from '../types/profile';

const base: UserStudioProfile = {
  userId: 'A', heightCm: 180, weightKg: 70, topSize: null, bottomSize: null,
  styleTags: ['minimal'], modelPhotoPath: null,
  favoriteBrands: ['mango'], preferredColors: ['siyah'], priceRange: { min: 100, max: 900 },
};

describe('profileChangeAffectsFeed', () => {
  it('is false for identical values, regardless of list order', () => {
    expect(profileChangeAffectsFeed(base, { ...base })).toBe(false);
    expect(profileChangeAffectsFeed(
      { ...base, favoriteBrands: ['mango', 'zara'] }, { ...base, favoriteBrands: ['zara', 'mango'] })).toBe(false);
  });

  it('treats missing optional preferences as empty', () => {
    expect(profileChangeAffectsFeed({ ...base, favoriteBrands: undefined, priceRange: undefined },
      { ...base, favoriteBrands: [], priceRange: null })).toBe(false);
    expect(profileChangeAffectsFeed(null, { ...base, favoriteBrands: [], preferredColors: [], priceRange: null, styleTags: [] })).toBe(false);
  });

  it.each([
    ['styleTags', { styleTags: ['minimal', 'sportif'] }],
    ['favoriteBrands', { favoriteBrands: ['mango', 'zara'] }],
    ['preferredColors', { preferredColors: ['bej'] }],
    ['priceRange', { priceRange: { min: 100, max: 1200 } }],
  ] as const)('is true when %s changes', (_name, patch) => {
    expect(profileChangeAffectsFeed(base, { ...base, ...patch } as UserStudioProfile)).toBe(true);
  });

  it('ignores fields that do not feed ranking', () => {
    expect(profileChangeAffectsFeed(base, { ...base, heightCm: 190, modelPhotoPath: 'x' })).toBe(false);
  });
});

describe('scheduleFeedRefreshAfterProfileSave', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { cancelScheduledFeedRefresh(); jest.useRealTimers(); });

  it('runs one refresh after the debounce window', () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    scheduleFeedRefreshAfterProfileSave(refresh);
    expect(refresh).not.toHaveBeenCalled();
    jest.advanceTimersByTime(FEED_REFRESH_DEBOUNCE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('collapses two consecutive saves into one refresh', () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    scheduleFeedRefreshAfterProfileSave(refresh);
    jest.advanceTimersByTime(FEED_REFRESH_DEBOUNCE_MS - 1);
    scheduleFeedRefreshAfterProfileSave(refresh);
    jest.advanceTimersByTime(FEED_REFRESH_DEBOUNCE_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('swallows a rejected refresh', async () => {
    const refresh = jest.fn().mockRejectedValue(new Error('x'));
    scheduleFeedRefreshAfterProfileSave(refresh);
    jest.advanceTimersByTime(FEED_REFRESH_DEBOUNCE_MS);
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('account change', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { cancelScheduledFeedRefresh(); jest.useRealTimers(); });

  it('does not refresh when the user who saved is no longer active at fire time', () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    let active: string | null = 'A';
    scheduleFeedRefreshAfterProfileSave(refresh, { owner: 'A', activeOwner: () => active });
    jest.advanceTimersByTime(FEED_REFRESH_DEBOUNCE_MS - 1);
    active = 'B';
    jest.advanceTimersByTime(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes as before when the same user is still active', () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    scheduleFeedRefreshAfterProfileSave(refresh, { owner: 'A', activeOwner: () => 'A' });
    jest.advanceTimersByTime(FEED_REFRESH_DEBOUNCE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('drops the pending refresh when the owner changes or signs out', () => {
    for (const next of ['B', null]) {
      const refresh = jest.fn().mockResolvedValue(undefined);
      scheduleFeedRefreshAfterProfileSave(refresh, { owner: 'A', activeOwner: () => 'A' });
      cancelScheduledFeedRefreshOnOwnerChange(next);
      jest.advanceTimersByTime(FEED_REFRESH_DEBOUNCE_MS);
      expect(refresh).not.toHaveBeenCalled();
    }
  });

  it('keeps the pending refresh while the owner is unchanged', () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    scheduleFeedRefreshAfterProfileSave(refresh, { owner: 'A', activeOwner: () => 'A' });
    cancelScheduledFeedRefreshOnOwnerChange('A');
    jest.advanceTimersByTime(FEED_REFRESH_DEBOUNCE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

import type { UserStudioProfile } from '../types/profile';

export const FEED_REFRESH_DEBOUNCE_MS = 1_500;

const sortedList = (value: readonly string[] | undefined): string[] => [...(value ?? [])].sort();

/** Only the saved fields that the feed profile reads; size/photo edits never reorder the feed. */
const feedSignature = (profile: UserStudioProfile | null): string => JSON.stringify([
  sortedList(profile?.styleTags),
  sortedList(profile?.favoriteBrands),
  sortedList(profile?.preferredColors),
  profile?.priceRange ? [profile.priceRange.min, profile.priceRange.max] : null,
]);

export const profileChangeAffectsFeed = (
  previous: UserStudioProfile | null,
  next: UserStudioProfile,
): boolean => feedSignature(previous) !== feedSignature(next);

let timer: ReturnType<typeof setTimeout> | null = null;

export const cancelScheduledFeedRefresh = (): void => {
  if (timer !== null) clearTimeout(timer);
  timer = null;
};

/** Consecutive saves collapse into a single refresh; a failed refresh is dropped silently. */
export const scheduleFeedRefreshAfterProfileSave = (
  refresh: () => Promise<void>,
  delayMs: number = FEED_REFRESH_DEBOUNCE_MS,
): void => {
  cancelScheduledFeedRefresh();
  timer = setTimeout(() => {
    timer = null;
    void refresh().catch(() => undefined);
  }, delayMs);
};

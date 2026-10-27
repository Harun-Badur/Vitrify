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
let scheduledOwner: string | null = null;

export const cancelScheduledFeedRefresh = (): void => {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  scheduledOwner = null;
};

/** Sign-out or a different user id drops a refresh that the previous user queued. */
export const cancelScheduledFeedRefreshOnOwnerChange = (activeOwner: string | null): void => {
  if (timer !== null && scheduledOwner !== null && scheduledOwner !== activeOwner) cancelScheduledFeedRefresh();
};

interface ScheduleOwner {
  owner: string;
  activeOwner: () => string | null;
}

/**
 * Consecutive saves collapse into a single refresh; a failed refresh is dropped silently.
 * With an owner, the refresh also does not run unless that user is still the active one.
 */
export const scheduleFeedRefreshAfterProfileSave = (
  refresh: () => Promise<void>,
  guard?: ScheduleOwner,
  delayMs: number = FEED_REFRESH_DEBOUNCE_MS,
): void => {
  cancelScheduledFeedRefresh();
  scheduledOwner = guard?.owner ?? null;
  timer = setTimeout(() => {
    timer = null;
    scheduledOwner = null;
    if (guard && guard.activeOwner() !== guard.owner) return;
    void refresh().catch(() => undefined);
  }, delayMs);
};

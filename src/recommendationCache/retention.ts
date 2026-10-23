export const RECOMMENDATION_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** updated_at is materialization time, never a last-read/sliding TTL. */
export function recommendationCacheCutoff(now: number = Date.now()): string {
  if (!Number.isFinite(now)) throw new Error('Invalid retention clock');
  return new Date(now - RECOMMENDATION_CACHE_MAX_AGE_MS).toISOString();
}

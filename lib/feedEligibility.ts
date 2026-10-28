/**
 * Stored feed gate (products.feed_eligible), written by the enrichment backfill.
 * Only an explicit true admits a product to a feed path: recs-feed, the local
 * engine, the recommendation pool and the complement strip. User history screens
 * (likes, favorites) never read this gate. Self-contained so the Edge bundle can import it.
 */
export const FEED_ELIGIBLE_COLUMN = 'feed_eligible';

export const isFeedEligibleRow = (row: unknown): boolean =>
  typeof row === 'object' && row !== null && (row as Record<string, unknown>)[FEED_ELIGIBLE_COLUMN] === true;

export const isFeedEligibleProduct = (product: { feedEligible?: boolean }): boolean =>
  product.feedEligible === true;

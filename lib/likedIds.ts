import type { LikedProduct } from '../types/product';

const cache = new WeakMap<readonly LikedProduct[], ReadonlySet<string>>();

/** Liked product ids as a Set, built once per likedProducts array so per-card lookups are O(1). */
export const likedIdSet = (liked: readonly LikedProduct[]): ReadonlySet<string> => {
  let ids = cache.get(liked);
  if (!ids) {
    ids = new Set(liked.map(item => item.product.id));
    cache.set(liked, ids);
  }
  return ids;
};

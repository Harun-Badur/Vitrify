import { likedIdSet } from '../lib/likedIds';
import { useAppStore } from '../store/useAppStore';

/** Narrow subscription: re-renders only when this product's liked flag flips. */
export const useIsLiked = (productId: string): boolean =>
  useAppStore((state) => likedIdSet(state.likedProducts).has(productId));

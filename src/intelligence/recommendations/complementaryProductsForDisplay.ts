import type { Product } from '../../../types/product';
import { perfComplLog, perfShortId } from '../../../lib/perfLog';
import type { DiscoverRecommendation } from './discoverRecommendation';

export const complementaryProductsForDisplay = (
  recommendations: readonly DiscoverRecommendation[],
  currentProductId: string | null,
): Product[] => {
  if (currentProductId === null) return [];
  const entry = recommendations.find((r) => r.type === 'outfit' && r.candidate.items.some((i) => i.sourceType === 'catalog' && i.sourceId === currentProductId));
  if (!entry || entry.type !== 'outfit') return [];
  const members = entry.candidate.items.flatMap((i) => i.sourceType === 'catalog' ? [i.product] : []);
  const candidates = entry.displayProducts ?? members;
  const seen = new Set([currentProductId]);
  // The pool is already gated on feed_eligible=true at the query. Database rows always
  // carry the flag (NOT NULL), so an explicit false is the only value that can reach here.
  // Fixtures/mock products without the flag are left to the engine unchanged.
  let identityDropped = 0;
  const result = candidates.flatMap((p) => {
    if (seen.has(p.id)) return [];
    if (!members.some((member) => member === p)) {
      if (p.feedEligible !== false) identityDropped += 1;
      return [];
    }
    if (p.feedEligible === false) return [];
    seen.add(p.id);
    return [p];
  }).slice(0, 3);
  if (identityDropped > 0) {
    const before = Math.min(result.length + identityDropped, 3);
    if (result.length < before) {
      perfComplLog('display_shrink', () => ({ card: perfShortId(currentProductId), before, after: result.length }));
    }
  }
  return result;
};

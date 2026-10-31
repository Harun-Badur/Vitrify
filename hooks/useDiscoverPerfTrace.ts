import { useCallback, useEffect, useRef } from 'react';
import type { DiscoverRecommendationCache } from '../lib/discoverRecommendationCache';
import { createComboReadinessTracker } from '../lib/discoverPerf';
import { perfTraceEnabled, startLongTaskWatch, stopLongTaskWatch } from '../lib/perfTrace';
import { perfMarkSwipe } from '../lib/perfLog';
import type { Product } from '../types/product';

/**
 * Measurement only. Records whether each visible card already had its combo, how long a swipe took
 * to reach a ready next card, and JS thread stalls. Returns the function to call when a swipe commits.
 * A no-op unless the perf trace is on.
 */
export function useDiscoverPerfTrace(
  session: DiscoverRecommendationCache,
  current: Product | null,
  revision: number,
): () => void {
  const tracker = useRef(createComboReadinessTracker());
  const shownId = useRef<string | null>(null);

  useEffect(() => {
    if (!perfTraceEnabled()) return;
    startLongTaskWatch();
    return stopLongTaskWatch;
  }, []);

  useEffect(() => {
    if (!perfTraceEnabled() || !current) return;
    const ready = session.lookup(current) !== undefined;
    if (shownId.current !== current.id) {
      shownId.current = current.id;
      tracker.current.cardShown(ready);
    }
    tracker.current.update(ready);
  }, [session, current, revision]);

  return useCallback(() => { perfMarkSwipe(); tracker.current.swipe(); }, []);
}

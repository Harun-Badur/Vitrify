const IDLE_SLICE_MS = 10;
const INTERACTING_SLICE_MS = 4;
/** The thrown card is still moving after the finger lifts. */
const SETTLE_MS = 400;
/** A lost touch end must not keep the small slice forever. */
const TOUCH_EXPIRY_MS = 5_000;

/** Ranking work gets longer JS slices only while nobody is touching or settling the deck. */
export function createRankingSliceBudget(now: () => number) {
  let touchedAt: number | null = null;
  let releasedAt = -Infinity;
  return {
    touchStart(): void { touchedAt = now(); },
    touchEnd(): void { touchedAt = null; releasedAt = now(); },
    budgetMs(): number {
      const at = now();
      const touching = touchedAt !== null && at - touchedAt < TOUCH_EXPIRY_MS;
      return touching || at - releasedAt < SETTLE_MS ? INTERACTING_SLICE_MS : IDLE_SLICE_MS;
    },
  };
}

const shared = createRankingSliceBudget(() => performance.now());
export const noteRankingTouchStart = (): void => shared.touchStart();
export const noteRankingTouchEnd = (): void => shared.touchEnd();
export const rankingSliceBudgetMs = (): number => shared.budgetMs();

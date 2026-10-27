import { mark, perfTraceEnabled, recordMs } from './perfTrace';

export interface ComboReadinessTracker {
  /** A swipe was committed; time runs until the next card has its combo. */
  swipe: () => void;
  /** A different card became the current one; was its combo already there? */
  cardShown: (ready: boolean) => void;
  /** The current card's combo state after any render or published packet. */
  update: (ready: boolean) => void;
}

/** Measurement only. Holds timestamps and flags, never product identifiers. */
export const createComboReadinessTracker = (): ComboReadinessTracker => {
  let swipeAt: number | null = null;
  let awaitingNextCard = false;
  return {
    swipe: () => {
      if (!perfTraceEnabled()) return;
      swipeAt = performance.now();
      awaitingNextCard = true;
    },
    cardShown: (ready) => {
      if (!perfTraceEnabled()) return;
      mark(ready ? 'combo_ready_before_swipe_yes' : 'combo_ready_before_swipe_no');
      awaitingNextCard = false;
    },
    update: (ready) => {
      if (swipeAt === null || awaitingNextCard || !ready || !perfTraceEnabled()) return;
      recordMs('swipe_to_next_ready', performance.now() - swipeAt);
      swipeAt = null;
    },
  };
};

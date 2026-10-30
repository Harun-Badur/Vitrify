export type DeckRefreshResult = 'ready' | 'empty' | 'busy';

interface DeckRefresherDeps {
  /** Drops catalog page caches so the reload reads fresh rows. */
  resetCaches: () => void;
  reload: () => Promise<void>;
  /** Current deck size after the reload settled. */
  deckSize: () => number;
}

/** "Yenile" on the finished deck: cache bypass + reload, one flight at a time. */
export const createDeckRefresher = ({ resetCaches, reload, deckSize }: DeckRefresherDeps) => {
  let inFlight = false;
  return async (): Promise<DeckRefreshResult> => {
    if (inFlight) return 'busy';
    inFlight = true;
    try {
      resetCaches();
      await reload();
      return deckSize() > 0 ? 'ready' : 'empty';
    } finally {
      inFlight = false;
    }
  };
};

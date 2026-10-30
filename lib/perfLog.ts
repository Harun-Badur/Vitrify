/**
 * Discover performance measurement. Dev builds only: every export is a no-op when __DEV__ is false.
 * Fields are numbers/closed labels only; never pass user data, tokens, ids or e-mail.
 */
type PerfValue = number | string | boolean;

let swipeAt: number | null = null;
let coldStartLogged = false;

export const perfNow = (): number => (__DEV__ ? performance.now() : 0);

export const formatPerfLine = (tag: string, fields: Record<string, PerfValue>): string =>
  `[PERF] ${tag}${Object.entries(fields).map(([key, value]) =>
    ` ${key}=${typeof value === 'number' ? Math.round(value) : value}`).join('')}`;

export const perfLog = (tag: string, fields: Record<string, PerfValue>): void => {
  if (!__DEV__) return;
  try { console.log(formatPerfLine(tag, fields)); } catch { /* Measurement cannot fail work. */ }
};

/** A swipe committed; the next card's first image time is measured from here. */
export const perfMarkSwipe = (): void => {
  if (__DEV__) swipeAt = performance.now();
};

/** Elapsed ms since the pending swipe, clearing it; null when none is pending. */
export const perfTakeSwipe = (): number | null => {
  if (!__DEV__ || swipeAt === null) return null;
  const elapsed = performance.now() - swipeAt;
  swipeAt = null;
  return elapsed;
};

export const perfHasPendingSwipe = (): boolean => __DEV__ && swipeAt !== null;

/** First current-card image shown since the JS runtime started (approximates cold open). */
export const perfColdStartFirstCard = (): void => {
  if (!__DEV__ || coldStartLogged) return;
  coldStartLogged = true;
  perfLog('cold_start_to_first_card', { ms: performance.now() });
};

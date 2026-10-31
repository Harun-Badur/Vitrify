/**
 * Discover performance measurement. On in dev builds, or in a release-like bundle started with
 * EXPO_PUBLIC_PERF_LOG=1 (never set in eas.json/.env). Every export is a no-op otherwise.
 * Fields are numbers/closed labels only; never pass user data, tokens, ids or e-mail.
 */
type PerfValue = number | string | boolean;

let swipeAt: number | null = null;
let refreshArmed = false;
let refreshStoreSetAt: number | null = null;
let coldStartLogged = false;

export const perfEnabled = (): boolean => __DEV__ || process.env.EXPO_PUBLIC_PERF_LOG === '1';

// Captured at module load; performance.now() can be epoch-based on some runtimes, so subtract it.
const moduleLoadedAt: number = perfEnabled() ? performance.now() : 0;

export const perfNow = (): number => (perfEnabled() ? performance.now() : 0);

export const formatPerfLine = (tag: string, fields: Record<string, PerfValue>): string =>
  `[PERF] ${tag}${Object.entries(fields).map(([key, value]) =>
    ` ${key}=${typeof value === 'number' ? Math.round(value) : value}`).join('')}`;

export const perfLog = (tag: string, fields: Record<string, PerfValue>): void => {
  if (!perfEnabled()) return;
  try { console.log(formatPerfLine(tag, fields)); } catch { /* Measurement cannot fail work. */ }
};

const renderCounts: Record<string, number> = {};

/** Counts a component render; the counts since the last swipe are attached to the swipe timings. */
export const perfCountRender = (name: string): void => {
  if (perfEnabled()) renderCounts[name] = (renderCounts[name] ?? 0) + 1;
};

/** Renders per component since the last swipe, as log fields (r_<name>=n). */
export const perfRenderFields = (): Record<string, number> => {
  const fields: Record<string, number> = {};
  for (const name of Object.keys(renderCounts)) fields[`r_${name}`] = renderCounts[name];
  return fields;
};

const LAG_INTERVAL_MS = 16;
const LAG_THRESHOLD_MS = 50;
let lagTimer: ReturnType<typeof setInterval> | null = null;

/** Logs every JS event-loop stall over 50 ms (timer fired late by more than the threshold). */
export const perfStartLagWatch = (): (() => void) => {
  if (!perfEnabled() || lagTimer !== null) return () => {};
  let expected = performance.now() + LAG_INTERVAL_MS;
  lagTimer = setInterval(() => {
    const now = performance.now();
    const lag = now - expected;
    if (lag > LAG_THRESHOLD_MS) perfLog('js_lag', { ms: lag });
    expected = now + LAG_INTERVAL_MS;
  }, LAG_INTERVAL_MS);
  return () => { if (lagTimer !== null) clearInterval(lagTimer); lagTimer = null; };
};

/** A swipe committed; the next card's first image time is measured from here. */
export const perfMarkSwipe = (): void => {
  if (!perfEnabled()) return;
  swipeAt = performance.now();
  for (const name of Object.keys(renderCounts)) renderCounts[name] = 0;
};

/** Elapsed ms since the pending swipe without clearing it; null when none is pending. */
export const perfPeekSwipe = (): number | null =>
  perfEnabled() && swipeAt !== null ? performance.now() - swipeAt : null;

/** Elapsed ms since the pending swipe, clearing it; null when none is pending. */
export const perfTakeSwipe = (): number | null => {
  if (!perfEnabled() || swipeAt === null) return null;
  const elapsed = performance.now() - swipeAt;
  swipeAt = null;
  return elapsed;
};

export const perfHasPendingSwipe = (): boolean => perfEnabled() && swipeAt !== null;

/** A deck refresh started; the store publication and first card image are timed after it. */
export const perfArmRefresh = (): void => {
  if (!perfEnabled()) return;
  refreshArmed = true;
  refreshStoreSetAt = null;
};

/** The feed result was published to the store (only counts while a refresh is armed). */
export const perfRefreshStoreSet = (): void => {
  if (perfEnabled() && refreshArmed && refreshStoreSetAt === null) refreshStoreSetAt = performance.now();
};

/** Elapsed ms from the refresh store publication to the first card image, clearing it; null otherwise. */
export const perfTakeRefreshImage = (): number | null => {
  if (!perfEnabled() || !refreshArmed || refreshStoreSetAt === null) return null;
  const elapsed = performance.now() - refreshStoreSetAt;
  refreshArmed = false;
  refreshStoreSetAt = null;
  return elapsed;
};

/** First current-card image shown since the JS runtime started (approximates cold open). */
export const perfColdStartFirstCard = (): void => {
  if (!perfEnabled() || coldStartLogged) return;
  coldStartLogged = true;
  perfLog('cold_start_to_first_card', { ms: performance.now() - moduleLoadedAt });
};

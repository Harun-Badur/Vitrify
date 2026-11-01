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

// typeof guard: the shared complement display code also runs in Node scripts, where __DEV__ is undefined.
export const perfEnabled = (): boolean => (typeof __DEV__ !== 'undefined' && __DEV__) || process.env.EXPO_PUBLIC_PERF_LOG === '1';

type SpanSink = (name: string, ms: number, attributes: Record<string, number | boolean | string>) => void;
let spanSink: SpanSink | null = null;

/** Installed by lib/sentry.ts for sampled sessions only; null otherwise. Console logging is unaffected. */
export const perfSetSpanSink = (sink: SpanSink | null): void => { spanSink = sink; };

/** Timing is taken for the [PERF] logs or, in sampled sessions, for Sentry spans. */
export const perfMeasuring = (): boolean => perfEnabled() || spanSink !== null;

// perfLog tag -> Sentry span name, and the closed attribute set each span may carry.
const SPAN_TAGS: Readonly<Record<string, { name: string; attributes: readonly string[] }>> = {
  swipe_to_next_image: { name: 'swipe_to_next', attributes: ['cached'] },
  rec_ranking_prepare: { name: 'rec_ranking_prepare', attributes: ['gender'] },
  feed_call: { name: 'feed_call', attributes: ['n'] },
  deck_refresh: { name: 'deck_refresh', attributes: ['n'] },
};

const emitSpan = (tag: string, fields: Record<string, PerfValue>): void => {
  const spec = SPAN_TAGS[tag];
  const ms = fields.ms;
  if (spanSink === null || !spec || typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return;
  const attributes: Record<string, PerfValue> = {};
  for (const key of spec.attributes) if (key in fields) attributes[key] = fields[key];
  try { spanSink(spec.name, ms, attributes); } catch { /* Measurement cannot fail work. */ }
};

/** Closed gender label for the product preference (matches the recs_feed log). */
export const perfGenderLabel = (preference: string | null | undefined): 'kadin' | 'erkek' | 'tumu' =>
  preference === 'kadin' ? 'kadin' : preference === 'erkek' ? 'erkek' : 'tumu';

// Captured at module load; performance.now() can be epoch-based on some runtimes, so subtract it.
const moduleLoadedAt: number = perfEnabled() ? performance.now() : 0;

export const perfNow = (): number => (perfMeasuring() ? performance.now() : 0);

export const formatPerfLine = (tag: string, fields: Record<string, PerfValue>): string =>
  `[PERF] ${tag}${Object.entries(fields).map(([key, value]) =>
    ` ${key}=${typeof value === 'number' ? Math.round(value) : value}`).join('')}`;

export const perfLog = (tag: string, fields: Record<string, PerfValue>): void => {
  emitSpan(tag, fields);
  if (!perfEnabled()) return;
  try { console.log(formatPerfLine(tag, fields)); } catch { /* Measurement cannot fail work. */ }
};

/** Short id for complement traces (first 8 chars); never a full product/user id. */
export const perfShortId = (id: string | null | undefined): string => (id ?? 'none').slice(0, 8);

/**
 * Complement-flicker trace: `[PERF] compl_<event> t=<epoch ms> ...`. The fields callback only runs
 * when logging is enabled, so disabled builds do no work and have no side effects.
 */
export const perfComplLog = (event: string, fields: () => Record<string, PerfValue>): void => {
  if (!perfEnabled()) return;
  try { console.log(formatPerfLine(`compl_${event}`, { t: Date.now(), ...fields() })); } catch { /* Measurement cannot fail work. */ }
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

let activeRoute = 'none';
let touchAt: number | null = null;

/** Closed route labels only (never ids or query strings). */
export const perfRouteLabel = (pathname: string): string => {
  if (pathname === '/' || pathname === '/index') return 'discover';
  if (pathname.startsWith('/liked')) return 'favoriler';
  if (pathname.startsWith('/style')) return 'stil';
  if (pathname.startsWith('/profile')) return 'profil';
  if (pathname.startsWith('/wardrobe/create')) return 'outfit_olustur';
  if (pathname.startsWith('/wardrobe/add')) return 'dolap_ekle';
  if (pathname.startsWith('/wardrobe')) return 'dolap';
  if (pathname.startsWith('/auth')) return 'auth';
  return 'diger';
};

/** The screen the user is on, attached to every js_lag line. */
export const perfSetRoute = (pathname: string): string => {
  const previous = activeRoute;
  activeRoute = perfRouteLabel(pathname);
  return previous;
};

/** A touch began anywhere; tab/screen switch time is measured from the latest one. */
export const perfMarkTouch = (): void => {
  if (perfEnabled()) touchAt = performance.now();
};

/** Elapsed ms since the latest touch, or null when none was seen. */
export const perfSinceTouch = (): number | null =>
  perfEnabled() && touchAt !== null ? performance.now() - touchAt : null;

export const perfActiveRoute = (): string => activeRoute;

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
    if (lag > LAG_THRESHOLD_MS) perfLog('js_lag', { ms: lag, route: activeRoute, ...perfRenderFields() });
    expected = now + LAG_INTERVAL_MS;
  }, LAG_INTERVAL_MS);
  return () => { if (lagTimer !== null) clearInterval(lagTimer); lagTimer = null; };
};

/** A swipe committed; the next card's first image time is measured from here. */
export const perfMarkSwipe = (): void => {
  if (!perfMeasuring()) return;
  swipeAt = performance.now();
  for (const name of Object.keys(renderCounts)) renderCounts[name] = 0;
};

/** Elapsed ms since the pending swipe without clearing it; null when none is pending. */
export const perfPeekSwipe = (): number | null =>
  perfMeasuring() && swipeAt !== null ? performance.now() - swipeAt : null;

/** Elapsed ms since the pending swipe, clearing it; null when none is pending. */
export const perfTakeSwipe = (): number | null => {
  if (!perfMeasuring() || swipeAt === null) return null;
  const elapsed = performance.now() - swipeAt;
  swipeAt = null;
  return elapsed;
};

export const perfHasPendingSwipe = (): boolean => perfMeasuring() && swipeAt !== null;

/** A deck refresh started; the store publication and first card image are timed after it. */
export const perfArmRefresh = (): void => {
  if (!perfMeasuring()) return;
  refreshArmed = true;
  refreshStoreSetAt = null;
};

/** The feed result was published to the store (only counts while a refresh is armed). */
export const perfRefreshStoreSet = (): void => {
  if (perfMeasuring() && refreshArmed && refreshStoreSetAt === null) refreshStoreSetAt = performance.now();
};

/** Elapsed ms from the refresh store publication to the first card image, clearing it; null otherwise. */
export const perfTakeRefreshImage = (): number | null => {
  if (!perfMeasuring() || !refreshArmed || refreshStoreSetAt === null) return null;
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

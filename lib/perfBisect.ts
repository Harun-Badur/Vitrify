/**
 * Diagnosis only (perf/bisect-flags, never merged). Active only when the bundle was started with
 * EXPO_PUBLIC_PERF_BISECT defined: a comma list of flags that switch off one subsystem each, or "on"
 * for the stall monitor alone. Without the variable every export is a no-op and behavior is unchanged.
 * Logs carry numbers and closed flag names only.
 */
export const PERF_BISECT_FLAGS = ['noRanking', 'noPublish', 'noImagePrefetch', 'noAnalytics', 'noProfile', 'noSentryPerf'] as const;
export type PerfBisectFlag = typeof PERF_BISECT_FLAGS[number];

export interface PerfBisectConfig { active: boolean; flags: ReadonlySet<PerfBisectFlag>; unknown: string[] }

export const parsePerfBisect = (raw: string | undefined): PerfBisectConfig => {
  if (raw === undefined) return { active: false, flags: new Set(), unknown: [] };
  const flags = new Set<PerfBisectFlag>();
  const unknown: string[] = [];
  for (const token of raw.split(',').map(part => part.trim()).filter(Boolean)) {
    if ((PERF_BISECT_FLAGS as readonly string[]).includes(token)) flags.add(token as PerfBisectFlag);
    else if (token !== 'on') unknown.push(token);
  }
  return { active: true, flags, unknown };
};

// Static member access so Expo inlines the value into the bundle.
const config = parsePerfBisect(process.env.EXPO_PUBLIC_PERF_BISECT);

export const perfBisect = (flag: PerfBisectFlag): boolean => config.flags.has(flag);

const TICK_MS = 50;
const STALL_LATE_MS = 100;
const SWIPE_WINDOW_MS = 1_000;
const SUMMARY_MS = 10_000;

interface StallMonitorDeps {
  now: () => number;
  log: (line: string) => void;
  flagsLabel: string;
  schedule?: (tick: () => void, ms: number) => () => void;
}

export function createStallMonitor({ now, log, flagsLabel, schedule }: StallMonitorDeps) {
  const every = schedule ?? ((tick: () => void, ms: number) => { const timer = setInterval(tick, ms); return () => clearInterval(timer); });
  let stop: (() => void) | null = null;
  let expected = 0, summaryAt = 0, stalls = 0, totalMs = 0, maxMs = 0;
  let swipeAt: number | null = null;
  let swipe: { at: number; totalMs: number; count: number } | null = null;
  const suffix = ` flags=${flagsLabel || 'none'}`;
  const closeSwipe = () => {
    if (swipe) log(`[BISECT] swipe_stall total_ms=${Math.round(swipe.totalMs)} count=${swipe.count}${suffix}`);
    swipe = null;
  };
  const tick = () => {
    const at = now();
    const late = at - expected;
    if (late > STALL_LATE_MS) {
      stalls += 1; totalMs += late; maxMs = Math.max(maxMs, late);
      log(`[BISECT] stall ms=${Math.round(late)} since_swipe=${swipeAt === null ? 'none' : Math.round(at - swipeAt)}${suffix}`);
      if (swipe && expected - swipe.at < SWIPE_WINDOW_MS) { swipe.totalMs += late; swipe.count += 1; }
    }
    expected = at + TICK_MS;
    if (swipe && at - swipe.at >= SWIPE_WINDOW_MS) closeSwipe();
    if (at - summaryAt >= SUMMARY_MS) {
      log(`[BISECT] summary window_s=${Math.round((at - summaryAt) / 1000)} stalls=${stalls} total_ms=${Math.round(totalMs)} max_ms=${Math.round(maxMs)}${suffix}`);
      summaryAt = at; stalls = 0; totalMs = 0; maxMs = 0;
    }
  };
  return {
    tick,
    start(): () => void {
      if (stop) return stop;
      const at = now();
      expected = at + TICK_MS; summaryAt = at;
      const cancel = every(tick, TICK_MS);
      const stopped = () => { cancel(); if (stop === stopped) stop = null; };
      stop = stopped;
      return stopped;
    },
    markSwipe(): void {
      closeSwipe();
      swipeAt = now();
      swipe = { at: swipeAt, totalMs: 0, count: 0 };
    },
  };
}

const monitor = config.active ? createStallMonitor({ now: () => performance.now(),
  // eslint-disable-next-line no-console
  log: line => console.log(line), flagsLabel: [...config.flags].join(',') }) : null;

/** Starts the JS stall monitor once; returns its stop function (no-op without the variable). */
export const startPerfBisectMonitor = (): (() => void) => {
  if (!monitor) return () => {};
  // eslint-disable-next-line no-console
  if (config.unknown.length > 0) console.warn(`[BISECT] unknown flags ignored: ${config.unknown.join(',')}`);
  return monitor.start();
};

export const perfBisectMarkSwipe = (): void => { monitor?.markSwipe(); };

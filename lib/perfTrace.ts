/**
 * Opt-in performance trace for Discover. Off by default: on in development, or in any build
 * made with EXPO_PUBLIC_PERF_TRACE=1. While off every entry point returns immediately.
 *
 * Stores only a fixed label, a duration and a time in a small ring buffer. Labels come from a
 * closed list, so no identifier, product name or user data can end up in the trace.
 */
export const PERF_LABELS = [
  'feed_fetch_total',
  'feed_edge_rank',
  'feed_local_rank',
  'cache_read',
  'cache_read_timeout',
  'combo_compute',
  'combo_ready_before_swipe_yes',
  'combo_ready_before_swipe_no',
  'swipe_to_next_ready',
  'js_long_task',
] as const;

export type PerfLabel = (typeof PERF_LABELS)[number];

export interface PerfEntry {
  label: PerfLabel;
  /** Duration in milliseconds; 0 for counted marks. */
  ms: number;
  /** Wall-clock time of the record (epoch ms). */
  at: number;
}

export interface PerfSummaryRow {
  label: PerfLabel;
  n: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

export const PERF_TRACE_CAPACITY = 500;

const KNOWN_LABELS: ReadonlySet<string> = new Set(PERF_LABELS);
const NOOP = (): void => {};

let override: boolean | null = null;
export const setPerfTraceOverrideForTests = (value: boolean | null): void => {
  override = value;
};

export const perfTraceEnabled = (): boolean =>
  override ?? (__DEV__ || process.env.EXPO_PUBLIC_PERF_TRACE === '1');

const buffer: (PerfEntry | undefined)[] = new Array<PerfEntry | undefined>(PERF_TRACE_CAPACITY);
let nextSlot = 0;
let size = 0;

export const resetPerfTrace = (): void => {
  buffer.fill(undefined);
  nextSlot = 0;
  size = 0;
};

/** Oldest first. */
export const perfTraceEntries = (): PerfEntry[] => {
  const ordered = size < PERF_TRACE_CAPACITY
    ? buffer.slice(0, size)
    : [...buffer.slice(nextSlot), ...buffer.slice(0, nextSlot)];
  return ordered.filter((entry): entry is PerfEntry => entry !== undefined);
};

export const recordMs = (label: PerfLabel, ms: number): void => {
  if (!perfTraceEnabled() || !KNOWN_LABELS.has(label) || !Number.isFinite(ms)) return;
  buffer[nextSlot] = { label, ms: Math.max(0, ms), at: Date.now() };
  nextSlot = (nextSlot + 1) % PERF_TRACE_CAPACITY;
  size = Math.min(size + 1, PERF_TRACE_CAPACITY);
};

/** Counted event with no duration. */
export const mark = (label: PerfLabel): void => recordMs(label, 0);

/** Returns a function that records the elapsed time once; a shared no-op while disabled. */
export const begin = (label: PerfLabel): (() => void) => {
  if (!perfTraceEnabled()) return NOOP;
  const startedAt = performance.now();
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    recordMs(label, performance.now() - startedAt);
  };
};

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';

/** Times `work` (sync or async, success or failure) and passes its result or error through. */
export function span<T>(label: PerfLabel, work: () => T): T {
  if (!perfTraceEnabled()) return work();
  const end = begin(label);
  let result: T;
  try {
    result = work();
  } catch (error) {
    end();
    throw error;
  }
  if (isThenable(result)) {
    return result.then(
      (value) => { end(); return value; },
      (error: unknown) => { end(); throw error; },
    ) as unknown as T;
  }
  end();
  return result;
}

const round = (value: number): number => Math.round(value * 10) / 10;

export const summarizePerfTrace = (): PerfSummaryRow[] => {
  const byLabel = new Map<PerfLabel, number[]>();
  for (const entry of perfTraceEntries()) {
    const values = byLabel.get(entry.label) ?? [];
    values.push(entry.ms);
    byLabel.set(entry.label, values);
  }
  return [...byLabel.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([label, values]) => {
      const sorted = [...values].sort((left, right) => left - right);
      const middle = sorted.length / 2;
      const median = sorted.length % 2 === 1
        ? sorted[Math.floor(middle)]
        : (sorted[middle - 1] + sorted[middle]) / 2;
      const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
      return { label, n: sorted.length, medianMs: round(median), p95Ms: round(p95), maxMs: round(sorted[sorted.length - 1]) };
    });
};

export const formatPerfSummary = (rows: readonly PerfSummaryRow[]): string =>
  rows.map(row => `${row.label} n=${row.n} med=${row.medianMs} p95=${row.p95Ms} max=${row.maxMs}`).join('\n');

/** Writes the summary to the console and returns the same text; empty while disabled. */
export const logPerfSummary = (): string => {
  if (!perfTraceEnabled()) return '';
  const rows = summarizePerfTrace();
  try { console.info(JSON.stringify({ type: 'perf_trace_summary', rows })); } catch { /* Diagnostics cannot fail work. */ }
  return formatPerfSummary(rows);
};

// Hermes has no PerformanceObserver "longtask" entry, so JS thread blocking is estimated from timer
// drift: a 50 ms timer that fires more than 50 ms late means the JS thread was busy for about that long.
const LONG_TASK_INTERVAL_MS = 50;
const LONG_TASK_THRESHOLD_MS = 50;
let watchTimer: ReturnType<typeof setTimeout> | null = null;

export const startLongTaskWatch = (): void => {
  if (!perfTraceEnabled() || watchTimer !== null) return;
  let expectedAt = performance.now() + LONG_TASK_INTERVAL_MS;
  const tick = (): void => {
    const now = performance.now();
    const drift = now - expectedAt;
    if (drift > LONG_TASK_THRESHOLD_MS) recordMs('js_long_task', drift);
    expectedAt = now + LONG_TASK_INTERVAL_MS;
    watchTimer = setTimeout(tick, LONG_TASK_INTERVAL_MS);
  };
  watchTimer = setTimeout(tick, LONG_TASK_INTERVAL_MS);
};

export const stopLongTaskWatch = (): void => {
  if (watchTimer !== null) clearTimeout(watchTimer);
  watchTimer = null;
};

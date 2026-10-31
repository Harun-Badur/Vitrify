import { recordDiscoverStage } from '../../lib/discoverStageTiming';
import { perfEnabled, perfLog } from '../../lib/perfLog';
import { withRecommendationMemo, type RecommendationMemo } from '../../lib/recommendationMemo';

export interface CooperativeWorkOptions {
  /** Numeric diagnostics only; never changes scheduling or budgets. */
  diagnosticStage?: 'catalog' | 'ranking' | 'selection';
  signal?: AbortSignal;
  /** Bound each JS work slice, rather than merely delaying a single large callback. */
  budgetMs?: number;
  /** Re-read priority between slices when a prepared product becomes active. */
  sliceBudgetMs?: () => number;
  /** Pause off-window preparation without discarding its generator/promise. */
  waitForTurn?: () => Promise<void>;
  recommendationMemo?: RecommendationMemo;
}

const aborted = (): Error => Object.assign(new Error('Work cancelled'), { name: 'AbortError' });
const checkAbort = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw aborted();
};

interface NativeHostScheduler {
  unstable_LowPriority: number;
  unstable_scheduleCallback(priority: number, callback: () => void): unknown;
  unstable_cancelCallback(task: unknown): void;
}
let reportedHost: string | undefined;
const yieldToHost = (signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  checkAbort(signal);
  const candidate = (globalThis as typeof globalThis & { nativeRuntimeScheduler?: NativeHostScheduler }).nativeRuntimeScheduler;
  const scheduler = candidate && typeof candidate.unstable_scheduleCallback === 'function'
    && typeof candidate.unstable_cancelCallback === 'function' && typeof candidate.unstable_LowPriority === 'number'
    ? candidate : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let task: unknown;
  const onAbort = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    if (task !== undefined) scheduler?.unstable_cancelCallback(task);
    signal?.removeEventListener('abort', onAbort);
    reject(aborted());
  };
  const finish = (): void => {
    signal?.removeEventListener('abort', onAbort);
    if (signal?.aborted) reject(aborted()); else resolve();
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    if (__DEV__) {
      const kind = scheduler ? 'scheduler.native' : 'scheduler.timer';
      if (reportedHost !== kind) { reportedHost = kind; recordDiscoverStage(kind, 0); }
    }
    // Native tasks return to the host queue at low priority instead of waiting for
    // another frame's timer batch. Per-slice CPU budgets/priority gates stay intact.
    if (scheduler) task = scheduler.unstable_scheduleCallback(scheduler.unstable_LowPriority, finish);
    else timer = setTimeout(finish, 0);
  } catch (error) {
    signal?.removeEventListener('abort', onAbort);
    reject(error);
  }
});

export const runSynchronously = <T>(work: Generator<void, T, void>): T => {
  let step = work.next();
  while (!step.done) step = work.next();
  return step.value;
};

export const runCooperatively = async <T>(
  work: Generator<void, T, void>, options: CooperativeWorkOptions = {},
): Promise<T> => {
  const { signal } = options;
  const diagnostic = __DEV__ ? options.diagnosticStage : undefined;
  const totalStarted = diagnostic ? performance.now() : 0;
  let cpuMs = 0, maxSliceMs = 0, completed = false;
  try {
    await yieldToHost(signal);
    for (;;) {
      if (options.waitForTurn) await options.waitForTurn();
      checkAbort(signal);
      const budget = Math.max(1, options.sliceBudgetMs?.() ?? options.budgetMs ?? 4);
      const started = performance.now();
      try {
        for (;;) {
          const step = withRecommendationMemo(options.recommendationMemo, () => work.next());
          if (step.done) { completed = true; return step.value; }
          if (performance.now() - started >= budget) break;
        }
      } finally {
        if (perfEnabled()) {
          const sliceMs = performance.now() - started;
          if (sliceMs > 30) perfLog('rec_slice', { ms: sliceMs, stage: options.diagnosticStage ?? 'none' });
        }
        if (diagnostic) {
          const elapsed = performance.now() - started;
          cpuMs += elapsed; maxSliceMs = Math.max(maxSliceMs, elapsed);
        }
      }
      await yieldToHost(signal);
    }
  } finally {
    if (diagnostic) {
      const elapsed = performance.now() - totalStarted;
      recordDiscoverStage(`cpu.${diagnostic}`, cpuMs, !completed);
      recordDiscoverStage(`wait.${diagnostic}`, Math.max(0, elapsed - cpuMs), !completed);
      recordDiscoverStage(`slice.${diagnostic}`, maxSliceMs, !completed);
    }
  }
};

/** Stable ordering, including comparator ties, with checkpoints inside the sort. */
export function* cooperativeSort<T>(
  values: T[], compare: (left: T, right: T) => number,
): Generator<void, T[], void> {
  let source = values;
  let target = new Array<T>(values.length);
  for (let width = 1; width < values.length; width *= 2) {
    for (let start = 0; start < values.length; start += width * 2) {
      const middle = Math.min(start + width, values.length);
      const end = Math.min(start + width * 2, values.length);
      let left = start, right = middle;
      for (let index = start; index < end; index++) {
        target[index] = left < middle && (right >= end || compare(source[left], source[right]) <= 0)
          ? source[left++] : source[right++];
        yield;
      }
    }
    [source, target] = [target, source];
  }
  return source;
}

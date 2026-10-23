import { runCooperatively } from '../src/intelligence/cooperativeWork';
import { measureDiscoverStage, takeDiscoverStageTotals } from '../lib/discoverStageTiming';

test('records timing aggregates without retaining work inputs, outputs or errors', async () => {
  takeDiscoverStageTotals();
  const value = { sensitive: 'never-record-this' };
  expect(await measureDiscoverStage('catalog.products', async () => value)).toBe(value);
  await expect(measureDiscoverStage('catalog.attributes', async () => { throw new Error('never-record-error'); })).rejects.toThrow('never-record-error');
  const totals = takeDiscoverStageTotals();
  expect(totals['catalog.products']).toMatchObject({ calls: 1, failures: 0 });
  expect(totals['catalog.attributes']).toMatchObject({ calls: 1, failures: 1 });
  expect(JSON.stringify(totals)).not.toMatch(/never-record/);
});


test('separates cooperative CPU slices from host waiting without changing the result', async () => {
  takeDiscoverStageTotals();
  function* work() { yield; yield; return 'same-result'; }
  expect(await runCooperatively(work(), { diagnosticStage: 'ranking' })).toBe('same-result');
  const totals = takeDiscoverStageTotals();
  expect(totals['cpu.ranking']).toMatchObject({ calls: 1, failures: 0 });
  expect(totals['wait.ranking']?.totalMs).toBeGreaterThanOrEqual(0);
  expect(totals['slice.ranking']?.maxMs).toBeLessThanOrEqual(totals['cpu.ranking']!.totalMs);
});


test('uses cancellable native low-priority host tasks while preserving timer fallback and result', async () => {
  const host = globalThis as typeof globalThis & { nativeRuntimeScheduler?: unknown };
  const previous = host.nativeRuntimeScheduler;
  const callbacks: (() => void)[] = [];
  const task = {};
  const native = { unstable_LowPriority: 4,
    unstable_scheduleCallback: jest.fn((_priority: number, callback: () => void) => { callbacks.push(callback); return task; }),
    unstable_cancelCallback: jest.fn() };
  host.nativeRuntimeScheduler = native;
  try {
    function* work() { return 'unchanged'; }
    const result = runCooperatively(work());
    expect(native.unstable_scheduleCallback).toHaveBeenCalledWith(4, expect.any(Function));
    callbacks.shift()!();
    expect(await result).toBe('unchanged');
    const controller = new AbortController();
    const cancelled = runCooperatively(work(), { signal: controller.signal });
    const rejection = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejection;
    expect(native.unstable_cancelCallback).toHaveBeenCalledWith(task);
  } finally { host.nativeRuntimeScheduler = previous; }
});

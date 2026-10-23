/** Numeric-only development diagnostics. Never retains identifiers, payloads or errors. */
export type DiscoverStage = 'catalog.products' | 'catalog.attributes' | 'catalog.prepare' | 'catalog.resolve'
  | 'catalog.pool' | 'catalog.total' | 'catalog.cache' | 'cache.backend' | 'ranking.prepare' | 'ranking.select'
  | 'recommendation.resolve' | 'cache.key' | 'cache.serialize' | 'cache.hydrate'
  | 'transport.products' | 'transport.attributes' | 'transport.cache' | 'transport.body' | 'json.parse'
  | 'image.memory' | 'image.disk' | 'image.none' | 'scheduler.native' | 'scheduler.timer'
  | `cpu.${'catalog' | 'ranking' | 'selection'}` | `wait.${'catalog' | 'ranking' | 'selection'}` | `slice.${'catalog' | 'ranking' | 'selection'}`;
type Total = { calls: number; failures: number; totalMs: number; maxMs: number };
const totals: Partial<Record<DiscoverStage, Total>> = {};
export function recordDiscoverStage(stage: DiscoverStage, elapsedMs: number, failed = false): void {
  if (!__DEV__) return;
  const elapsed = Math.max(0, elapsedMs);
  const total = totals[stage] ??= { calls: 0, failures: 0, totalMs: 0, maxMs: 0 };
  total.calls++; total.failures += Number(failed); total.totalMs += elapsed; total.maxMs = Math.max(total.maxMs, elapsed);
  try { console.info(JSON.stringify({ type: 'discover_stage_timing', stage, elapsedMs: elapsed, failed })); } catch { /* Diagnostics cannot fail work. */ }
}
export async function measureDiscoverStage<T>(stage: DiscoverStage, work: () => PromiseLike<T>): Promise<T> {
  if (!__DEV__) return work();
  const started = performance.now(); let failed = false;
  try { return await work(); } catch (error) { failed = true; throw error; }
  finally { recordDiscoverStage(stage, performance.now() - started, failed); }
}
export function measureDiscoverStageSync<T>(stage: DiscoverStage, work: () => T): T {
  if (!__DEV__) return work();
  const started = performance.now(); let failed = false;
  try { return work(); } catch (error) { failed = true; throw error; }
  finally { recordDiscoverStage(stage, performance.now() - started, failed); }
}
export function takeDiscoverStageTotals(): Partial<Record<DiscoverStage, Total>> {
  const result = { ...totals };
  for (const stage of Object.keys(totals) as DiscoverStage[]) delete totals[stage];
  return result;
}

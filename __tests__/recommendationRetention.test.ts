import { recommendationCacheCutoff, RECOMMENDATION_CACHE_MAX_AGE_MS } from '../src/recommendationCache/retention';
import { purgeRecommendationCache } from '../scripts/lib/recommendationRetention';
import { SupabaseRecommendationRecordStore } from '../scripts/lib/supabaseRecommendationCache';
import { createRankingCacheKey } from '../src/recommendationCache/fingerprint';

function client(error: unknown = null) {
  const calls: unknown[][] = [];
  const query = { eq: (a: string, b: unknown) => { calls.push(['eq', a, b]); return query; },
    neq: (a: string, b: unknown) => { calls.push(['neq', a, b]); return query; },
    lte: (a: string, b: unknown) => { calls.push(['lte', a, b]); return query; },
    gt: (a: string, b: unknown) => { calls.push(['gt', a, b]); return query; },
    select: () => query, delete: () => { calls.push(['delete']); return query; },
    maybeSingle: async () => ({ data: null, error }),
    then: (resolve: (result: { error: unknown }) => unknown) => Promise.resolve(resolve({ error })) };
  return { calls, value: { from: () => query } };
}
it('has an explicit seven-day boundary and no sliding read renewal', () => {
  expect(recommendationCacheCutoff(RECOMMENDATION_CACHE_MAX_AGE_MS)).toBe('1970-01-01T00:00:00.000Z');
  expect(() => recommendationCacheCutoff(Number.NaN)).toThrow();
});
it('read eligibility requires age and the existing engine/catalog versions', async () => {
  const c = client();
  const key = createRankingCacheKey({ input: { catalogProducts: [], wardrobeItems: [], firstOnly: true } });
  expect(await new SupabaseRecommendationRecordStore(c.value as never).read(key)).toBeUndefined();
  expect(c.calls).toContainEqual(['eq', 'engine_version', key.engineVersion]);
  expect(c.calls).toContainEqual(['eq', 'catalog_version', key.catalogVersion]);
  expect(c.calls.find(row => row[0] === 'gt')?.[1]).toBe('updated_at');
  expect(c.calls.some(row => row[0] === 'delete')).toBe(false);
});
it('purge is scope-bound and catalog invalidation is anchor-bound', async () => {
  const c = client();
  await purgeRecommendationCache(c.value as never, { scope: 'u', engineVersion: 'v1', now: RECOMMENDATION_CACHE_MAX_AGE_MS,
    catalog: { anchorId: 'a', version: 'c1' } });
  expect(c.calls.filter(row => row[0] === 'eq' && row[1] === 'scope')).toHaveLength(3);
  expect(c.calls).toContainEqual(['lte', 'updated_at', '1970-01-01T00:00:00.000Z']);
  expect(c.calls).toContainEqual(['eq', 'anchor_product_id', 'a']);
  const failing = client(new Error('delete failed'));
  await expect(purgeRecommendationCache(failing.value as never, { scope: 'u', engineVersion: 'v1', now: Date.now() })).rejects.toThrow();
});
it('persistent reads reject the exact seven-day boundary and mismatched versions', async () => {
  const now = 10 * RECOMMENDATION_CACHE_MAX_AGE_MS, clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  try {
    const key = createRankingCacheKey({ input: { catalogProducts: [], wardrobeItems: [], firstOnly: true } });
    const row = { engine: key.engineVersion, catalog: key.catalogVersion, at: now - RECOMMENDATION_CACHE_MAX_AGE_MS };
    let engine: string | undefined, catalog: string | undefined, cutoff: number | undefined;
    const query = { select: () => query, eq: (column: string, value: string) => {
      if (column === 'engine_version') engine = value; if (column === 'catalog_version') catalog = value; return query;
    }, gt: (_column: string, value: string) => { cutoff = Date.parse(value); return query; },
    maybeSingle: async () => ({ error: null, data: (engine === undefined || engine === row.engine) &&
      (catalog === undefined || catalog === row.catalog) && (cutoff === undefined || row.at > cutoff) ? { payload: 'record' } : null }) };
    const store = new SupabaseRecommendationRecordStore({ from: () => query } as never);
    expect(await store.read(key)).toBeUndefined();
    row.at++; expect(await store.read(key)).toBe('record');
    row.engine = 'obsolete'; expect(await store.read(key)).toBeUndefined();
    row.engine = key.engineVersion; row.catalog = 'obsolete'; expect(await store.read(key)).toBeUndefined();
  } finally { clock.mockRestore(); }
});

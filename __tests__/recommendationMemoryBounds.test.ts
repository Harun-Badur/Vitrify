import { DiscoverRecommendationCache } from '../lib/discoverRecommendationCache';
import { BoundedRecentSet } from '../lib/boundedRecentSet';
import { serializeFinal } from '../src/recommendationCache/codec';
import { anchorContext, type RecommendationFeedPacket } from '../src/recommendationCache/feedPacket';
import { createFinalCacheKey, type RecommendationCacheKey } from '../src/recommendationCache/fingerprint';
import { RecommendationMemoryCache } from '../src/recommendationCache/memoryCache';
import { getDiscoverRecommendations } from '../src/intelligence/recommendations/getDiscoverRecommendations';
import { legacyFinalFingerprint } from './fixtures/legacyRecommendationCacheKey';
import type { Product } from '../types/product';

const top: Product = { id: 'bound-top', title: 'Top', price: 100, brand: 'Brand', category: 'upper_body',
  outfitRole: 'top', imageUrl: 'top.jpg', garmentDescription: 'Top', gender: 'women' };
const catalog: Product[] = [top,
  { ...top, id: 'bound-bottom', category: 'lower_body', outfitRole: 'bottom' },
  { ...top, id: 'bound-shoes', category: 'shoes', outfitRole: 'shoes' },
  { ...top, id: 'bound-bag', category: 'bags', outfitRole: 'bag' }];

function packet(cache: DiscoverRecommendationCache, anchor: Product, exposure: [string, number][]): RecommendationFeedPacket {
  const request = cache.request([anchor], 1);
  const context = anchorContext(cache.catalog, anchor, cache.wardrobe, new Map(exposure));
  return { sessionId: request.sessionId, generation: 1, contextFingerprint: request.contextFingerprint,
    entries: [{ anchorProductId: anchor.id, exposure, serialized: serializeFinal(getDiscoverRecommendations(context.input), context) }] };
}
const entryCount = (cache: DiscoverRecommendationCache, product: Product) =>
  ((cache as unknown as { entries: Map<string, unknown[]> }).entries.get(product.id) ?? []).length;

describe('bounded recommendation memory', () => {
  it('memory cache records keep a short key after hashing (80-product pool)', () => {
    const pool = Array.from({ length: 80 }, (_, index) => ({ ...top, id: `pool-${index}` }));
    const memory = new RecommendationMemoryCache();
    const context = anchorContext(pool, pool[0], [], new Map([['pool-1', 1]]));
    memory.setFinal(createFinalCacheKey(context), []);
    const sizes: number[] = [];
    memory.invalidate((key: RecommendationCacheKey) => { sizes.push(JSON.stringify(key).length); return false; });
    expect(sizes).toHaveLength(1);
    expect(sizes[0]).toBeLessThan(1_000);
    expect(legacyFinalFingerprint(context).length).toBeGreaterThan(50 * sizes[0]);
  });

  it('an exact duplicate packet is accepted without storing a second entry; lookups are unchanged', () => {
    const cache = new DiscoverRecommendationCache(catalog, [], null);
    const first = packet(cache, top, []);
    expect(cache.accept(first, [top])).toBe(true);
    const result = cache.lookup(top);
    expect(cache.accept(packet(cache, top, []), [top])).toBe(true);
    expect(entryCount(cache, top)).toBe(1);
    expect(cache.lookup(top)).toBe(result);
    expect(cache.peekPrepared(top)).toBe(result);
    // A different exposure is a different entry.
    expect(cache.accept(packet(cache, top, [['bound-bag', 1]]), [top])).toBe(true);
    expect(entryCount(cache, top)).toBe(2);
  });

  it('caps entries per anchor by dropping only exposures the session can never reach again', () => {
    const cache = new DiscoverRecommendationCache(catalog, [], null);
    cache.exposure.set('bound-bag', 3);
    // Unreachable: counts below the current (monotonic) exposure.
    for (let count = 0; count < 3; count += 1) {
      for (let other = 0; other < 8; other += 1) cache.accept(packet(cache, top, [['bound-bag', count], ['bound-shoes', other]]), [top]);
    }
    const live = packet(cache, top, [['bound-bag', 3]]);
    cache.accept(live, [top]);
    expect(entryCount(cache, top)).toBeLessThanOrEqual(16);
    expect(cache.lookup(top)).toStrictEqual(getDiscoverRecommendations(anchorContext(catalog, top, [], new Map([['bound-bag', 3]])).input));
    // Reachable future exposures are never dropped, even above the cap.
    for (let more = 4; more < 24; more += 1) cache.accept(packet(cache, top, [['bound-bag', more]]), [top]);
    expect(entryCount(cache, top)).toBe(21);
  });

  it('never prunes a shown anchor (undo keeps its entries)', () => {
    const cache = new DiscoverRecommendationCache(catalog, [], null);
    cache.accept(packet(cache, top, []), [top]);
    cache.activate(top);
    const pinned = cache.lookup(top);
    cache.exposure.set('bound-shoes', 50);
    // Pinned anchors are skipped by accept; a shown-but-unpinned object identity still keeps every entry.
    const copy = { ...top };
    for (let count = 0; count < 20; count += 1) cache.accept(packet(cache, copy, [['bound-shoes', count]]), [copy]);
    expect(entryCount(cache, top)).toBe(21);
    for (let count = 0; count < 20; count += 1) cache.accept(packet(cache, catalog[1], [['bound-shoes', count]]), [catalog[1]]);
    expect(entryCount(cache, catalog[1])).toBeLessThanOrEqual(16);
    expect(cache.lookup(top)).toBe(pinned);
  });
});

describe('BoundedRecentSet', () => {
  it('keeps at most limit values, evicting the oldest; has/add/delete keep Set semantics', () => {
    const set = new BoundedRecentSet<string>(3);
    ['a', 'b', 'c'].forEach(value => set.add(value));
    expect(set.has('a')).toBe(true);
    set.add('d');
    expect(set.has('a')).toBe(false);
    expect(['b', 'c', 'd'].every(value => set.has(value))).toBe(true);
    set.add('b'); set.add('e');
    expect(set.has('c')).toBe(false); expect(set.has('b')).toBe(true);
    set.delete('b'); expect(set.has('b')).toBe(false);
    expect(set.size).toBe(2);
    expect(() => new BoundedRecentSet(0)).toThrow(RangeError);
  });
});

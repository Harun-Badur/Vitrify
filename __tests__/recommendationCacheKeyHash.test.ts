import { createHash } from 'node:crypto';
import type { Product } from '../types/product';
import { cacheKeyHash, createFinalCacheKey, createRankingCacheKey, fingerprint, sha256Hex,
  type CacheContext } from '../src/recommendationCache/fingerprint';
import { hydrateFinal, serializeFinal } from '../src/recommendationCache/codec';
import { anchorContext } from '../src/recommendationCache/feedPacket';
import { RecommendationMemoryCache } from '../src/recommendationCache/memoryCache';
import { getDiscoverRecommendations } from '../src/intelligence/recommendations/getDiscoverRecommendations';
import { ProductRepository } from '../services/productRepository';
import { legacyFinalFingerprint, legacyRankingFingerprint } from './fixtures/legacyRecommendationCacheKey';

const top: Product = { id: 'top', title: 'Üst çğış', category: 'upper_body', outfitRole: 'top', price: 100,
  brand: 'Brand', imageUrl: 'top.jpg', garmentDescription: 'Top', fit: undefined, gender: 'women' };
const bottom: Product = { ...top, id: 'bottom', title: 'Bottom', category: 'lower_body', outfitRole: 'bottom' };
const shoes: Product = { ...top, id: 'shoes', title: 'Shoes', category: 'shoes', outfitRole: 'shoes' };
const bag: Product = { ...top, id: 'bag', title: 'Bag', category: 'bags', outfitRole: 'bag' };
const catalog = [top, bottom, shoes, bag];
const pool80 = (): Product[] => Array.from({ length: 80 }, (_, index) => ({ ...top, id: `p${index}`, title: `Product ${index}`,
  colors: [{ name: 'Siyah', hex: '#000000' }, { name: 'Beyaz', hex: '#ffffff' }], colorSlugs: ['black'], productUrl: `https://example.test/p/${index}` }));
const isHex = (value: string, length = 64) => new RegExp(`^[0-9a-f]{${length}}$`).test(value);

describe('short deterministic recommendation cache keys', () => {
  it('sha256Hex matches node:crypto, including multi-byte UTF-8 and long input', () => {
    for (const text of ['', 'abc', 'çğışöüÇĞİŞÖÜ €𝄞', 'x'.repeat(100_003)]) {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    }
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('backend cache_key_hash comes from the same function and stays sha256(key.fingerprint)', () => {
    const context = anchorContext(catalog, top, [], new Map([['bag', 2]]), 'catalog-v1');
    for (const key of [createRankingCacheKey(context), createFinalCacheKey(context)]) {
      expect(cacheKeyHash(key)).toBe(createHash('sha256').update(key.fingerprint).digest('hex'));
    }
    // Golden pin: changing key derivation must be a deliberate, reviewed change.
    expect(createFinalCacheKey(context).fingerprint).toBe(GOLDEN_FINAL_FINGERPRINT);
    expect(cacheKeyHash(createFinalCacheKey(context))).toBe(GOLDEN_FINAL_CACHE_KEY_HASH);
  });

  it('produces short keys: every key field is a 64-hex digest, so a memory record key is small', () => {
    const pool = pool80();
    const key = createFinalCacheKey(anchorContext(pool, pool[3], [], new Map([['p1', 1]])));
    for (const field of ['fingerprint', 'catalogFingerprint', 'wardrobeFingerprint', 'anchorFingerprint',
      'contextFingerprint', 'rankingFingerprint', 'exposureFingerprint'] as const) expect(isHex(key[field])).toBe(true);
    const newSize = JSON.stringify(key).length;
    const legacySize = legacyFinalFingerprint(anchorContext(pool, pool[3], [], new Map([['p1', 1]]))).length;
    expect(newSize).toBeLessThan(1_000);
    expect(legacySize).toBeGreaterThan(50 * newSize);
  });

  it('same input gives the same key, also for structurally equal copies', () => {
    const pool = pool80();
    const copy = pool.map(product => ({ ...product, colors: [...product.colors!] }));
    const exposure = new Map([['p2', 1], ['p1', 3]]);
    expect(createFinalCacheKey(anchorContext(pool, pool[0], [], exposure)))
      .toEqual(createFinalCacheKey(anchorContext(copy, copy[0], [], new Map([['p1', 3], ['p2', 1]]))));
  });

  it('changes the key when exposure counts, candidates, product fields or order change', () => {
    const pool = pool80();
    const base = createFinalCacheKey(anchorContext(pool, pool[0], [], new Map([['p1', 1]]))).fingerprint;
    const variants = [
      anchorContext(pool, pool[0], [], new Map([['p1', 2]])),
      anchorContext(pool, pool[0], [], new Map([['p1', 1], ['p2', 1]])),
      anchorContext(pool, pool[0], [], new Map()),
      anchorContext(pool.slice(0, 79), pool[0], [], new Map([['p1', 1]])),
      anchorContext([...pool.slice(0, 79), { ...pool[79], id: 'other' }], pool[0], [], new Map([['p1', 1]])),
      anchorContext([pool[0], pool[2], pool[1], ...pool.slice(3)], pool[0], [], new Map([['p1', 1]])),
      anchorContext(pool.map((product, index) => index === 40 ? { ...product, currentPrice: 1 } : product), pool[0], [], new Map([['p1', 1]])),
      anchorContext(pool, pool[1], [], new Map([['p1', 1]])),
      anchorContext(pool, pool[0], [{ id: 'w', category: 'top' }], new Map([['p1', 1]])),
      anchorContext(pool, pool[0], [], new Map([['p1', 1]]), 'catalog-v2'),
    ];
    const keys = variants.map(context => createFinalCacheKey(context).fingerprint);
    expect(new Set([base, ...keys]).size).toBe(keys.length + 1);
    // Like the legacy keys: absent and empty exposure are the same final context.
    expect(createFinalCacheKey(anchorContext(pool, pool[0], [], undefined)).fingerprint)
      .toBe(createFinalCacheKey(anchorContext(pool, pool[0], [], new Map())).fingerprint);
    // Ranking ignores exposure only.
    expect(createRankingCacheKey(variants[0]).fingerprint).toBe(createRankingCacheKey(variants[2]).fingerprint);
  });

  it('golden: new keys induce exactly the legacy canonical-key equality relation', () => {
    const pool = pool80();
    const contexts: CacheContext[] = [];
    for (const anchor of [pool[0], pool[5], { ...pool[5] }, { ...pool[5], fit: 'slim' }]) {
      for (const exposure of [undefined, new Map(), new Map([['p1', 1]]), new Map([['p1', 1], ['p7', 2]]), new Map([['p7', 2], ['p1', 1]])]) {
        for (const wardrobe of [[], [{ id: 'w', category: 'top' }]]) {
          contexts.push(anchorContext(pool, anchor, wardrobe, exposure));
          contexts.push(anchorContext(pool, anchor, wardrobe, exposure, 'v1'));
        }
      }
    }
    contexts.push({ input: { ...contexts[0].input, firstOnly: false } }, { input: { ...contexts[0].input, catalogFilters: { gender: 'women' } } },
      { ...contexts[0], engineVersion: 'next' }, { input: { ...contexts[0].input, catalogFilters: undefined } });
    const legacyFinal = contexts.map(legacyFinalFingerprint), nextFinal = contexts.map(context => createFinalCacheKey(context).fingerprint);
    const legacyRanking = contexts.map(legacyRankingFingerprint), nextRanking = contexts.map(context => createRankingCacheKey(context).fingerprint);
    for (let left = 0; left < contexts.length; left += 1) {
      for (let right = 0; right < contexts.length; right += 1) {
        expect([left, right, nextFinal[left] === nextFinal[right]]).toEqual([left, right, legacyFinal[left] === legacyFinal[right]]);
        expect([left, right, nextRanking[left] === nextRanking[right]]).toEqual([left, right, legacyRanking[left] === legacyRanking[right]]);
      }
    }
  });

  it('memoizes: a pool product is canonicalized once per object across anchors and repeated key builds', () => {
    let reads = 0;
    const pool = pool80().map(product => {
      const observed = { ...product };
      let title = observed.title;
      Object.defineProperty(observed, 'title', { enumerable: true, configurable: true,
        get: () => { reads += 1; return title; }, set: value => { title = value; } });
      return observed;
    });
    for (const anchor of pool.slice(0, 10)) {
      const context = anchorContext(pool, anchor, [], new Map([['p1', 1]]));
      createFinalCacheKey(context); createRankingCacheKey(context); createFinalCacheKey(context);
    }
    expect(reads).toBe(pool.length);
  });

  it('invalidates the memo when the catalog changes: new product objects and a different set get new keys', () => {
    const pool = pool80();
    const first = createRankingCacheKey(anchorContext(pool, pool[0], [], new Map()));
    const replaced = pool.map(product => product.id === 'p9' ? { ...product, title: 'Renamed' } : product);
    const second = createRankingCacheKey(anchorContext(replaced, replaced[0], [], new Map()));
    expect(second.catalogFingerprint).not.toBe(first.catalogFingerprint);
    expect(second.fingerprint).not.toBe(first.fingerprint);
    const smaller = createRankingCacheKey(anchorContext(pool.slice(0, 40), pool[0], [], new Map()));
    expect(smaller.catalogFingerprint).not.toBe(first.catalogFingerprint);
    // Back to the original objects: the original key comes back.
    expect(createRankingCacheKey(anchorContext(pool, pool[0], [], new Map()))).toEqual(first);
  });

  it('invalidates the memo when ProductRepository refreshes a canonical product in place', () => {
    const repository = new ProductRepository(async () => []);
    const pool = repository.register(pool80());
    const before = createFinalCacheKey(anchorContext(pool, pool[0], [], new Map()));
    const [refreshed] = repository.register([{ ...pool80()[0], currentPrice: 42 }]);
    expect(refreshed).toBe(pool[0]);
    const after = createFinalCacheKey(anchorContext(pool, pool[0], [], new Map()));
    expect(after.anchorFingerprint).not.toBe(before.anchorFingerprint);
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.fingerprint).toBe(createFinalCacheKey(anchorContext(pool.map(product => ({ ...product })), { ...pool[0] }, [], new Map())).fingerprint);
  });

  it('never memoizes wardrobe items, which are patched in place', () => {
    const item: { id: string; category: string; color?: string } = { id: 'w', category: 'top' };
    const before = createRankingCacheKey(anchorContext(catalog, top, [item]));
    item.color = 'red';
    expect(createRankingCacheKey(anchorContext(catalog, top, [item])).fingerprint).not.toBe(before.fingerprint);
  });

  it('golden: engine selection is identical through the hashed memory/codec path', () => {
    const cache = new RecommendationMemoryCache();
    for (const anchor of catalog) {
      for (const exposure of [new Map<string, number>(), new Map([['bag', 2], ['shoes', 1]])]) {
        const context = anchorContext(catalog, anchor, [], exposure);
        const direct = getDiscoverRecommendations(context.input);
        cache.setFinal(createFinalCacheKey(context), direct);
        const again = anchorContext(catalog, anchor, [], new Map(exposure));
        const hit = cache.getFinal(createFinalCacheKey(again));
        expect(hit.status === 'hit' && hit.value).toBe(direct);
        const hydrated = hydrateFinal(serializeFinal(direct, context), again);
        expect(hydrated).toStrictEqual({ status: 'hit', value: getDiscoverRecommendations(again.input) });
      }
    }
  });

  it('treats a legacy (pre-hash) record as a safe context-mismatch miss, never a throw', () => {
    const context = anchorContext(catalog, top, [], new Map());
    const payload = JSON.parse(serializeFinal(getDiscoverRecommendations(context.input), context));
    payload.envelope.key = legacyFinalFingerprint(context);
    payload.integrity = fingerprint(payload.envelope);
    expect(() => hydrateFinal(JSON.stringify(payload), context)).not.toThrow();
    expect(hydrateFinal(JSON.stringify(payload), context)).toEqual({ status: 'miss', reason: 'context-mismatch' });
  });
});

const GOLDEN_FINAL_FINGERPRINT = '339e2f45e5b5f0c85e4347499b9a0b2452a9e7faba4ce3dd7fa8f735c664f5ed';
const GOLDEN_FINAL_CACHE_KEY_HASH = '16d26f15a025e4e8da20ef110dc65188a12925100b0364e635a0274640319fd0';

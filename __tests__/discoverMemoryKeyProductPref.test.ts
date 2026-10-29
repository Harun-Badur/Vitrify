import { anchorContext } from '../src/recommendationCache/feedPacket';
import { createFinalCacheKey, createRankingCacheKey } from '../src/recommendationCache/fingerprint';
import { RecommendationMemoryCache } from '../src/recommendationCache/memoryCache';
import { DiscoverRecommendationCache } from '../lib/discoverRecommendationCache';
import type { Product } from '../types/product';

const base: Product = { id: 'k-top', title: 'Top', price: 100, brand: 'Brand', category: 'upper_body',
  outfitRole: 'top', imageUrl: 'top.jpg', garmentDescription: 'Top', gender: 'unisex' };
const kadinPool: Product[] = [base,
  { ...base, id: 'k-bottom', category: 'lower_body', outfitRole: 'bottom', gender: 'kadin' }];
const hepsiPool: Product[] = [...kadinPool,
  { ...base, id: 'e-bottom', category: 'lower_body', outfitRole: 'bottom', gender: 'erkek' }];

// The in-session memory cache has no productPref in its key; the key must still differ whenever
// the preference changes the pool, because the pool content is part of the fingerprint.
describe('in-session memory cache keys follow the preference-scoped pool', () => {
  it('ranking and final keys differ between a hepsi pool and a kadin pool', () => {
    const hepsi = anchorContext(hepsiPool, hepsiPool[0], [], new Map());
    const kadin = anchorContext(kadinPool, kadinPool[0], [], new Map());
    expect(createRankingCacheKey(hepsi).fingerprint).not.toBe(createRankingCacheKey(kadin).fingerprint);
    expect(createFinalCacheKey(hepsi).fingerprint).not.toBe(createFinalCacheKey(kadin).fingerprint);
  });

  it('a stored hepsi final is not returned for the kadin key', () => {
    const memory = new RecommendationMemoryCache();
    const hepsiKey = createFinalCacheKey(anchorContext(hepsiPool, hepsiPool[0], [], new Map()));
    memory.setFinal(hepsiKey, []);
    expect(memory.getFinal(hepsiKey).status).toBe('hit');
    expect(memory.getFinal(createFinalCacheKey(anchorContext(kadinPool, kadinPool[0], [], new Map()))).status).not.toBe('hit');
    memory.dispose();
  });

  it('each preference builds its own session, so no memory cache is shared across them', () => {
    const hepsi = new DiscoverRecommendationCache(hepsiPool, [], 'owner', 'hepsi');
    const kadin = new DiscoverRecommendationCache(kadinPool, [], 'owner', 'kadin');
    const erkek = new DiscoverRecommendationCache(kadinPool, [], 'owner', 'erkek');
    expect(new Set([hepsi.sessionId, kadin.sessionId, erkek.sessionId]).size).toBe(3);
    expect(new Set([hepsi.contextFingerprint, kadin.contextFingerprint, erkek.contextFingerprint]).size).toBe(3);
  });
});

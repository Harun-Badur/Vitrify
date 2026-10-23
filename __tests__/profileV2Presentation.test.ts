import { buildStyleJourney } from '../lib/profileStyleJourney';
const input = { userId: 'A', sessionUserId: 'A', sessionSyncStatus: 'success' as const, wardrobeStatus: 'ready' as const, likedProducts: [], passedProductIds: [], wardrobeItems: [], savedOutfits: [], profile: null };
test('five real weight maps have readable labels, ignore nonpositive evidence and retain the computation timestamp', () => {
  const journey = buildStyleJourney({ ...input, calculatedProfile: { state: 'ready', profile: {
    algorithm: 'v2', computedAt: '2026-10-20T10:00:00Z', eventCount: 4,
    snapshot: { userId: 'A', colorW: { kirmizi: 1, siyah: -3 }, subcategoryW: { gomlek: 2 }, fitW: { relaxed: 1 }, brandW: { 'jack-jones': 1 }, priceBandW: { mid: 1, luxury: -4 }, styleTagWeights: {}, negativePreferences: [] },
  } } });
  expect(journey.insights.find(x => x.id === 'color')?.summary).toBe('Kırmızı');
  expect(journey.insights.find(x => x.id === 'category')?.summary).toBe('Gömlek');
  expect(journey.insights.find(x => x.id === 'fit')?.summary).toBe('Rahat kesim');
  expect(journey.insights.find(x => x.id === 'price')?.summary).toBe('Orta fiyat bandı');
  expect(journey.insights.find(x => x.id === 'color')?.detail).toContain('2026-10-20T10:00:00Z');
  expect(journey.percent).toBe(0);
});

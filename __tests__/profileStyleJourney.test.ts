import { buildStyleJourney, type StyleJourneyInput } from '../lib/profileStyleJourney';
import type { Product, LikedProduct } from '../types/product';
import type { UserStudioProfile } from '../types/profile';

const product = (id: string, patch: Partial<Product> = {}): Product => ({
  id, title: 'Fixture', brand: 'Fixture', category: 'upper_body', price: 100,
  imageUrl: 'https://example.invalid/image.jpg', garmentDescription: 'Fixture', ...patch,
});
const like = (p: Product): LikedProduct => ({ product: p, likedAt: '2026-10-12', notifyOnPriceDrop: false });
const input = (patch: Partial<StyleJourneyInput> = {}): StyleJourneyInput => ({
  userId: 'A', sessionUserId: 'A', sessionSyncStatus: 'success', wardrobeStatus: 'ready',
  likedProducts: [], passedProductIds: [], wardrobeItems: [], savedOutfits: [], profile: null, ...patch,
});
const profile: UserStudioProfile = { userId: 'A', heightCm: 170, weightKg: 65, topSize: 'M',
  bottomSize: 'M', styleTags: [], modelPhotoPath: null, priceRange: { min: 100, max: 1000 } };
test('new user starts at zero; manual body/budget does not unlock inferred insights', () => {
  const result = buildStyleJourney(input({ profile }));
  expect(result.percent).toBe(0); expect(result.status).toBe('Henüz keşfedilmedi');
  expect(result.insights.every(item => item.status === 'Henüz keşfedilmedi')).toBe(true);
  expect(result.task.target).toBe('discover');
});
test('partial progress uses distinct current records and never treats pass as a positive preference', () => {
  const p = product('one');
  const result = buildStyleJourney(input({ likedProducts: [like(p), like(p)], passedProductIds: ['one','two','two'] }));
  expect(result.counts.evaluations).toBe(2); expect(result.percent).toBe(10);
  expect(result.status).toBe('Gelişiyor');
  expect(result.insights.find(item => item.id === 'category')?.status).toBe('Henüz keşfedilmedi');
});
test('sufficient actual metadata unlocks descriptive color/category evidence, not personality', () => {
  const liked = Array.from({ length: 5 }, (_, i) => like(product(`p${i}`, { colors: [{ name: 'Siyah', hex: '#111111' }] })));
  const result = buildStyleJourney(input({ likedProducts: liked }));
  expect(result.insights.find(item => item.id === 'color')).toMatchObject({ status: 'Keşfedildi', summary: expect.stringContaining('Siyah') });
  expect(result.insights.find(item => item.id === 'category')).toMatchObject({ status: 'Keşfedildi', summary: expect.stringContaining('Üst Giyim') });
  expect(result.insights.find(item => item.id === 'style')?.status).toBe('Henüz keşfedilmedi');
});
test('title-inferred colors and arbitrary metadata never fabricate a color preference', () => {
  const liked = Array.from({ length: 10 }, (_, i) => like(product(`p${i}`, {
    title: 'Siyah spor minimal', colorSlugs: ['siyah'], colors: [{ name: 'unknown', hex: '#111111' }],
  })));
  const result = buildStyleJourney(input({ likedProducts: liked }));
  expect(result.insights.find(item => item.id === 'color')?.status).toBe('Henüz keşfedilmedi');
  expect(result.insights.find(item => item.id === 'color')?.detail).toContain('metadata');
});
test('weak/tied samples stay developing rather than inventing a dominant color', () => {
  const names = ['Siyah','Beyaz','Bej','Mavi','Yeşil'];
  const result = buildStyleJourney(input({ likedProducts: names.map((name,i) => like(product(`p${i}`, { colors: [{ name, hex: '#111111' }] }))) }));
  expect(result.insights.find(item => item.id === 'color')).toMatchObject({ status: 'Gelişiyor' });
});
test('progress goals are explicit; declared choices are distinct from inferred style', () => {
  const wardrobe = Array.from({ length: 3 }, (_, i) => ({ id: `w${i}`, title: 'Fixture', brand: '', imageUrl: 'file://fixture', category: 'upper_body' as const, createdAt: '2026-10-12' }));
  const outfits = Array.from({ length: 2 }, (_, i) => ({ id: `o${i}`, title: 'Fixture', wardrobeItemIds: ['w0','w1'], catalogProductIds: [], createdAt: '2026-10-12' }));
  const result = buildStyleJourney(input({ passedProductIds: Array.from({ length: 10 },(_,i) => `p${i}`),
    wardrobeItems: wardrobe, savedOutfits: outfits, profile: { ...profile, styleTags: ['minimal'] } }));
  expect(result.percent).toBe(100);
  expect(result.insights.find(item => item.id === 'style')?.status).toBe('Henüz keşfedilmedi');
  expect(result.insights.find(item => item.id === 'outfits')?.status).toBe('Keşfedildi');
});
test('account switch/anonymous/loading never uses old owner records or declared preferences', () => {
  const stale = { likedProducts: [like(product('a'))], passedProductIds: ['b'], profile: { ...profile, styleTags: ['minimal'] as const } };
  const declared = { ...stale, profile: { ...profile, styleTags: ['minimal'] as UserStudioProfile['styleTags'] } };
  expect(buildStyleJourney(input({ ...declared, userId: 'B' })).percent).toBe(0);
  expect(buildStyleJourney(input({ ...declared, userId: null })).percent).toBe(0);
  expect(buildStyleJourney(input({ ...declared, sessionSyncStatus: 'loading' })).counts.evaluations).toBe(0);
  expect(buildStyleJourney(input({ profile: { ...profile, userId: 'B', styleTags: ['minimal'] } })).percent).toBe(0);
});
test('reopening/reordering saved records recomputes the same result; no new persistence', () => {
  const original = input({ likedProducts: Array.from({ length: 5 },(_,i) => like(product(`p${i}`, { colors: [{ name: 'Siyah', hex: '#111111' }] }))) });
  const reopened: StyleJourneyInput = JSON.parse(JSON.stringify(original));
  reopened.likedProducts = [...reopened.likedProducts].reverse();
  expect(buildStyleJourney(reopened)).toEqual(buildStyleJourney(original));
});

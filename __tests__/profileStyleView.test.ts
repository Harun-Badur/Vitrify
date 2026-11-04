import { buildStyleJourney, type StyleJourneyInput } from '../lib/profileStyleJourney';
import {
  STYLE_TREND_MIN_EVALUATIONS, buildJourneyBoxes, buildOnlyYou, buildSourceSheet, buildStyleGrid, evaluationLine,
} from '../lib/profileStyleView';
import { emptyStyleProfile } from '../lib/scoring';
import type { LikedProduct, Product } from '../types/product';
import type { UserStudioProfile } from '../types/profile';
import type { CalculatedStyleProfileState } from '../types/calculatedStyleProfile';
import type { WeightMap } from '../types/recommendation';

const product = (id: string, patch: Partial<Product> = {}): Product => ({
  id, title: 'Fixture', brand: 'Fixture', category: 'upper_body', price: 100,
  imageUrl: 'https://example.invalid/image.jpg', garmentDescription: 'Fixture', ...patch,
});
const like = (p: Product): LikedProduct => ({ product: p, likedAt: '2026-10-12', notifyOnPriceDrop: false });
const likes = (count: number) => Array.from({ length: count }, (_, i) => like(product(`l${i}`)));
const passes = (count: number) => Array.from({ length: count }, (_, i) => `p${i}`);
const wardrobe = (count: number) => Array.from({ length: count }, (_, i) => ({
  id: `w${i}`, title: 'Fixture', brand: '', imageUrl: 'file://fixture', category: 'upper_body' as const, createdAt: '2026-10-12',
}));
const input = (patch: Partial<StyleJourneyInput> = {}): StyleJourneyInput => ({
  userId: 'A', sessionUserId: 'A', sessionSyncStatus: 'success', wardrobeStatus: 'ready',
  likedProducts: [], passedProductIds: [], wardrobeItems: [], savedOutfits: [], profile: null, ...patch,
});
const studio = (patch: Partial<UserStudioProfile> = {}): UserStudioProfile => ({
  userId: 'A', heightCm: null, weightKg: null, topSize: null, bottomSize: null, styleTags: [], modelPhotoPath: null, ...patch,
});
const model = (weights: Partial<{ colorW: WeightMap; subcategoryW: WeightMap; brandW: WeightMap; fitW: WeightMap; priceBandW: WeightMap }>,
  eventCount = 12): CalculatedStyleProfileState => ({
  state: 'ready',
  profile: { snapshot: { ...emptyStyleProfile('A'), ...weights }, algorithm: 'v2', eventCount, computedAt: '2026-10-12T10:00:00Z' },
});

describe('journey boxes', () => {
  test('thresholds match the journey goals: 10 evaluations, 3 wardrobe items, 5/5 declared choices', () => {
    const full = buildStyleJourney(input({
      likedProducts: likes(4), passedProductIds: passes(6), wardrobeItems: wardrobe(3),
      profile: studio({ topSize: 'M', styleTags: ['minimal'], preferredColors: ['Siyah'], favoriteBrands: ['ZARA'], priceRange: { min: 100, max: 500 } }),
    }));
    expect(buildJourneyBoxes(full).map(box => [box.id, box.value, box.state])).toEqual([
      ['liked', '4', 'complete'], ['wardrobe', '3', 'complete'], ['preferences', '5/5', 'complete'],
    ]);
  });
  test('below the thresholds boxes are missing, not complete', () => {
    const partial = buildStyleJourney(input({
      likedProducts: likes(2), passedProductIds: passes(7), wardrobeItems: wardrobe(2),
      profile: studio({ styleTags: ['minimal'], preferredColors: ['Siyah'], favoriteBrands: ['ZARA'], priceRange: { min: 100, max: 500 } }),
    }));
    expect(buildJourneyBoxes(partial).map(box => [box.value, box.state])).toEqual([
      ['2', 'missing'], ['2', 'missing'], ['4/5', 'missing'],
    ]);
  });
  test('liked box shows the liked count while completion follows distinct evaluations', () => {
    const journey = buildStyleJourney(input({ likedProducts: likes(3), passedProductIds: passes(7) }));
    const liked = buildJourneyBoxes(journey)[0];
    expect(liked.value).toBe('3');
    expect(liked.state).toBe('complete');
  });
  test('wardrobe that is not ready shows loading instead of 0', () => {
    const journey = buildStyleJourney(input({ wardrobeStatus: 'loading', wardrobeItems: wardrobe(3) }));
    const box = buildJourneyBoxes(journey)[1];
    expect(box.state).toBe('loading');
    expect(box.value).toBe('Yükleniyor');
    expect(box.value).not.toBe('0');
  });
  test('ratings that are not ready show loading for the liked box too', () => {
    const journey = buildStyleJourney(input({ sessionSyncStatus: 'loading', likedProducts: likes(4) }));
    expect(buildJourneyBoxes(journey)[0]).toMatchObject({ state: 'loading', value: 'Yükleniyor' });
  });
  test('boxes route to the screens that fix them', () => {
    const journey = buildStyleJourney(input());
    expect(buildJourneyBoxes(journey).map(box => box.target)).toEqual(['discover', 'wardrobe', 'preferences']);
  });
  test('evaluation line is the distinct liked-or-passed total', () => {
    const journey = buildStyleJourney(input({ likedProducts: likes(3), passedProductIds: ['l0', ...passes(171)] }));
    expect(journey.counts.evaluations).toBe(174);
    expect(evaluationLine(journey)).toBe('Önerilerin şu an 174 değerlendirmene dayanıyor.');
  });
  test('evaluation line is hidden while ratings are not trustworthy', () => {
    expect(evaluationLine(buildStyleJourney(input({ sessionSyncStatus: 'loading' })))).toBeNull();
    expect(evaluationLine(buildStyleJourney(input({ userId: 'B' })))).toBeNull();
  });
});

describe('style grid', () => {
  test('five boxes in order; price is full width', () => {
    const grid = buildStyleGrid(buildStyleJourney(input({ calculatedProfile: model({}) })));
    expect(grid.state).toBe('ready');
    expect(grid.tiles.map(tile => tile.id)).toEqual(['color', 'category', 'fit', 'brand', 'price']);
    expect(grid.tiles.filter(tile => tile.wide).map(tile => tile.id)).toEqual(['price']);
  });
  test('below the sample threshold a learned value becomes the "Biraz daha beğen" empty state', () => {
    expect(STYLE_TREND_MIN_EVALUATIONS).toBe(5);
    const journey = buildStyleJourney(input({
      passedProductIds: passes(STYLE_TREND_MIN_EVALUATIONS - 1), calculatedProfile: model({ colorW: { siyah: 1 } }),
    }));
    const color = buildStyleGrid(journey).tiles[0];
    expect(color).toMatchObject({ state: 'empty', emptyText: 'Biraz daha beğen', names: [], swatches: [] });
  });
  test('at the threshold the learned value shows with swatches', () => {
    const journey = buildStyleJourney(input({
      passedProductIds: passes(STYLE_TREND_MIN_EVALUATIONS), calculatedProfile: model({ colorW: { siyah: 1, navy: 0.5 } }),
    }));
    const color = buildStyleGrid(journey).tiles[0];
    expect(color.state).toBe('learned');
    expect(color.label).toBeNull();
    expect(color.names).toEqual(['Siyah', 'Lacivert']);
    expect(color.swatches).toEqual(['#111111', '#1F2A44']);
  });
  test('unknown learned colour renders a neutral grey circle', () => {
    const journey = buildStyleJourney(input({ passedProductIds: passes(5), calculatedProfile: model({ colorW: { zzz: 1 } }) }));
    expect(buildStyleGrid(journey).tiles[0].swatches).toEqual(['#D1D5DB']);
  });
  test('enough evaluations but no learned data is "Yeterli veri yok", not the like prompt', () => {
    const journey = buildStyleJourney(input({ passedProductIds: passes(8), calculatedProfile: model({}) }));
    expect(buildStyleGrid(journey).tiles[0]).toMatchObject({ state: 'empty', emptyText: 'Yeterli veri yok' });
  });
  test('parça, kesim and marka use icon, silhouette and a normalised brand badge', () => {
    const journey = buildStyleJourney(input({
      passedProductIds: passes(6),
      calculatedProfile: model({ subcategoryW: { pantolon: 1, bilinmeyen: 0.4 }, fitW: { slim: 1, oversized: 0.5 }, brandW: { lcw: 1, 'jack-jones': 0.3 } }),
    }));
    const [, category, fit, brand] = buildStyleGrid(journey).tiles;
    expect(category.icons).toEqual(['pants', 'shirt']);
    expect(fit.shapes).toEqual(['slim', 'oversized']);
    expect(brand.brands).toEqual(['LC Waikiki', 'Jack & Jones']);
  });
  test('learned price highlights a band and names it; no amount is ever invented', () => {
    const journey = buildStyleJourney(input({ passedProductIds: passes(6), calculatedProfile: model({ priceBandW: { mid: 1 } }) }));
    const price = buildStyleGrid(journey).tiles[4];
    expect(price.band).toEqual({ index: 1, label: 'Orta fiyat bandı' });
    expect(JSON.stringify(price)).not.toContain('₺');
  });
  test('declared choices win over learned ones and carry the "Senin seçimin" label', () => {
    const journey = buildStyleJourney(input({
      passedProductIds: passes(6), profile: studio({ preferredColors: ['Lacivert'], favoriteBrands: ['zara'], priceRange: { min: 100, max: 500 } }),
      calculatedProfile: model({ colorW: { siyah: 1 }, brandW: { koton: 1 }, priceBandW: { high: 1 } }),
    }));
    const [color, , , brand, price] = buildStyleGrid(journey).tiles;
    expect(color).toMatchObject({ state: 'declared', label: 'Senin seçimin', names: ['Lacivert'], swatches: ['#1F2A44'] });
    expect(brand).toMatchObject({ state: 'declared', label: 'Senin seçimin', brands: ['ZARA'] });
    expect(price).toMatchObject({ state: 'declared', label: 'Senin seçimin', declaredText: '₺100 – ₺500', band: null });
  });
  test('a declared choice shows even below the sample threshold', () => {
    const journey = buildStyleJourney(input({ profile: studio({ preferredColors: ['Siyah'] }), calculatedProfile: model({}) }));
    expect(buildStyleGrid(journey).tiles[0].state).toBe('declared');
  });
  test('no per-dimension evidence counts leak into any box', () => {
    const journey = buildStyleJourney(input({ passedProductIds: passes(9), calculatedProfile: model({ colorW: { siyah: 1 } }, 77) }));
    const text = JSON.stringify(buildStyleGrid(journey));
    expect(text).not.toContain('77');
    expect(text).not.toContain('örnek');
  });
  test('a failed calculated profile is an explicit error, never five "Keşfediliyor" boxes', () => {
    const grid = buildStyleGrid(buildStyleJourney(input({ passedProductIds: passes(9), calculatedProfile: { state: 'error' } })));
    expect(grid.state).toBe('error');
    expect(grid.tiles).toEqual([]);
    expect(grid.errorText).toBe('Stil profilin doğrulanamadı.');
    expect(JSON.stringify(grid)).not.toContain('Keşfediliyor');
  });
  test('first load is loading, not an error', () => {
    const grid = buildStyleGrid(buildStyleJourney(input({ calculatedProfile: { state: 'loading' } })));
    expect(grid.state).toBe('loading');
  });
  test('another owner\'s calculated profile is an error, not their data', () => {
    const foreign = model({ colorW: { siyah: 1 } });
    if (foreign.state === 'ready') foreign.profile.snapshot.userId = 'B';
    const grid = buildStyleGrid(buildStyleJourney(input({ passedProductIds: passes(9), calculatedProfile: foreign })));
    expect(grid.state).toBe('error');
  });
});

describe('source sheet', () => {
  const journey = buildStyleJourney(input({
    likedProducts: likes(3), passedProductIds: passes(7), wardrobeItems: wardrobe(2),
    calculatedProfile: model({ colorW: { siyah: 1 }, brandW: { zara: 1 } }),
  }));
  const grid = buildStyleGrid(journey);
  test('learned box: real totals, the fixed sentences and the primary button', () => {
    const sheet = buildSourceSheet(grid.tiles[0], journey);
    expect(sheet.heading).toBe('Nereden öğrendik?');
    expect(sheet.sources.map(source => [source.id, source.count])).toEqual([['liked', 3], ['passed', 7], ['wardrobe', 2]]);
    expect(sheet.sourceNote).toBe('Tüm etkileşimlerinden');
    expect(sheet.note).toBe('Bu bir tahmin. Sen seçersen öneriler senin seçimine göre çalışır.');
    expect(sheet.button).toEqual({ label: 'Renk seç', section: 'colors' });
    expect(sheet.valueText).toBe('Siyah');
  });
  test('the stacked bar fractions add up to the real total', () => {
    const sheet = buildSourceSheet(grid.tiles[0], journey);
    expect(sheet.sources.reduce((sum, source) => sum + source.fraction, 0)).toBeCloseTo(1, 5);
    expect(sheet.sources[0].fraction).toBeCloseTo(0.25, 5);
  });
  test('every dimension opens an existing declaration flow', () => {
    expect(grid.tiles.map(tile => buildSourceSheet(tile, journey).button)).toEqual([
      { label: 'Renk seç', section: 'colors' }, { label: 'Parça seç', section: 'style' },
      { label: 'Kesim seç', section: 'body' }, { label: 'Marka seç', section: 'brands' },
      { label: 'Fiyat seç', section: 'budget' },
    ]);
  });
  test('a declared box says it is the user\'s choice and carries no prediction text or bar', () => {
    const declaredJourney = buildStyleJourney(input({ profile: studio({ preferredColors: ['Siyah'] }), calculatedProfile: model({}) }));
    const sheet = buildSourceSheet(buildStyleGrid(declaredJourney).tiles[0], declaredJourney);
    expect(sheet.declared).toBe(true);
    expect(sheet.sources).toEqual([]);
    expect(sheet.note).toBe('Bu seçimi sen belirledin; öneriler buna göre çalışır.');
  });
  test('with no interactions at all the bar is empty', () => {
    const empty = buildStyleJourney(input({ calculatedProfile: model({}) }));
    const sheet = buildSourceSheet(buildStyleGrid(empty).tiles[0], empty);
    expect(sheet.sources.every(source => source.count === 0 && source.fraction === 0)).toBe(true);
  });
});

describe('only you', () => {
  test('unset style and size are "+" boxes', () => {
    const boxes = buildOnlyYou(buildStyleJourney(input({ profile: studio() })));
    expect(boxes).toEqual([
      { id: 'style', title: 'Stil tarzı', value: null, section: 'style' },
      { id: 'body', title: 'Beden', value: null, section: 'body' },
    ]);
  });
  test('set values are shown', () => {
    const boxes = buildOnlyYou(buildStyleJourney(input({
      profile: studio({ styleTags: ['minimal', 'classic'], topSize: 'M', bottomSize: 'L', heightCm: 180 }),
    })));
    expect(boxes[0].value).toBe('Minimal, Klasik');
    expect(boxes[1].value).toBe('M · Alt: L · 180 cm');
  });
  test('another owner\'s declared values never show', () => {
    const boxes = buildOnlyYou(buildStyleJourney(input({ userId: 'B', profile: studio({ styleTags: ['minimal'] }) })));
    expect(boxes.every(box => box.value === null)).toBe(true);
  });
});

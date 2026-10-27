import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluateCatalogEligibility,
  isActiveCatalogRecord,
  type CatalogEligibilityRecord,
} from '../lib/catalogEligibility';
import { selectLocalFeed } from '../src/intelligence/recommendations/feedFallback';
import { selectRecommendationPool } from '../src/intelligence/recommendations/selectRecommendationPool';
import { rankCatalog } from '../src/intelligence/ranking/rankCatalog';
import { DEFAULT_RECS_CONFIG, emptySessionIntent, emptyStyleProfile, rankCandidates } from '../lib/scoring';
import { toScoringCandidate } from '../src/intelligence/ranking/productCandidate';
import type { Product } from '../types/product';

const complete: CatalogEligibilityRecord = {
  id: 'defacto-1',
  title: 'Siyah Basic Tişört',
  brand: 'DeFacto',
  price: 100,
  currency: 'TRY',
  image_url: 'https://example.invalid/image.jpg',
  images: [],
  category: 'upper_body',
  provider: 'defacto',
  product_url: 'https://example.invalid/product',
  affiliate_url: null,
  external_id: '1',
};

test('a row missing category, image, or store link is incomplete once', () => {
  const broken: CatalogEligibilityRecord = {
    ...complete,
    id: 'broken-1',
    title: '   ',
    image_url: ' ',
    images: ['', '   '],
    category: 'not-a-category',
    product_url: 'not a url',
  };
  const decision = evaluateCatalogEligibility(broken);
  expect(decision.status).toBe('incomplete');
  expect(decision.missing).toEqual(['title', 'image', 'category', 'productUrl', 'color']);
  const removed = [complete, broken].filter((row) => !isActiveCatalogRecord(row));
  expect(removed.map((row) => row.id)).toEqual(['broken-1']);
});

test('title inference keeps a product whose stored colors are empty', () => {
  const decision = evaluateCatalogEligibility(complete, { product_id: 'defacto-1', colors: [], style_tags: [] });
  expect(decision).toMatchObject({ status: 'eligible', missing: [], styleSignal: 'casual' });
});

test('a row is inactive when stored colors and title inference are both empty', () => {
  const plain = { ...complete, id: 'plain-1', title: 'Duz Ceket' };
  const decision = evaluateCatalogEligibility(plain, { product_id: 'plain-1', colors: [' ', 'unknown'], style_tags: null });
  expect(decision.status).toBe('incomplete');
  expect(decision.missing).toEqual(['color']);
  expect([complete, plain].filter((row) => !isActiveCatalogRecord(row, { colors: [] })).map((row) => row.id)).toEqual(['plain-1']);
});

test('stored attribute colors keep a product when the title has no color word', () => {
  const plain = { ...complete, id: 'stored-1', title: 'Duz Ceket' };
  expect(isActiveCatalogRecord(plain, { product_id: 'stored-1', colors: ['mavi'] })).toBe(true);
});

test('empty style tags do not remove a product that the outfit map can classify', () => {
  const decision = evaluateCatalogEligibility(
    { ...complete, title: 'Siyah Sweatshirt' },
    { product_id: 'defacto-1', colors: [], style_tags: [] },
  );
  expect(decision).toMatchObject({ status: 'eligible', styleSignal: 'casual' });
});

test('an unmapped subtype stays active because outfit scoring only withholds style points', () => {
  const decision = evaluateCatalogEligibility(
    { ...complete, id: 'flo-hat', title: 'Siyah Sapka', category: 'hats' },
    { product_id: 'flo-hat', colors: [], subcategory: 'sapka', style_tags: [] },
  );
  expect(decision).toMatchObject({ status: 'eligible', missing: [], styleSignal: null });
});

test('gallery image and camelCase product fields satisfy the same gate', () => {
  expect(isActiveCatalogRecord({
    id: 'flo-1',
    title: 'Beyaz Sneaker',
    brand: 'Flo',
    price: 100,
    currency: 'TRY',
    image_url: '   ',
    images: ['https://example.invalid/gallery.jpg'],
    category: 'shoes',
    provider: 'flo',
    product_url: 'https://example.invalid/shoe',
    productUrl: 'https://example.invalid/shoe',
    affiliate_url: null,
    externalId: '1',
  })).toBe(true);
});

test('re-reading an incomplete row does not reactivate it until color evidence exists', () => {
  const imported = { ...complete, id: 'plain-1', title: 'Duz Ceket' };
  const emptyColors = { product_id: 'plain-1', colors: [] as string[] };
  expect(isActiveCatalogRecord(imported, emptyColors)).toBe(false);
  expect(isActiveCatalogRecord({ ...imported }, { ...emptyColors })).toBe(false);
  expect(isActiveCatalogRecord({ ...imported, title: 'Mavi Ceket' }, emptyColors)).toBe(true);
  expect(isActiveCatalogRecord(imported, { ...emptyColors, colors: ['mavi'] })).toBe(true);
});

test('an empty candidate list stays empty without throwing', () => {
  const selected = selectLocalFeed([], {}, 20);
  expect(selected.products).toEqual([]);
  expect(selected.selectedCount).toBe(0);
});

test('eligible recommendation fixtures keep their pool and rank order', () => {
  const catalog = JSON.parse(readFileSync(
    join(__dirname, 'fixtures/recommendation-catalog.snapshot.json'),
    'utf8',
  )) as Product[];
  const active = catalog.filter((product) => isActiveCatalogRecord(product));
  expect(active.length).toBeLessThan(catalog.length);
  expect(new Set(active.map((product) => product.id)).size).toBe(active.length);
  const score = (products: Product[]) => rankCandidates(
    products.map(toScoringCandidate),
    emptyStyleProfile('user-1'),
    emptySessionIntent(),
    DEFAULT_RECS_CONFIG,
    1_700_000_000_000,
    'user-1',
  ).map((entry) => entry.candidate.id);
  const activeIds = new Set(active.map((product) => product.id));
  expect(score(catalog).filter((id) => activeIds.has(id))).toEqual(score(active));
  const ranked = (products: Product[]) => rankCatalog(
    products,
    'user-1',
    emptySessionIntent(),
    20,
    'personal',
    DEFAULT_RECS_CONFIG,
    emptyStyleProfile('user-1'),
    1_700_000_000_000,
  ).map((product) => product.id);
  expect(ranked(active)).toEqual(ranked(catalog.filter((product) => isActiveCatalogRecord(product))));
  expect(selectRecommendationPool(active).map((product) => product.id))
    .toEqual(selectRecommendationPool(catalog.filter((product) => isActiveCatalogRecord(product))).map((product) => product.id));
});

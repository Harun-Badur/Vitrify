import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import {
  hasCoreFootwear,
  hasGenderConflict,
  hasHardConflict,
  isCatalogRoleCompatible,
  isValidOutfitItems,
  type PairCategory,
} from '../src/intelligence/pairing/outfitRules';
import { OUTFIT_ROLES, type GarmentCategory, type OutfitRole, type Product, type ProductGender } from '../types/product';
import type { OutfitCandidateItem } from '../src/intelligence/outfits/outfitCandidate';
import {
  legacy_hasCoreFootwear,
  legacy_hasGenderConflict,
  legacy_hasHardConflict,
  legacy_isCatalogRoleCompatible,
  legacy_isValidOutfitItems,
} from './fixtures/legacyOutfitRules';
import { b0PrimeSourcesPresent, loadB0PrimeDataset } from './fixtures/b0PrimeReplay';

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const assertTrue = <T extends true>(): T => true as T;
assertTrue<Same<PairCategory, GarmentCategory>>();

type Rule = (items: readonly OutfitCandidateItem[]) => boolean;
const RULES: [string, Rule, Rule][] = [
  ['hasHardConflict', hasHardConflict, legacy_hasHardConflict],
  ['isValidOutfitItems', isValidOutfitItems, legacy_isValidOutfitItems],
  ['hasGenderConflict', hasGenderConflict, legacy_hasGenderConflict],
  ['hasCoreFootwear', hasCoreFootwear, legacy_hasCoreFootwear],
];

const expectSameRules = (items: readonly OutfitCandidateItem[]): void => {
  for (const [name, current, legacy] of RULES) {
    const actual = current(items);
    if (actual !== legacy(items)) {
      throw new Error(`${name} differs for ${JSON.stringify(items.map(item => [item.sourceType, item.sourceId, item.role]))}`);
    }
  }
};

const catalog = (product: Product, role: OutfitRole): OutfitCandidateItem =>
  ({ sourceType: 'catalog', sourceId: product.id, role, product });
const wardrobe = (id: string, role: OutfitRole): OutfitCandidateItem =>
  ({ sourceType: 'wardrobe', sourceId: id, role, wardrobeItem: { id, category: role } });

const TITLES = ['Kadın Siyah Blazer Ceket', 'Erkek Şort', 'Çocuk Tişört', 'Basic Gömlek', 'Kids Mont', 'Hırka', 'Yetişkin Kazak', 'Elbise'];
const SUBTYPES: (string | undefined)[] = [undefined, 'blazer', 'tisort', 'ceket', 'hirka', 'pareo', 'Pareo', ' kazak '];
const CATEGORIES: GarmentCategory[] = ['upper_body', 'lower_body', 'dresses', 'shoes', 'accessories'];
const GENDERS: (ProductGender | '' | undefined)[] = ['women', 'men', 'unisex', '', undefined];

const syntheticProducts = (): Product[] => {
  const products: Product[] = [];
  let index = 0;
  for (const title of TITLES) for (const subcategory of SUBTYPES) for (const category of CATEGORIES) {
    const gender = GENDERS[index % GENDERS.length];
    products.push({ id: `p${index++}`, title, category, subcategory, gender, brand: 'X', price: 1,
      imageUrl: 'https://example.com/x.jpg', garmentDescription: title });
  }
  return products;
};

describe('outfit rules equality with the S2 engine (synthetic)', () => {
  const products = syntheticProducts();

  it('isCatalogRoleCompatible matches for every product and role, including repeated (cached) reads', () => {
    for (const pass of [0, 1]) for (const product of products) for (const role of OUTFIT_ROLES) {
      expect([pass, product.id, role, isCatalogRoleCompatible(product, role)])
        .toEqual([pass, product.id, role, legacy_isCatalogRoleCompatible(product, role)]);
    }
  });

  it('every rule matches on all catalog pairs in every role pair and with wardrobe items', () => {
    const sample = products.filter((_, index) => index % 4 === 0);
    for (const a of sample) for (const b of sample) for (const roleA of OUTFIT_ROLES) for (const roleB of ['top', 'bottom', 'outerwear', 'shoes'] as const) {
      expectSameRules([catalog(a, roleA), catalog(b, roleB)]);
      expectSameRules([catalog(a, roleA), wardrobe('w', roleB), wardrobe('w2', 'shoes')]);
    }
  });

  it('every rule matches after an in-place title or subtype edit (cache invalidation)', () => {
    const product: Product = { ...products[0] };
    const items = [catalog(product, 'top'), wardrobe('w', 'bottom')];
    expectSameRules(items);
    product.title = 'Kadın Blazer';
    product.subcategory = 'blazer';
    expectSameRules(items);
    product.category = 'lower_body';
    product.subcategory = 'pareo';
    expect(isCatalogRoleCompatible(product, 'bottom')).toBe(legacy_isCatalogRoleCompatible(product, 'bottom'));
  });
});

describe('outfit rules boundary', () => {
  it('is the only place the structural rules are defined, and the engine imports it directly', () => {
    const root = join(__dirname, '..');
    const sourceFiles = (path: string): string[] => readdirSync(path).flatMap(name => {
      const child = join(path, name);
      if (statSync(child).isDirectory()) return sourceFiles(child);
      return /\.(ts|tsx)$/.test(name) ? [child] : [];
    });
    const files = ['app', 'components', 'services', 'store', 'lib', 'hooks', 'src', 'supabase/functions']
      .map(entry => join(root, entry)).filter(entry => existsSync(entry)).flatMap(sourceFiles);
    const definers = files
      .filter(path => /export const (hasHardConflict|isCatalogRoleCompatible|isValidOutfitItems|hasCoreFootwear)\b/.test(readFileSync(path, 'utf8')))
      .map(path => relative(root, path).replace(/\\/g, '/'));
    expect(definers).toEqual(['src/intelligence/pairing/outfitRules.ts']);
    const importers = files
      .filter(path => /pairing\/outfitRules/.test(readFileSync(path, 'utf8')))
      .map(path => relative(root, path).replace(/\\/g, '/'));
    expect(importers).toEqual([
      'lib/insightChip.ts',
      'src/intelligence/outfits/generateOutfitCandidates.ts',
      'src/intelligence/outfits/outfitCandidate.ts',
      'src/intelligence/outfits/outfitRanking.ts',
      'src/intelligence/outfits/rankOutfitCandidates.ts',
      'src/intelligence/recommendations/selectDiverseComplements.ts',
    ]);
  });
});

const b0Root = join(__dirname, '..');
const describeB0 = b0PrimeSourcesPresent(b0Root) ? describe : describe.skip;

describeB0('outfit rules equality with the S2 engine (B0′ catalog)', () => {
  it('matches on every product×role and on anchor+pool pairs and triples', () => {
    const dataset = loadB0PrimeDataset(b0Root);
    const all = [...dataset.products.values()];
    for (const product of all) for (const role of OUTFIT_ROLES) {
      if (isCatalogRoleCompatible(product, role) !== legacy_isCatalogRoleCompatible(product, role)) {
        throw new Error(`isCatalogRoleCompatible differs: ${product.id} ${role}`);
      }
    }
    const roled = (product: Product) => (product.outfitRole ? catalog(product, product.outfitRole) : null);
    const pool = dataset.poolIds.map(id => roled(dataset.products.get(id)!)).filter((item): item is OutfitCandidateItem => item !== null);
    let compared = 0;
    for (const anchorId of dataset.anchorIds) {
      const anchor = roled(dataset.products.get(anchorId)!);
      if (!anchor) continue;
      for (const b of pool) {
        expectSameRules([anchor, b]);
        compared++;
        for (const c of pool) expectSameRules([anchor, b, c]);
      }
    }
    expect(compared).toBeGreaterThan(2000);
  }, 300_000);
});

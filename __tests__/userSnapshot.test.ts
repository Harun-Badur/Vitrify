import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import {
  buildProductIntelligence,
} from '../src/intelligence/product/productIntelligence';
import {
  buildUserSnapshot,
  MEDIUM_VALUE_EVIDENCE,
  MIN_BEHAVIOR_INTERACTIONS,
  type UserSnapshotInput,
} from '../src/intelligence/user/userSnapshot';
import type { LikedProduct, Product } from '../types/product';
import type { UserStudioProfile } from '../types/profile';
import { USER_BEHAVIOR_DIMENSIONS } from '../types/userSnapshot';

const UNKNOWN_DECLARED = { value: null, source: 'unknown', confidence: 'unknown' };
const product = (id: string, title: string, patch: Partial<Product> = {}): Product => ({
  id, title, category: 'upper_body', brand: 'Örnek Marka', price: 400,
  imageUrl: `https://example.com/${id}.jpg`, garmentDescription: title, ...patch,
});
const liked = (item: Product, likedAt = '2026-10-01T10:00:00.000Z'): LikedProduct => ({
  product: item, notifyOnPriceDrop: true, likedAt,
});
const profile = (patch: Partial<UserStudioProfile> = {}): UserStudioProfile => ({
  userId: 'user-1', heightCm: null, weightKg: null, topSize: null, bottomSize: null,
  styleTags: [], modelPhotoPath: null, ...patch,
});
const input = (patch: Partial<UserSnapshotInput> = {}): UserSnapshotInput => ({
  userId: 'user-1', profile: null, likedProducts: [], passedProductIds: [], passedProducts: [], ...patch,
});
const many = (count: number, prefix: string, title: string, patch: Partial<Product> = {}): Product[] =>
  Array.from({ length: count }, (_, index) => product(`${prefix}-${index}`, title, patch));

describe('buildUserSnapshot: empty profile', () => {
  it('reports an unavailable profile and no behavior without inventing preferences', () => {
    const snapshot = buildUserSnapshot(input());
    expect(snapshot).toMatchObject({ version: 1, userId: 'user-1', profileStatus: 'unavailable', conflicts: [] });
    for (const preference of Object.values(snapshot.declared)) expect(preference).toEqual(UNKNOWN_DECLARED);
    expect(snapshot.behavior).toMatchObject({
      status: 'none', likeCount: 0, passCount: 0, undoablePassCount: 0, attributedPassCount: 0, undoHistory: 'not_recorded',
    });
    for (const dimension of USER_BEHAVIOR_DIMENSIONS) {
      expect(snapshot.behavior.dimensions[dimension]).toEqual({ status: 'unknown', evidenceCount: 0, values: [] });
    }
  });

  it('distinguishes a loaded but empty profile from a missing one', () => {
    const snapshot = buildUserSnapshot(input({ profile: profile(), userId: null }));
    expect(snapshot.profileStatus).toBe('loaded');
    expect(snapshot.userId).toBeNull();
    for (const preference of Object.values(snapshot.declared)) expect(preference).toEqual(UNKNOWN_DECLARED);
  });
});

describe('buildUserSnapshot: explicit preferences', () => {
  it('keeps declared profile values separate and normalizes only to catalog vocabularies', () => {
    const snapshot = buildUserSnapshot(input({ profile: profile({
      styleTags: ['minimal', 'classic', 'minimal'], topSize: 'M', bottomSize: 'L',
      favoriteBrands: ['Jack & Jones', 'Mavi', 'mavi'], preferredColors: ['Siyah', 'Lacivert', 'Açık gri'],
      priceRange: { min: 200, max: 1500 },
    }) }));
    const declared = { source: 'profile_declared', confidence: 'high' };
    expect(snapshot.declared).toEqual({
      styleTags: { value: ['minimal', 'classic'], ...declared },
      favoriteBrands: { value: ['jack-jones', 'mavi'], ...declared },
      preferredColors: { value: ['siyah', 'navy', 'gri'], ...declared },
      topSize: { value: 'M', ...declared },
      bottomSize: { value: 'L', ...declared },
      priceRange: { value: { min: 200, max: 1500 }, ...declared },
    });
    expect(snapshot.behavior.status).toBe('none');
    expect(snapshot.conflicts).toEqual([]);
  });

  it('never copies body metrics or the model photo into the snapshot', () => {
    const snapshot = buildUserSnapshot(input({
      profile: profile({ heightCm: 187, weightKg: 83, modelPhotoPath: 'user-1/model.jpg' }),
    }));
    const serialized = JSON.stringify(snapshot);
    for (const leaked of ['187', '83', 'model.jpg', 'height', 'weight', 'modelPhoto']) {
      expect(serialized).not.toContain(leaked);
    }
  });
});

describe('buildUserSnapshot: few interactions', () => {
  it('treats a handful of likes as sparse evidence, not as a preference', () => {
    const likes = many(3, 'black', 'Kadın Siyah Gömlek').map(item => liked(item));
    const snapshot = buildUserSnapshot(input({ likedProducts: likes }));
    expect(snapshot.behavior.status).toBe('sparse');
    expect(snapshot.behavior.dimensions.color).toEqual({ status: 'unknown', evidenceCount: 3, values: [] });
    expect(snapshot.behavior.dimensions.gender).toEqual({ status: 'unknown', evidenceCount: 3, values: [] });
  });

  it('stays sparse just below the interaction threshold', () => {
    const likes = many(MIN_BEHAVIOR_INTERACTIONS - 1, 'black', 'Kadın Siyah Gömlek').map(item => liked(item));
    const snapshot = buildUserSnapshot(input({ likedProducts: likes }));
    expect(snapshot.behavior.status).toBe('sparse');
    expect(snapshot.behavior.dimensions.color.status).toBe('unknown');
  });

  it('reports observed values with capped confidence once evidence is sufficient', () => {
    const likes = [
      ...many(6, 'black', 'Kadın Siyah Gömlek', { brand: 'Mavi' }),
      ...many(4, 'white', 'Kadın Beyaz Tişört', { brand: 'Koton' }),
      ...many(2, 'red', 'Kadın Kırmızı Tişört', { brand: 'Koton' }),
    ].map(item => liked(item));
    const snapshot = buildUserSnapshot(input({ likedProducts: likes }));
    expect(snapshot.behavior.status).toBe('sufficient');
    expect(snapshot.behavior.dimensions.color).toEqual({
      status: 'known', evidenceCount: 12, values: [
        { value: 'siyah', likeCount: 6, passCount: 0, inferredAttributeCount: 6, direction: 'positive', confidence: 'low' },
        { value: 'beyaz', likeCount: 4, passCount: 0, inferredAttributeCount: 4, direction: 'positive', confidence: 'low' },
      ],
    });
    expect(snapshot.behavior.dimensions.brand.values.map(value => [value.value, value.likeCount, value.inferredAttributeCount]))
      .toEqual([['koton', 6, 0], ['mavi', 6, 0]]);
    expect(snapshot.behavior.dimensions.gender.values).toEqual([
      { value: 'women', likeCount: 12, passCount: 0, inferredAttributeCount: 12, direction: 'positive', confidence: 'medium' },
    ]);
  });

  it('reaches medium confidence only at the named evidence threshold, never high', () => {
    const likes = many(MEDIUM_VALUE_EVIDENCE + 2, 'black', 'Siyah Gömlek').map(item => liked(item));
    const color = buildUserSnapshot(input({ likedProducts: likes })).behavior.dimensions.color;
    expect(color.values[0]).toMatchObject({ value: 'siyah', confidence: 'medium' });
    const values = USER_BEHAVIOR_DIMENSIONS.flatMap(dimension =>
      buildUserSnapshot(input({ likedProducts: likes })).behavior.dimensions[dimension].values);
    expect(values.map(value => value.confidence)).not.toContain('high');
  });
});

describe('buildUserSnapshot: conflicting signals', () => {
  it('reports products both liked and passed and excludes them from evidence', () => {
    const shared = product('shared', 'Siyah Gömlek');
    const snapshot = buildUserSnapshot(input({
      likedProducts: [liked(shared), liked(product('other', 'Beyaz Gömlek'))],
      passedProductIds: ['shared'],
    }));
    expect(snapshot.conflicts).toContainEqual({ code: 'liked_and_passed', field: 'interactions', values: ['shared'] });
    expect(snapshot.behavior).toMatchObject({ likeCount: 2, passCount: 1, attributedPassCount: 0 });
    expect(snapshot.behavior.dimensions.color.evidenceCount).toBe(1);
  });

  it('marks values that were both liked and passed as mixed', () => {
    const snapshot = buildUserSnapshot(input({
      likedProducts: [...many(3, 'like', 'Siyah Gömlek'), ...many(4, 'other', 'Beyaz Gömlek')].map(item => liked(item)),
      passedProducts: many(3, 'pass', 'Siyah Gömlek'),
    }));
    expect(snapshot.behavior.dimensions.color.values).toContainEqual(expect.objectContaining({
      value: 'siyah', likeCount: 3, passCount: 3, direction: 'mixed',
    }));
  });

  it('reports a declared color the user keeps passing without overriding the declaration', () => {
    const snapshot = buildUserSnapshot(input({
      profile: profile({ preferredColors: ['Siyah'], favoriteBrands: ['Mavi'] }),
      likedProducts: many(6, 'white', 'Beyaz Gömlek', { brand: 'Mavi' }).map(item => liked(item)),
      passedProducts: many(5, 'black', 'Siyah Gömlek', { brand: 'Koton' }),
    }));
    expect(snapshot.declared.preferredColors.value).toEqual(['siyah']);
    expect(snapshot.behavior.dimensions.color.values).toContainEqual(expect.objectContaining({ value: 'siyah', direction: 'negative' }));
    expect(snapshot.conflicts).toEqual([
      { code: 'declared_behavior_mismatch', field: 'preferredColors', values: ['siyah'] },
    ]);
  });
});

describe('buildUserSnapshot: favorites and undo', () => {
  it('counts persisted, undoable and attributed passes separately', () => {
    const stack = [product('s1', 'Siyah Gömlek'), product('s2', 'Beyaz Gömlek')];
    const snapshot = buildUserSnapshot(input({
      likedProducts: [liked(product('l1', 'Mavi Gömlek')), liked(product('l1', 'Mavi Gömlek'))],
      passedProductIds: ['p1', 'p2', 's1', 'p1'],
      passedProducts: stack,
    }));
    expect(snapshot.behavior).toMatchObject({
      status: 'sparse', likeCount: 1, passCount: 4, undoablePassCount: 2, attributedPassCount: 2, undoHistory: 'not_recorded',
    });
  });

  it('treats an undone pass exactly as a pass that never happened', () => {
    const a = product('a', 'Siyah Gömlek');
    const b = product('b', 'Beyaz Gömlek');
    const likes = [liked(product('l1', 'Mavi Gömlek'))];
    const afterUndo = buildUserSnapshot(input({ likedProducts: likes, passedProductIds: ['a'], passedProducts: [a] }));
    const neverPassed = buildUserSnapshot(input({ likedProducts: likes, passedProductIds: ['a'], passedProducts: [a] }));
    const beforeUndo = buildUserSnapshot(input({ likedProducts: likes, passedProductIds: ['a', 'b'], passedProducts: [a, b] }));
    expect(afterUndo).toEqual(neverPassed);
    expect(beforeUndo.behavior.undoablePassCount).toBe(2);
    expect(afterUndo.behavior.undoablePassCount).toBe(1);
  });

  it('does not treat the default price-drop alert as a preference', () => {
    const on = buildUserSnapshot(input({ likedProducts: [liked(product('l1', 'Siyah Gömlek'))] }));
    const off = buildUserSnapshot(input({ likedProducts: [{ ...liked(product('l1', 'Siyah Gömlek')), notifyOnPriceDrop: false }] }));
    expect(off).toEqual(on);
  });
});

describe('buildUserSnapshot: unknown values', () => {
  it('drops unrecognized or invalid declared values and reports them', () => {
    const fromServer: UserStudioProfile = Object.assign(profile(), {
      styleTags: ['minimal', 'boho'], topSize: 'XXXL', preferredColors: ['Siyah', 'Neon'],
      favoriteBrands: ['  ', ''], priceRange: { min: 900, max: 100 },
    });
    const snapshot = buildUserSnapshot(input({ profile: fromServer }));
    expect(snapshot.declared).toMatchObject({
      styleTags: { value: ['minimal'] }, topSize: UNKNOWN_DECLARED, preferredColors: { value: ['siyah'] },
      favoriteBrands: UNKNOWN_DECLARED, priceRange: UNKNOWN_DECLARED,
    });
    expect(snapshot.conflicts).toEqual([
      { code: 'unrecognized_declared_value', field: 'styleTags', values: ['boho'] },
      { code: 'unrecognized_declared_value', field: 'preferredColors', values: ['Neon'] },
      { code: 'invalid_declared_value', field: 'priceRange', values: ['900', '100'] },
    ]);
    const nonFinite = buildUserSnapshot(input({ profile: profile({ priceRange: { min: Number.NaN, max: 100 } }) }));
    expect(nonFinite.declared.priceRange).toEqual(UNKNOWN_DECLARED);
  });

  it('keeps dimensions unknown when interacted products carry no attribute evidence', () => {
    const likes = many(12, 'plain', 'Örnek Ürün', { brand: 'Kabin' }).map(item => liked(item));
    const { dimensions } = buildUserSnapshot(input({ likedProducts: likes })).behavior;
    expect(dimensions.color).toEqual({ status: 'unknown', evidenceCount: 0, values: [] });
    expect(dimensions.subtype).toEqual({ status: 'unknown', evidenceCount: 0, values: [] });
    expect(dimensions.gender).toEqual({ status: 'unknown', evidenceCount: 0, values: [] });
    expect(dimensions.brand).toEqual({ status: 'unknown', evidenceCount: 0, values: [] });
    expect(dimensions.role.values[0]).toMatchObject({ value: 'top', likeCount: 12, inferredAttributeCount: 12 });
  });

  it('uses an injected Product Intelligence resolver for declared attribute evidence', () => {
    const likes = many(10, 'p', 'Örnek Ürün').map(item => liked(item));
    const resolve = (item: Product) => buildProductIntelligence({ product: item, attributes: {
      product_id: item.id, gender: 'men', colors: ['navy'], fit: null, subcategory: 'gomlek',
      brand_slug: null, price_band: null, outfit_role: 'top',
    } });
    const { dimensions } = buildUserSnapshot(input({ likedProducts: likes, resolveProductIntelligence: resolve })).behavior;
    expect(dimensions.color.values).toEqual([
      { value: 'navy', likeCount: 10, passCount: 0, inferredAttributeCount: 0, direction: 'positive', confidence: 'medium' },
    ]);
    expect(dimensions.subtype.values[0]).toMatchObject({ value: 'gomlek', inferredAttributeCount: 0 });
  });
});

describe('buildUserSnapshot: purity', () => {
  it('is deterministic regardless of input order and never mutates inputs', () => {
    const likes = [...many(6, 'black', 'Siyah Gömlek'), ...many(6, 'white', 'Beyaz Gömlek')].map(item => liked(item));
    const passes = many(4, 'red', 'Kırmızı Gömlek');
    const data = input({ profile: profile({ styleTags: ['sport'] }), likedProducts: likes, passedProductIds: passes.map(p => p.id), passedProducts: passes });
    const before = JSON.stringify(data);
    for (const item of [...likes, ...passes]) Object.freeze(item);
    const first = buildUserSnapshot(data);
    const reversed = buildUserSnapshot({ ...data, likedProducts: [...likes].reverse(), passedProducts: [...passes].reverse(),
      passedProductIds: [...data.passedProductIds].reverse() });
    expect(reversed).toEqual(first);
    expect(JSON.stringify(data)).toBe(before);
  });
});

describe('User Intelligence boundary', () => {
  const root = join(__dirname, '..');
  const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });

  it('is not imported by any app flow', () => {
    const importers = ['app', 'components', 'services', 'store', 'lib', 'hooks', 'src']
      .map(dir => join(root, dir))
      .filter(dir => existsSync(dir))
      .flatMap(sourceFiles)
      .filter(path => /user\/userSnapshot|types\/userSnapshot/.test(readFileSync(path, 'utf8')))
      .map(path => relative(root, path).replace(/\\/g, '/'));
    // The evidence adapter, source adapter and style context remain unwired;
    // their boundary tests enforce the absence of app consumers.
    expect(importers).toEqual([
      'src/intelligence/evidence/sharedEvidence.ts',
      'src/intelligence/style/styleContext.ts',
      'src/intelligence/user/userSnapshot.ts',
      'src/intelligence/user/userSnapshotSource.ts',
    ]);
  });

  it('reads no session query state, store, analytics, storage or backend modules', () => {
    const source = readFileSync(join(root, 'src/intelligence/user/userSnapshot.ts'), 'utf8');
    for (const forbidden of ['sessionIntent', '/store/', 'analytics', 'AsyncStorage', 'supabase', '/services/', 'Date.now', 'new Date']) {
      expect(source).not.toContain(forbidden);
    }
  });
});

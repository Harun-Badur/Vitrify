import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fetchStudioProfile } from '../services/profileService';
import { ProductRepository } from '../services/productRepository';
import type { ProductAttributeContext } from '../src/intelligence/product/productIntelligence';
import { buildUserSnapshot } from '../src/intelligence/user/userSnapshot';
import {
  buildUserSnapshotFromSources,
  selectUserSnapshotInput,
  type UserSnapshotSources,
  type UserSnapshotStoreState,
} from '../src/intelligence/user/userSnapshotSource';
import type { LikedProduct, Product } from '../types/product';
import type { UserStudioProfile } from '../types/profile';

jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: null, downloadAsync: jest.fn() }));
jest.mock('../lib/personPhotoPrepare', () => ({ preparePersonJpegUri: jest.fn() }));
jest.mock('../lib/logger', () => ({ logger: { error: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));

let mockMetadata: Record<string, unknown>;
let mockRow: Record<string, unknown> | null;
jest.mock('../lib/supabase', () => ({
  getSupabaseClient: jest.fn(),
  getRequiredSupabaseClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1', user_metadata: mockMetadata } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mockRow, error: null }) }) }) }),
  }),
}));

const UNKNOWN_DECLARED = { value: null, source: 'unknown', confidence: 'unknown' };
const product = (id: string, title: string, patch: Partial<Product> = {}): Product => ({
  id, title, category: 'upper_body', brand: 'Örnek Marka', price: 400,
  imageUrl: `https://example.com/${id}.jpg`, garmentDescription: title, ...patch,
});
const liked = (item: Product): LikedProduct => ({ product: item, notifyOnPriceDrop: true, likedAt: '2026-10-01T10:00:00.000Z' });
const many = (count: number, prefix: string, title: string): Product[] =>
  Array.from({ length: count }, (_, index) => product(`${prefix}-${index}`, title));
const state = (patch: Partial<UserSnapshotStoreState> = {}): UserSnapshotStoreState => ({
  sessionUserId: 'user-1', likedProducts: [], passedProductIds: [], passedStack: [], ...patch,
});
const profile = (patch: Partial<UserStudioProfile> = {}): UserStudioProfile => ({
  userId: 'user-1', heightCm: null, weightKg: null, topSize: null, bottomSize: null,
  styleTags: [], modelPhotoPath: null, ...patch,
});
const loadedContext = (id: string, colors: string[]): ProductAttributeContext => ({
  productId: id, status: 'loaded', semanticColumns: 'loaded',
  attributes: { product_id: id, gender: 'men', colors, fit: null, subcategory: 'gomlek', brand_slug: null, price_band: null, outfit_role: 'top' },
});
/** Real repository instance; its loader must never run while building a snapshot. */
const repositoryWith = async (contexts: ProductAttributeContext[]) => {
  const load = jest.fn(async (ids: readonly string[]) => ({
    products: ids.map(id => product(id, 'Örnek Ürün')), attributeContexts: contexts,
  }));
  const repository = new ProductRepository(load);
  await repository.productsById(contexts.map(context => context.productId));
  load.mockClear();
  return { repository, load };
};

beforeEach(() => {
  mockMetadata = {};
  mockRow = { id: 'user-1', height_cm: 181, weight_kg: 73, top_size: 'L', bottom_size: 'S', style_tags: ['sport'], model_photo_path: 'photo' };
});

describe('selectUserSnapshotInput: store inputs', () => {
  it('maps only the session, favorites, persisted passes and the undo stack', () => {
    const likes = [liked(product('l1', 'Siyah Gömlek'))];
    const stack = [product('s1', 'Beyaz Gömlek')];
    const selected = selectUserSnapshotInput({
      state: state({ likedProducts: likes, passedProductIds: ['p1', 's1'], passedStack: stack }),
      profile: null, attributeContexts: null,
    });
    expect(selected).toMatchObject({
      userId: 'user-1', profile: null, likedProducts: likes, passedProductIds: ['p1', 's1'], passedProducts: stack,
    });
    expect(Object.keys(selected).sort()).toEqual(
      ['likedProducts', 'passedProductIds', 'passedProducts', 'profile', 'resolveProductIntelligence', 'userId'],
    );
  });

  it('reports empty favorites and no session as having no behavior', () => {
    const snapshot = buildUserSnapshotFromSources({ state: state({ sessionUserId: null }), profile: null, attributeContexts: null });
    expect(snapshot).toMatchObject({ userId: null, profileStatus: 'unavailable', conflicts: [] });
    expect(snapshot.behavior).toMatchObject({ status: 'none', likeCount: 0, passCount: 0, undoablePassCount: 0 });
  });

  it('separates persisted passes from undoable passes that carry product data', () => {
    const snapshot = buildUserSnapshotFromSources({
      state: state({ passedProductIds: ['p1', 'p2', 's1'], passedStack: [product('s1', 'Siyah Gömlek'), product('s2', 'Beyaz Gömlek')] }),
      profile: null, attributeContexts: null,
    });
    expect(snapshot.behavior).toMatchObject({ passCount: 4, undoablePassCount: 2, attributedPassCount: 2, undoHistory: 'not_recorded' });
  });
});

describe('selectUserSnapshotInput: profile source', () => {
  it('keeps an unloaded profile unavailable', () => {
    const snapshot = buildUserSnapshotFromSources({ state: state(), profile: null, attributeContexts: null });
    expect(snapshot.profileStatus).toBe('unavailable');
    for (const preference of Object.values(snapshot.declared)) expect(preference).toEqual(UNKNOWN_DECLARED);
  });

  it('never applies a profile fetched for another account', () => {
    const snapshot = buildUserSnapshotFromSources({
      state: state(), profile: profile({ userId: 'someone-else', topSize: 'M' }), attributeContexts: null,
    });
    expect(snapshot.profileStatus).toBe('unavailable');
    expect(snapshot.declared.topSize).toEqual(UNKNOWN_DECLARED);
  });

  it('carries fetchStudioProfile preferences from auth metadata and sizes/style from profiles', async () => {
    mockMetadata = { studio_preferences: {
      favoriteBrands: ['Mavi', 'Koton'], preferredColors: ['Siyah', 'Lacivert'], priceRange: { min: 200, max: 1500 },
    } };
    const fetched = await fetchStudioProfile('user-1');
    const snapshot = buildUserSnapshotFromSources({ state: state(), profile: fetched, attributeContexts: null });
    const declared = { source: 'profile_declared', confidence: 'high' };
    expect(snapshot.declared).toEqual({
      styleTags: { value: ['sport'], ...declared },
      favoriteBrands: { value: ['mavi', 'koton'], ...declared },
      preferredColors: { value: ['siyah', 'navy'], ...declared },
      topSize: { value: 'L', ...declared },
      bottomSize: { value: 'S', ...declared },
      priceRange: { value: { min: 200, max: 1500 }, ...declared },
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/181|73|photo/);
  });

  it('keeps preferences unknown when auth metadata has none or invalid values', async () => {
    mockMetadata = { studio_preferences: { favoriteBrands: [], preferredColors: ['Neon'], priceRange: { min: 900, max: 100 } } };
    const invalid = buildUserSnapshotFromSources({ state: state(), profile: await fetchStudioProfile('user-1'), attributeContexts: null });
    expect(invalid.declared).toMatchObject({ favoriteBrands: UNKNOWN_DECLARED, preferredColors: UNKNOWN_DECLARED, priceRange: UNKNOWN_DECLARED });

    mockMetadata = {};
    mockRow = null;
    const empty = buildUserSnapshotFromSources({ state: state(), profile: await fetchStudioProfile('user-1'), attributeContexts: null });
    expect(empty.profileStatus).toBe('loaded');
    for (const preference of Object.values(empty.declared)) expect(preference).toEqual(UNKNOWN_DECLARED);
  });
});

describe('selectUserSnapshotInput: product metadata context', () => {
  it('uses repository attribute context when present and title evidence otherwise, without fetching', async () => {
    const withContext = many(10, 'ctx', 'Örnek Ürün');
    const { repository, load } = await repositoryWith(withContext.map(item => loadedContext(item.id, ['navy'])));
    const snapshot = buildUserSnapshotFromSources({
      state: state({ likedProducts: withContext.map(liked) }), profile: null, attributeContexts: repository,
    });
    expect(load).not.toHaveBeenCalled();
    expect(snapshot.behavior.dimensions.color.values).toEqual([
      { value: 'navy', likeCount: 10, passCount: 0, inferredAttributeCount: 0, direction: 'positive', confidence: 'medium' },
    ]);
    expect(snapshot.behavior.dimensions.gender.values[0]).toMatchObject({ value: 'men', inferredAttributeCount: 0 });
  });

  it('keeps liked-product snapshots without a context on low-confidence title evidence', async () => {
    const { repository } = await repositoryWith([]);
    const likes = many(10, 'snap', 'Kadın Siyah Gömlek').map(liked);
    const snapshot = buildUserSnapshotFromSources({ state: state({ likedProducts: likes }), profile: null, attributeContexts: repository });
    expect(snapshot.behavior.dimensions.color.values).toEqual([
      { value: 'siyah', likeCount: 10, passCount: 0, inferredAttributeCount: 10, direction: 'positive', confidence: 'medium' },
    ]);
    expect(snapshot).toEqual(buildUserSnapshotFromSources({ state: state({ likedProducts: likes }), profile: null, attributeContexts: null }));
  });

  it('does not invent metadata for products with neither context nor title evidence', () => {
    const likes = many(10, 'plain', 'Örnek Ürün').map(liked);
    const { dimensions } = buildUserSnapshotFromSources({ state: state({ likedProducts: likes }), profile: null, attributeContexts: null }).behavior;
    for (const dimension of [dimensions.color, dimensions.subtype, dimensions.gender]) {
      expect(dimension).toEqual({ status: 'unknown', evidenceCount: 0, values: [] });
    }
  });

  it('treats absent or failed attribute rows as missing evidence and derives role from the category', async () => {
    const items = many(10, 'gone', 'Örnek Ürün').map(item => ({ ...item, outfitRole: 'outerwear' as const }));
    const contexts = items.map((item, index): ProductAttributeContext => ({
      productId: item.id, status: index % 2 === 0 ? 'absent' : 'error', attributes: null, semanticColumns: 'loaded',
    }));
    const { repository } = await repositoryWith(contexts);
    const { dimensions } = buildUserSnapshotFromSources({ state: state({ likedProducts: items.map(liked) }), profile: null, attributeContexts: repository }).behavior;
    expect(dimensions.color.evidenceCount).toBe(0);
    expect(dimensions.role.values).toEqual([
      { value: 'top', likeCount: 10, passCount: 0, inferredAttributeCount: 10, direction: 'positive', confidence: 'medium' },
    ]);
  });

  it('resolves undoable passes through the same context source', async () => {
    const passes = many(5, 'pass', 'Örnek Ürün');
    const { repository } = await repositoryWith(passes.map(item => loadedContext(item.id, ['bordo'])));
    const likes = many(6, 'like', 'Beyaz Gömlek').map(liked);
    const { dimensions } = buildUserSnapshotFromSources({
      state: state({ likedProducts: likes, passedStack: passes, passedProductIds: passes.map(item => item.id) }),
      profile: null, attributeContexts: repository,
    }).behavior;
    expect(dimensions.color.values).toContainEqual(expect.objectContaining({ value: 'bordo', passCount: 5, direction: 'negative', inferredAttributeCount: 0 }));
  });
});

describe('selectUserSnapshotInput: purity', () => {
  it('is deterministic, order independent and never mutates its inputs', async () => {
    const likes = [...many(6, 'black', 'Siyah Gömlek'), ...many(6, 'white', 'Beyaz Gömlek')].map(liked);
    const stack = many(3, 'red', 'Kırmızı Gömlek');
    const { repository, load } = await repositoryWith([loadedContext('black-0', ['siyah'])]);
    const sources: UserSnapshotSources = {
      state: state({ likedProducts: likes, passedProductIds: ['x', ...stack.map(item => item.id)], passedStack: stack }),
      profile: profile({ styleTags: ['minimal'], favoriteBrands: ['Mavi'] }),
      attributeContexts: repository,
    };
    const before = JSON.stringify(sources);
    const contextBefore = JSON.stringify(repository.attributeContext('black-0'));
    for (const item of [...likes, ...stack, ...likes.map(entry => entry.product)]) Object.freeze(item);
    Object.freeze(sources.state.likedProducts); Object.freeze(sources.state.passedStack); Object.freeze(sources.state.passedProductIds);

    const first = buildUserSnapshotFromSources(sources);
    const second = buildUserSnapshotFromSources(sources);
    const reordered = buildUserSnapshotFromSources({ ...sources, state: { ...sources.state,
      likedProducts: [...likes].reverse(), passedStack: [...stack].reverse(), passedProductIds: [...sources.state.passedProductIds].reverse() } });
    expect(second).toEqual(first);
    expect(reordered).toEqual(first);
    expect(JSON.stringify(sources)).toBe(before);
    expect(JSON.stringify(repository.attributeContext('black-0'))).toBe(contextBefore);
    expect(load).not.toHaveBeenCalled();

    const selected = selectUserSnapshotInput(sources);
    expect(selected.likedProducts).not.toBe(sources.state.likedProducts);
    expect(buildUserSnapshot(selected)).toEqual(first);
  });
});

describe('UserSnapshot source adapter boundary', () => {
  const root = join(__dirname, '..');
  const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });

  it('is not imported by any screen, store, service or recommendation flow', () => {
    const importers = ['app', 'components', 'services', 'store', 'lib', 'hooks', 'src']
      .map(dir => join(root, dir))
      .filter(dir => existsSync(dir))
      .flatMap(sourceFiles)
      .filter(path => readFileSync(path, 'utf8').includes('userSnapshotSource'))
      .map(path => relative(root, path).replace(/\\/g, '/'));
    expect(importers).toEqual([]);
  });

  it('only type-imports the store and performs no I/O', () => {
    const source = readFileSync(join(root, 'src/intelligence/user/userSnapshotSource.ts'), 'utf8');
    const lines = source.split(/\r?\n/);
    const moduleLines = lines.filter(line => /from '[^']+';$/.test(line));
    const storeImports = moduleLines.filter(line => /from '.*\/(store|services)\//.test(line));
    expect(storeImports.length).toBeGreaterThan(0);
    expect(storeImports.every(line => line.startsWith('import type '))).toBe(true);
    for (const forbidden of ['supabase', 'async-storage', 'analytics', 'sessionIntent', 'likeService', 'profileService', 'productRepository']) {
      expect(moduleLines.join('\n')).not.toContain(forbidden);
    }
    const code = lines.filter(line => !/^\s*(\/\/|\/?\*)/.test(line)).join('\n');
    for (const forbidden of ['getState', 'setState', 'fetch(', 'productsById(', 'track(', 'Date.now', 'new Date', 'await ']) {
      expect(code).not.toContain(forbidden);
    }
  });
});

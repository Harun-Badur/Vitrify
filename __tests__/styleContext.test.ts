import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { emptySessionIntent } from '../lib/scoring';
import {
  buildProductIntelligence,
  type ProductSemanticAttributeRow,
} from '../src/intelligence/product/productIntelligence';
import { buildStyleContext, type StyleContextInput } from '../src/intelligence/style/styleContext';
import { buildUserSnapshot, type UserSnapshotInput } from '../src/intelligence/user/userSnapshot';
import type { LikedProduct, Product } from '../types/product';
import type { UserStudioProfile } from '../types/profile';
import type { SessionIntent } from '../types/recommendation';
import { STYLE_DIMENSIONS } from '../types/styleContext';

const product = (id: string, title: string, patch: Partial<Product> = {}): Product => ({
  id, title, category: 'upper_body', brand: 'Mavi', price: 400,
  imageUrl: `https://example.com/${id}.jpg`, garmentDescription: title, ...patch,
});
const liked = (item: Product): LikedProduct => ({ product: item, notifyOnPriceDrop: true, likedAt: '2026-10-01T10:00:00.000Z' });
const many = (count: number, prefix: string, title: string, patch: Partial<Product> = {}): Product[] =>
  Array.from({ length: count }, (_, index) => product(`${prefix}-${index}`, title, patch));
const profile = (patch: Partial<UserStudioProfile> = {}): UserStudioProfile => ({
  userId: 'user-1', heightCm: null, weightKg: null, topSize: null, bottomSize: null,
  styleTags: [], modelPhotoPath: null, ...patch,
});
const user = (patch: Partial<UserSnapshotInput> = {}) => buildUserSnapshot({
  userId: 'user-1', profile: null, likedProducts: [], passedProductIds: [], passedProducts: [], ...patch,
});
const anchorInput = (anchor: Product, patch: Partial<StyleContextInput> = {}, attributes?: ProductSemanticAttributeRow): StyleContextInput => ({
  anchor,
  anchorIntelligence: buildProductIntelligence({ product: anchor, attributes }),
  user: null,
  sessionIntent: null,
  ...patch,
});
const blackShirt = product('anchor', 'Kadın Siyah Gömlek');

describe('buildStyleContext: empty inputs', () => {
  it('reports every missing source instead of inventing context', () => {
    const context = buildStyleContext(anchorInput(product('anchor', 'Örnek Ürün', { brand: 'Kabin' })));
    expect(context).toMatchObject({
      version: 1,
      anchor: { productId: 'anchor', category: 'upper_body', productIntelligenceVersion: 1 },
      declared: null,
      behavior: null,
      conflicts: [],
      sources: { anchor: { productId: 'anchor' }, user: { status: 'unavailable' }, session: { status: 'unavailable' } },
      session: {
        status: 'unavailable', hasActiveQuery: false,
        constraints: { category: null, gender: null, size: null },
        anchorRelations: { category: 'session_unavailable', gender: 'session_unavailable' },
      },
    });
    expect(context.dimensions.color).toEqual({ anchor: [], declared: 'not_declared', behavior: { status: 'unavailable', anchorValues: [] } });
    expect(context.dimensions.brand.anchor).toEqual([]);
    expect(context.gaps).toEqual(expect.arrayContaining([
      { code: 'user_snapshot_unavailable' },
      { code: 'session_intent_unavailable' },
      { code: 'anchor_attribute_unknown', fields: ['subtype', 'gender', 'colors', 'fit', 'material', 'season', 'occasion', 'styleTags'] },
    ]));
  });

  it('rejects intelligence that belongs to another product', () => {
    const other = buildProductIntelligence({ product: product('other', 'Siyah Gömlek') });
    expect(() => buildStyleContext({ ...anchorInput(blackShirt), anchorIntelligence: other })).toThrow('does not describe the anchor');
  });
});

describe('buildStyleContext: missing metadata', () => {
  it('carries anchor confidence verbatim and lists uncertain fields', () => {
    const context = buildStyleContext(anchorInput(blackShirt));
    expect(context.anchor.attributes.colors).toEqual([
      { value: 'siyah', origin: 'derived', source: 'title_inferred', confidence: 'low' },
    ]);
    expect(context.dimensions.color.anchor).toEqual([
      { value: 'siyah', origin: 'derived', source: 'title_inferred', confidence: 'low' },
    ]);
    expect(context.dimensions.brand.anchor).toEqual([
      { value: 'mavi', origin: 'declared', source: 'catalog_product', confidence: 'unknown' },
    ]);
    const uncertain = context.gaps.find(gap => gap.code === 'anchor_attribute_uncertain');
    expect(uncertain).toMatchObject({ fields: expect.arrayContaining([
      { field: 'gender', confidence: 'low' }, { field: 'colors', confidence: 'low' }, { field: 'subtype', confidence: 'low' },
    ]) });
  });

  it('keeps null semantic columns unknown and seeded attributes at unknown confidence', () => {
    const context = buildStyleContext(anchorInput(blackShirt, {}, {
      product_id: 'anchor', gender: 'women', colors: ['siyah'], fit: null, subcategory: 'gomlek',
      brand_slug: null, price_band: null, outfit_role: null, material: null, season: null, occasion: null, style_tags: null,
    }));
    expect(context.anchor.attributes.material).toMatchObject({ value: null, origin: 'unknown' });
    expect(context.anchor.attributes.styleTags).toEqual([]);
    expect(context.dimensions.styleTags).toEqual({ anchor: [], declared: 'not_declared', behavior: { status: 'not_applicable', anchorValues: [] } });
    expect(context.gaps).toContainEqual({ code: 'anchor_attribute_unknown', fields: ['fit', 'material', 'season', 'occasion', 'styleTags'] });
    expect(context.gaps.find(gap => gap.code === 'anchor_attribute_uncertain')).toMatchObject({
      fields: expect.arrayContaining([{ field: 'colors', confidence: 'unknown' }, { field: 'gender', confidence: 'unknown' }]),
    });
  });
});

describe('buildStyleContext: sparse profile', () => {
  it('passes sparse behavior through as unknown without promoting it', () => {
    const snapshot = user({ likedProducts: many(3, 'black', 'Kadın Siyah Gömlek').map(liked) });
    const context = buildStyleContext(anchorInput(blackShirt, { user: snapshot }));
    expect(context.sources.user).toEqual({ status: 'available', snapshotVersion: 1, profileStatus: 'unavailable', behaviorStatus: 'sparse' });
    expect(context.gaps).toEqual(expect.arrayContaining([{ code: 'profile_unavailable' }, { code: 'behavior_insufficient', status: 'sparse' }]));
    for (const dimension of STYLE_DIMENSIONS.filter(name => name !== 'styleTags')) {
      expect(context.dimensions[dimension].behavior).toEqual({ status: 'unknown', anchorValues: [] });
    }
  });
});

describe('buildStyleContext: conflicting preferences', () => {
  it('preserves a declared color the user keeps passing without picking a winner', () => {
    const snapshot = user({
      profile: profile({ preferredColors: ['Siyah'] }),
      likedProducts: many(6, 'white', 'Beyaz Gömlek').map(liked),
      passedProducts: many(5, 'black', 'Siyah Gömlek', { brand: 'Koton' }),
    });
    const context = buildStyleContext(anchorInput(blackShirt, { user: snapshot }));
    expect(context.dimensions.color.declared).toBe('declared_includes');
    expect(context.dimensions.color.behavior.anchorValues).toEqual([
      expect.objectContaining({ value: 'siyah', passCount: 5, likeCount: 0, direction: 'negative' }),
    ]);
    expect(context.conflicts).toEqual([
      { source: 'user', conflict: { code: 'declared_behavior_mismatch', field: 'preferredColors', values: ['siyah'] } },
      { source: 'context', code: 'declared_behavior_disagreement', dimension: 'color', value: 'siyah', behaviorDirection: 'negative' },
    ]);
    expect(context.declared?.preferredColors.value).toEqual(['siyah']);
  });

  it('keeps anchor product conflicts alongside user conflicts', () => {
    const suit = product('anchor', 'Erkek Lacivert Takım Elbise Ceket');
    const intelligence = buildProductIntelligence({ product: suit });
    const context = buildStyleContext(anchorInput(suit, { user: user() }));
    expect(intelligence.conflicts.length).toBeGreaterThan(0);
    expect(context.conflicts).toEqual(intelligence.conflicts.map(conflict => ({ source: 'anchor', conflict })));
  });

  it('does not invent a disagreement for mixed behavior', () => {
    const snapshot = user({
      profile: profile({ preferredColors: ['Siyah'] }),
      likedProducts: [...many(5, 'like', 'Siyah Gömlek'), ...many(3, 'other', 'Beyaz Gömlek')].map(liked),
      passedProducts: many(4, 'pass', 'Siyah Gömlek'),
    });
    const context = buildStyleContext(anchorInput(blackShirt, { user: snapshot }));
    expect(context.dimensions.color.behavior.anchorValues[0]).toMatchObject({ value: 'siyah', direction: 'mixed' });
    expect(context.conflicts.filter(conflict => conflict.source === 'context')).toEqual([]);
  });
});

describe('buildStyleContext: explicit vs behavior separation', () => {
  it('copies declared and behavioral evidence side by side without merging', () => {
    const snapshot = user({
      profile: profile({ preferredColors: ['Beyaz'], favoriteBrands: ['Koton'], styleTags: ['minimal'], priceRange: { min: 200, max: 1500 } }),
      likedProducts: many(12, 'black', 'Kadın Siyah Gömlek').map(liked),
    });
    const context = buildStyleContext(anchorInput(blackShirt, { user: snapshot }));
    expect(context.declared).toEqual(snapshot.declared);
    expect(context.behavior).toEqual(snapshot.behavior);
    expect(context.dimensions.color.declared).toBe('declared_excludes');
    expect(context.dimensions.color.behavior.anchorValues).toEqual([
      expect.objectContaining({ value: 'siyah', likeCount: 12, direction: 'positive', confidence: 'medium' }),
    ]);
    expect(context.dimensions.brand).toMatchObject({ declared: 'declared_excludes', behavior: { status: 'known' } });
    expect(context.dimensions.priceBand.declared).toBe('declared_includes');
    expect(context.dimensions.styleTags.declared).toBe('anchor_unknown');
    expect(context.dimensions.subtype.declared).toBe('not_applicable');
    expect(context.conflicts).toEqual([]);
    expect(JSON.stringify(context)).not.toMatch(/score|weight|rank/i);
  });

  it('compares the declared price range with the display price', () => {
    const snapshot = user({ profile: profile({ priceRange: { min: 200, max: 1500 } }) });
    const pricey = product('anchor', 'Siyah Gömlek', { price: 2000 });
    expect(buildStyleContext(anchorInput(pricey, { user: snapshot })).dimensions.priceBand.declared).toBe('declared_excludes');
  });
});

describe('buildStyleContext: session intent', () => {
  it('treats an untouched session as empty, not as a preference', () => {
    const context = buildStyleContext(anchorInput(blackShirt, { sessionIntent: emptySessionIntent() }));
    expect(context.session).toMatchObject({
      status: 'empty', hasActiveQuery: false,
      anchorRelations: { category: 'no_constraint', gender: 'no_constraint' },
    });
    expect(context.gaps).not.toContainEqual({ code: 'session_intent_unavailable' });
  });

  it('keeps explicit filters, drops the raw query and does not interpret weights', () => {
    const intent: SessionIntent = {
      ...emptySessionIntent(),
      weights: { ...emptySessionIntent().weights, colorW: { siyah: 0.8 } },
      constraints: { category: 'lower_body', gender: 'women', size: 'M' },
      query: 'gizli arama metni',
      lastSubcategory: 'gomlek',
    };
    const context = buildStyleContext(anchorInput(blackShirt, { sessionIntent: intent }));
    expect(context.session).toEqual({
      status: 'active',
      constraints: { category: 'lower_body', gender: 'women', size: 'M' },
      recent: { lastCategory: null, lastSubcategory: 'gomlek', lastTryShopSubcategory: null },
      hasActiveQuery: true,
      anchorRelations: { category: 'session_differs', gender: 'session_matches' },
    });
    expect(context.gaps).toContainEqual({ code: 'session_weights_not_interpreted' });
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain('gizli');
    expect(serialized).not.toContain('colorW');
    expect(serialized).not.toContain('0.8');
  });

  it('reports an unknown anchor gender against a gender filter', () => {
    const intent: SessionIntent = { ...emptySessionIntent(), constraints: { category: null, gender: 'men', size: null } };
    const context = buildStyleContext(anchorInput(product('anchor', 'Örnek Ürün'), { sessionIntent: intent }));
    expect(context.session.anchorRelations.gender).toBe('anchor_unknown');
  });
});

describe('buildStyleContext: purity', () => {
  it('is deterministic and never mutates inputs', () => {
    const snapshot = user({
      profile: profile({ preferredColors: ['Siyah'], priceRange: { min: 100, max: 900 } }),
      likedProducts: many(6, 'white', 'Beyaz Gömlek').map(liked),
      passedProducts: many(5, 'black', 'Siyah Gömlek'),
    });
    const intent: SessionIntent = { ...emptySessionIntent(), query: 'siyah', constraints: { category: 'upper_body', gender: null, size: null } };
    const data = anchorInput(blackShirt, { user: snapshot, sessionIntent: intent });
    const before = JSON.stringify(data);
    Object.freeze(data.anchor);
    Object.freeze(data.anchorIntelligence);
    Object.freeze(snapshot.declared);
    Object.freeze(snapshot.behavior);
    Object.freeze(intent.constraints);
    const first = buildStyleContext(data);
    const second = buildStyleContext(data);
    expect(second).toEqual(first);
    expect(JSON.stringify(data)).toBe(before);
  });
});

describe('Style Intelligence boundary', () => {
  const root = join(__dirname, '..');
  const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
  const source = readFileSync(join(root, 'src/intelligence/style/styleContext.ts'), 'utf8');
  const lines = source.split(/\r?\n/);
  const importLines = lines.filter(line => /^\s*(import|export .* from)|from '/.test(line));
  const codeLines = lines.filter(line => !/^\s*(\/\/|\*|\/\*\*)/.test(line));

  it('is not imported by any app flow', () => {
    const importers = ['app', 'components', 'services', 'store', 'lib', 'hooks', 'src']
      .map(dir => join(root, dir))
      .filter(dir => existsSync(dir))
      .flatMap(sourceFiles)
      .filter(path => /style\/styleContext|types\/styleContext/.test(readFileSync(path, 'utf8')))
      .map(path => relative(root, path).replace(/\\/g, '/'));
    // The compatibility gate is itself unwired; its own boundary test enforces that.
    expect(importers).toEqual(['src/intelligence/compatibility/compatibilityGate.ts', 'src/intelligence/style/styleContext.ts']);
  });

  it('imports no session state, store, backend, scoring or recommendation modules', () => {
    const imports = importLines.join('\n');
    for (const forbidden of ['lib/sessionIntent', 'lib/scoring', '/store/', '/services/', 'supabase', 'AsyncStorage',
      'analytics', 'recommendationCache', 'compatib', 'productStyle']) {
      expect(imports).not.toContain(forbidden);
    }
    expect(imports).toMatch(/import type \{ SessionIntent \} from '..\/..\/..\/types\/recommendation'/);
  });

  it('uses no time, randomness, network or caching', () => {
    const code = codeLines.join('\n');
    for (const forbidden of ['Date.now', 'new Date', 'Math.random', 'fetch(', 'setTimeout', '.set(', 'console.']) {
      expect(code).not.toContain(forbidden);
    }
  });
});

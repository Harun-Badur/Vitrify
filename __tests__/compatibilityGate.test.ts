import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { emptySessionIntent } from '../lib/scoring';
import { evaluateCompatibility } from '../src/intelligence/compatibility/compatibilityGate';
import { COMPATIBILITY_POLICY_V1 } from '../src/intelligence/compatibility/compatibilityPolicy';
import { buildProductIntelligence } from '../src/intelligence/product/productIntelligence';
import { buildStyleContext } from '../src/intelligence/style/styleContext';
import { buildUserSnapshot } from '../src/intelligence/user/userSnapshot';
import type { CompatibilityResult } from '../types/compatibility';
import { OUTFIT_ROLES, type LikedProduct, type OutfitRole, type Product, type ProductGender } from '../types/product';
import type { ProductIntelligence, ProductSemanticConflict, ProductSignal } from '../types/productIntelligence';
import type { UserStudioProfile } from '../types/profile';
import type { SessionIntent } from '../types/recommendation';
import type { StyleContext } from '../types/styleContext';
import type { UserSnapshot } from '../types/userSnapshot';

const product = (id: string, title: string, patch: Partial<Product> = {}): Product => ({
  id, title, category: 'upper_body', brand: 'Mavi', price: 400,
  imageUrl: `https://example.com/${id}.jpg`, garmentDescription: title, ...patch,
});
const reliable = <T>(value: T): ProductSignal<T> => ({ value, origin: 'declared', source: 'catalog_repair', confidence: 'high' });
const lowSignal = <T>(value: T): ProductSignal<T> => ({ value, origin: 'derived', source: 'title_inferred', confidence: 'low' });
const unknownSignal = <T>(): ProductSignal<T> => ({ value: null, origin: 'unknown', source: 'unknown', confidence: 'unknown' });

interface Item { product: Product; intelligence: ProductIntelligence }

const item = (
  base: Product,
  patch: { role?: ProductSignal<OutfitRole>; gender?: ProductSignal<ProductGender>; conflicts?: ProductSemanticConflict[] } = {},
): Item => ({ product: base, intelligence: { ...buildProductIntelligence({ product: base }), ...patch } });

const contextFor = (anchor: Item, user: UserSnapshot | null = null, sessionIntent: SessionIntent | null = null): StyleContext =>
  buildStyleContext({ anchor: anchor.product, anchorIntelligence: anchor.intelligence, user, sessionIntent });

const evaluate = (anchor: Item | StyleContext, candidate: Item): CompatibilityResult => evaluateCompatibility({
  context: 'version' in anchor ? anchor : contextFor(anchor),
  candidate: candidate.product,
  candidateIntelligence: candidate.intelligence,
});
const check = (result: CompatibilityResult, name: string) => result.checks.find(entry => entry.check === name);

const shirt = (id = 'shirt') => item(product(id, 'Kadın Siyah Gömlek'));
const jeans = (id = 'jeans') => item(product(id, 'Kadın Mavi Jean Pantolon', { category: 'lower_body' }));
const sneakers = (id: string) => item(product(id, 'Siyah Spor Ayakkabı', { category: 'shoes' }));
const dress = (id = 'dress') => item(product(id, 'Kadın Siyah Elbise', { category: 'dresses' }));

describe('Compatibility policy table', () => {
  it('is versioned, symmetric and covers every role pair', () => {
    expect(COMPATIBILITY_POLICY_V1.version).toBe(1);
    for (const a of OUTFIT_ROLES) {
      for (const b of OUTFIT_ROLES) {
        expect(COMPATIBILITY_POLICY_V1.roleRelations[a][b]).toEqual(COMPATIBILITY_POLICY_V1.roleRelations[b][a]);
      }
    }
  });

  it('hard-rejects only single-body-slot duplicates and leaves layering open', () => {
    const exclusive = OUTFIT_ROLES.flatMap(a => OUTFIT_ROLES
      .filter(b => COMPATIBILITY_POLICY_V1.roleRelations[a][b].relation === 'exclusive_slot')
      .map(b => `${a}|${b}`));
    expect(exclusive).toEqual(['shoes|shoes', 'hat|hat']);
    expect(COMPATIBILITY_POLICY_V1.roleRelations.one_piece.top).toEqual({ relation: 'context_dependent', rationale: 'layering_varies' });
    expect(COMPATIBILITY_POLICY_V1.roleRelations.top.bottom).toEqual({ relation: 'complementary', rationale: 'distinct_slots' });
  });
});

describe('evaluateCompatibility: role relations', () => {
  it('accepts a top with a bottom as complementary', () => {
    const result = evaluate(shirt(), jeans());
    expect(result).toMatchObject({ version: 1, policyVersion: 1, anchorId: 'shirt', candidateId: 'jeans', outcome: 'eligible' });
    expect(check(result, 'role')).toMatchObject({ status: 'pass', code: 'role_complementary' });
    expect(result.reasons).toEqual(['distinct_products', 'role_complementary', 'gender_match', 'session_gender_no_filter']);
  });

  it('rejects a second pair of shoes when both roles are reliable', () => {
    const result = evaluate(sneakers('a'), sneakers('b'));
    expect(result.outcome).toBe('rejected');
    expect(result.reasons).toEqual(['role_exclusive_slot']);
    expect(check(result, 'role')?.evidence).toEqual([
      { subject: 'anchor', field: 'role', value: 'shoes', source: 'category_rule', confidence: 'medium', reliable: true },
      { subject: 'candidate', field: 'role', value: 'shoes', source: 'category_rule', confidence: 'medium', reliable: true },
    ]);
  });

  it('rejects the anchor itself as a candidate', () => {
    const anchor = shirt();
    expect(evaluate(anchor, anchor)).toMatchObject({ outcome: 'rejected', reasons: ['candidate_is_anchor'] });
  });

  it('keeps layering pairs eligible but marks them context dependent', () => {
    for (const [anchor, candidate] of [[shirt('a'), shirt('b')], [dress(), shirt()], [dress(), jeans()]]) {
      const result = evaluate(anchor, candidate);
      expect(result.outcome).toBe('eligible');
      expect(check(result, 'role')?.code).toBe('role_context_dependent');
    }
  });
});

describe('evaluateCompatibility: unknown role and missing metadata', () => {
  it('returns insufficient evidence, not a rejection, for an unknown role', () => {
    const result = evaluate(sneakers('a'), item(product('x', 'Örnek Ürün'), { role: unknownSignal() }));
    expect(result.outcome).toBe('insufficient_evidence');
    expect(result.reasons).toEqual(['role_unknown']);
  });

  it('does not reject an exclusive slot built on low-confidence or conflicted roles', () => {
    const low = evaluate(sneakers('a'), item(sneakers('b').product, { role: lowSignal('shoes') }));
    expect(low).toMatchObject({ outcome: 'insufficient_evidence', reasons: ['role_exclusive_slot_unverified'] });
    const conflicted = evaluate(sneakers('a'), item(sneakers('b').product, {
      conflicts: [{ field: 'role', code: 'role_category_mismatch', values: ['shoes', 'bags'] }],
    }));
    expect(conflicted.outcome).toBe('insufficient_evidence');
    expect(check(conflicted, 'role')?.evidence[1]).toMatchObject({ reliable: false, confidence: 'medium' });
  });

  it('never rejects for unknown color, season, occasion or style tags', () => {
    const result = evaluate(shirt(), item(product('plain', 'Örnek Ürün', { category: 'lower_body' })));
    expect(result.outcome).toBe('eligible');
    expect(result.unknowns.candidate).toEqual(expect.arrayContaining(['colors', 'season', 'occasion', 'styleTags', 'material', 'gender']));
    expect(result.unknowns.anchor).toEqual(expect.arrayContaining(['season', 'occasion', 'styleTags']));
  });

  it('rejects intelligence that belongs to another product', () => {
    expect(() => evaluateCompatibility({
      context: contextFor(shirt()), candidate: jeans().product, candidateIntelligence: shirt('other').intelligence,
    })).toThrow('does not describe the candidate');
  });
});

describe('evaluateCompatibility: gender', () => {
  it('passes an unknown gender without rejecting', () => {
    const result = evaluate(shirt(), item(jeans().product, { gender: unknownSignal() }));
    expect(check(result, 'gender')).toMatchObject({ status: 'pass', code: 'gender_unknown' });
    expect(result.outcome).toBe('eligible');
  });

  it('treats a low-confidence women/men mismatch as insufficient evidence', () => {
    const result = evaluate(shirt(), item(product('m', 'Erkek Mavi Jean Pantolon', { category: 'lower_body' })));
    expect(check(result, 'gender')).toMatchObject({ status: 'insufficient', code: 'gender_conflict_unverified' });
    expect(result.outcome).toBe('insufficient_evidence');
  });

  it('rejects a women/men mismatch only when both genders are reliable', () => {
    const anchor = item(shirt().product, { gender: reliable('women') });
    const result = evaluate(anchor, item(jeans().product, { gender: reliable('men') }));
    expect(result).toMatchObject({ outcome: 'rejected', reasons: ['gender_conflict'] });
    const conflicted = evaluate(anchor, item(jeans().product, {
      gender: reliable('men'), conflicts: [{ field: 'gender', code: 'declared_inferred_mismatch', values: ['men', 'women'] }],
    }));
    expect(conflicted.outcome).toBe('insufficient_evidence');
  });

  it('treats unisex as compatible with women and men', () => {
    const anchor = item(shirt().product, { gender: reliable('women') });
    const result = evaluate(anchor, item(jeans().product, { gender: reliable('unisex') }));
    expect(check(result, 'gender')).toMatchObject({ status: 'pass', code: 'gender_unisex_compatible' });
  });

  it('applies the session gender filter with unisex compatibility', () => {
    const intent = (gender: string): SessionIntent => ({ ...emptySessionIntent(), constraints: { category: null, gender, size: null } });
    const anchor = shirt();
    const run = (gender: string, candidate: Item) => evaluate(contextFor(anchor, null, intent(gender)), candidate);
    expect(check(run('men', item(jeans().product, { gender: reliable('unisex') })), 'session_gender')?.code)
      .toBe('session_gender_unisex_compatible');
    expect(run('men', item(jeans().product, { gender: reliable('women') }))).toMatchObject({
      outcome: 'rejected', reasons: ['session_gender_mismatch'],
    });
    expect(run('men', jeans())).toMatchObject({ outcome: 'insufficient_evidence', reasons: ['session_gender_mismatch_unverified'] });
    expect(check(run('men', item(jeans().product, { gender: unknownSignal() })), 'session_gender')?.code).toBe('session_gender_unknown');
    expect(check(run('kids', jeans()), 'session_gender')).toMatchObject({ status: 'pass', code: 'session_gender_filter_unrecognized' });
  });
});

describe('evaluateCompatibility: StyleContext gaps and conflicts', () => {
  it('carries context gaps without letting them decide', () => {
    const context = contextFor(shirt());
    const result = evaluate(context, jeans());
    expect(result.outcome).toBe('eligible');
    expect(result.contextGaps).toEqual(context.gaps);
    expect(result.contextGaps).toContainEqual({ code: 'user_snapshot_unavailable' });
  });

  it('downgrades an anchor role with a reported conflict to unverified', () => {
    const anchor = item(sneakers('a').product, {
      conflicts: [{ field: 'subtype', code: 'subtype_category_mismatch', values: ['canta', 'shoes'] }],
    });
    const context = contextFor(anchor);
    const result = evaluate(context, sneakers('b'));
    expect(result).toMatchObject({ outcome: 'insufficient_evidence', reasons: ['role_exclusive_slot_unverified'] });
    expect(check(result, 'role')?.evidence[0]).toMatchObject({ subject: 'anchor', reliable: false });
    expect(result.contextConflicts).toEqual(context.conflicts);
  });

  it('lets a reliable rejection stand even when other evidence is insufficient', () => {
    const result = evaluate(sneakers('a'), item(sneakers('b').product, { gender: lowSignal('men') }));
    expect(item(sneakers('a').product).intelligence.gender.value).toBeNull();
    expect(result).toMatchObject({ outcome: 'rejected', reasons: ['role_exclusive_slot'] });
  });
});

describe('evaluateCompatibility: explicit vs behavioral preferences', () => {
  const liked = (entry: Product): LikedProduct => ({ product: entry, notifyOnPriceDrop: true, likedAt: '2026-10-01T10:00:00.000Z' });
  const many = (count: number, prefix: string, title: string, patch: Partial<Product> = {}): Product[] =>
    Array.from({ length: count }, (_, index) => product(`${prefix}-${index}`, title, patch));
  const profile = (patch: Partial<UserStudioProfile>): UserStudioProfile => ({
    userId: 'user-1', heightCm: null, weightKg: null, topSize: null, bottomSize: null, styleTags: [], modelPhotoPath: null, ...patch,
  });

  it('reports declared and behavioral evidence separately and never rejects on them', () => {
    const user = buildUserSnapshot({
      userId: 'user-1',
      profile: profile({ preferredColors: ['Beyaz'], favoriteBrands: ['Koton'], priceRange: { min: 100, max: 300 } }),
      likedProducts: many(6, 'white', 'Beyaz Gömlek').map(liked),
      passedProducts: many(6, 'black', 'Kadın Siyah Jean Pantolon', { category: 'lower_body' }),
      passedProductIds: many(6, 'black', 'x').map(entry => entry.id),
    });
    const candidate = item(product('black-jeans', 'Kadın Siyah Jean Pantolon', { category: 'lower_body' }));
    const result = evaluate(contextFor(shirt(), user), candidate);
    expect(result.outcome).toBe('eligible');
    expect(result.preferences.color.declared).toBe('declared_excludes');
    expect(result.preferences.color.behavior.anchorValues).toEqual([
      expect.objectContaining({ value: 'siyah', passCount: 6, direction: 'negative' }),
    ]);
    expect(result.preferences.brand.declared).toBe('declared_excludes');
    expect(result.preferences.priceBand.declared).toBe('declared_excludes');
    expect(result.checks.map(entry => entry.check)).toEqual(['identity', 'role', 'gender', 'session_gender']);
  });
});

describe('evaluateCompatibility: purity', () => {
  it('is deterministic, scoreless and never mutates inputs', () => {
    const context = contextFor(shirt(), null, { ...emptySessionIntent(), constraints: { category: null, gender: 'women', size: null } });
    const candidate = jeans();
    const before = JSON.stringify({ context, candidate });
    Object.freeze(context);
    Object.freeze(candidate.product);
    Object.freeze(candidate.intelligence);
    const first = evaluate(context, candidate);
    expect(evaluate(context, candidate)).toEqual(first);
    expect(JSON.stringify({ context, candidate })).toBe(before);
    expect(Object.keys(first)).not.toEqual(expect.arrayContaining(['score']));
    expect(JSON.stringify(first.checks)).not.toMatch(/score|rank|weight/i);
  });
});

describe('Compatibility Gate boundary', () => {
  const root = join(__dirname, '..');
  const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
  const gateFiles = ['src/intelligence/compatibility/compatibilityGate.ts', 'src/intelligence/compatibility/compatibilityPolicy.ts'];

  it('is not imported by any app flow', () => {
    const importers = ['app', 'components', 'services', 'store', 'lib', 'hooks', 'src']
      .map(dir => join(root, dir))
      .filter(dir => existsSync(dir))
      .flatMap(sourceFiles)
      .filter(path => /compatibilityGate|compatibilityPolicy|types\/compatibility/.test(readFileSync(path, 'utf8')))
      .map(path => relative(root, path).replace(/\\/g, '/'));
    expect(importers).toEqual(['src/intelligence/compatibility/compatibilityGate.ts', 'src/intelligence/compatibility/compatibilityPolicy.ts']);
  });

  it('imports no ranking, selection, session state, store or backend modules', () => {
    for (const file of gateFiles) {
      const lines = readFileSync(join(root, file), 'utf8').split(/\r?\n/);
      const imports = lines.filter(line => /from '/.test(line)).join('\n');
      for (const forbidden of ['ranking', 'recommendations', 'recommendationCache', 'outfits', 'scoring', 'lib/sessionIntent',
        '/store/', '/services/', 'supabase', 'AsyncStorage', 'analytics']) {
        expect(imports).not.toContain(forbidden);
      }
      const code = lines.filter(line => !/^\s*(\/\/|\*|\/\*\*)/.test(line)).join('\n');
      for (const forbidden of ['Date.now', 'new Date', 'Math.random', 'fetch(', 'console.', '.sort(']) {
        expect(code).not.toContain(forbidden);
      }
    }
  });
});

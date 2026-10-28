import { evaluatePair } from '../src/intelligence/pairing/pairing';
import { PAIRING_POLICY_V2, PAIRING_POLICY_V3, POSITIVE_EVIDENCE_V1 } from '../src/intelligence/pairing/pairingPolicy';
import type { PairItem, PairSignal } from '../src/intelligence/pairing/pairingTypes';
import { ACTIVE_CATALOG_PAIRING_POLICY, catalogPairDecision } from '../src/intelligence/recommendations/catalogPairing';
import type { OutfitRole, Product } from '../types/product';

// Faz 4 V3: a pair is eligible only with positive evidence from at least two of formality, season
// and color; an unknown dimension is not evidence. V2 stays the default.

const known = <T>(value: T, confidence: PairSignal<T>['confidence'] = 'high'): PairSignal<T> =>
  ({ value, source: 'catalog_repair', confidence });
const unknown = <T>(): PairSignal<T> => ({ value: null, source: 'unknown', confidence: 'unknown' });

const item = (id: string, subtype: string | null, colors: readonly string[] | undefined, patch: Partial<PairItem> = {}): PairItem => ({
  id, role: known('top'), gender: known('men'), subtype: subtype ? known(subtype) : unknown(), conflicts: [], colors, ...patch,
});
const v3 = (anchor: PairItem, candidate: PairItem) =>
  evaluatePair({ anchor, candidate, sessionGender: null, policy: PAIRING_POLICY_V3 });
const bottom = (id: string, subtype: string | null, colors?: readonly string[]) =>
  item(id, subtype, colors, { role: known('bottom') });
const positive = (result: ReturnType<typeof v3>) => result.checks.find(check => check.check === 'positive_evidence')!;

describe('policy constants', () => {
  it('V3 builds on V2 and pins a versioned threshold of two dimensions', () => {
    expect(PAIRING_POLICY_V3.version).toBe(3);
    expect(PAIRING_POLICY_V3.roleRelations).toBe(PAIRING_POLICY_V2.roleRelations);
    expect(PAIRING_POLICY_V3.s3b).toEqual(PAIRING_POLICY_V2.s3b);
    expect(POSITIVE_EVIDENCE_V1).toEqual({ version: 1, minDimensions: 2, dimensions: ['formality', 'season', 'color'] });
    expect(PAIRING_POLICY_V3.positiveEvidence).toBe(POSITIVE_EVIDENCE_V1);
    expect(PAIRING_POLICY_V2.positiveEvidence).toBeUndefined();
  });

  it('V2 stays the active catalog policy (flipping it is a one-line change)', () => {
    expect(ACTIVE_CATALOG_PAIRING_POLICY).toBe(PAIRING_POLICY_V2);
  });
});

describe('positive evidence rule', () => {
  it('is eligible with two known, compatible dimensions and no conflict', () => {
    const result = v3(item('a', 'sort', ['siyah']), bottom('b', 'sort', ['siyah']));
    expect(result.outcome).toBe('eligible');
    expect(positive(result).code).toBe('positive_evidence_sufficient');
    expect(positive(result).evidence.filter(entry => entry.reliable).map(entry => entry.field).sort())
      .toEqual(['color', 'formality', 'season']);
  });

  it('two dimensions are enough: season + color without a known formality', () => {
    const result = v3(item('a', 'kazak', ['siyah']), bottom('b', 'kazak', ['beyaz']));
    expect(result.outcome).toBe('eligible');
  });

  it('an unknown dimension is not evidence: one known dimension is uncertain', () => {
    const result = v3(item('a', null, ['siyah']), bottom('b', null, ['siyah']));
    expect(result.outcome).toBe('insufficient_evidence');
    expect(result.reasons).toEqual(['positive_evidence_insufficient']);
  });

  it('missing colors count as unknown, not as a match', () => {
    expect(v3(item('a', 'kazak', undefined), bottom('b', 'kazak', [])).outcome).toBe('insufficient_evidence');
  });

  it('colors are compatible when shared or when either side has a neutral; two different chromatic colors are no evidence', () => {
    expect(positive(v3(item('a', null, ['kirmizi']), bottom('b', null, ['kirmizi']))).evidence.find(e => e.field === 'color')!.reliable).toBe(true);
    expect(positive(v3(item('a', null, ['kirmizi']), bottom('b', null, ['siyah']))).evidence.find(e => e.field === 'color')!.reliable).toBe(true);
    const clash = positive(v3(item('a', null, ['kirmizi']), bottom('b', null, ['yesil'])));
    expect(clash.evidence.find(e => e.field === 'color')!.reliable).toBe(false);
  });

  it('an unreliable subtype gives no formality or season evidence', () => {
    const weak = (id: string) => item(id, 'sort', ['siyah'], { subtype: known('sort', 'unknown'), role: known('bottom') });
    expect(v3(weak('a'), weak('b')).outcome).toBe('insufficient_evidence');
  });

  it('a conflict still rejects, whatever the evidence (V2 rules are kept)', () => {
    expect(v3(item('a', 'blazer', ['siyah']), bottom('b', 'kargo', ['siyah'])).reasons).toEqual(['formality_conflict']);
    expect(v3(item('a', 'mont', ['siyah']), bottom('b', 'sort', ['siyah'])).reasons).toEqual(['season_conflict']);
    expect(v3(item('a', 'sort', ['siyah']), item('a', 'sort', ['siyah'])).outcome).toBe('rejected');
  });

  it('gender and role rules of V2 still apply', () => {
    expect(v3(item('a', 'sort', ['siyah']), bottom('b', 'sort', ['siyah']))
      .checks.find(check => check.check === 'gender')!.code).toBe('gender_match');
    const unknownGender = v3(item('a', 'sort', ['siyah']), { ...bottom('b', 'sort', ['siyah']), gender: unknown() });
    expect(unknownGender.outcome).toBe('insufficient_evidence');
    expect(unknownGender.reasons).toContain('gender_unknown');
  });

  it('is never more permissive than V2', () => {
    const subtypes = [null, 'sort', 'kargo', 'blazer', 'mont', 'kazak', 'jean', 'kaban'];
    const palettes: (readonly string[] | undefined)[] = [undefined, [], ['siyah'], ['kirmizi'], ['yesil']];
    let eligibleV3 = 0, eligibleV2 = 0;
    for (const sa of subtypes) for (const sb of subtypes) for (const ca of palettes) for (const cb of palettes) {
      const anchor = item('a', sa, ca), candidate = bottom('b', sb, cb);
      const two = evaluatePair({ anchor, candidate, sessionGender: null, policy: PAIRING_POLICY_V2 });
      const three = v3(anchor, candidate);
      if (three.outcome === 'eligible') { eligibleV3++; expect(two.outcome).toBe('eligible'); }
      if (two.outcome === 'eligible') eligibleV2++;
    }
    expect(eligibleV3).toBeLessThanOrEqual(eligibleV2);
  });
});

describe('catalog adapter carries colors', () => {
  const product = (id: string, title: string, category: Product['category'], role: OutfitRole, patch: Partial<Product> = {}): Product => ({
    id, title, category, outfitRole: role, brand: 'B', price: 1, imageUrl: 'x', garmentDescription: title, gender: 'men', ...patch,
  });

  it('feeds colorSlugs to pairing; V3 can be selected explicitly', () => {
    const tee = product('t', 'Erkek Kazak', 'upper_body', 'top', { subcategory: 'kazak', colorSlugs: ['siyah'] });
    const jeans = product('j', 'Erkek Kazak Pantolon', 'lower_body', 'bottom', { subcategory: 'kazak', colorSlugs: ['beyaz'] });
    expect(catalogPairDecision(tee, jeans).policyVersion).toBe(2);
    const noColor = { ...jeans, colorSlugs: [] };
    expect(catalogPairDecision(tee, noColor, PAIRING_POLICY_V3).outcome).toBe('insufficient_evidence');
    expect(catalogPairDecision(tee, jeans, PAIRING_POLICY_V3).outcome).toBe('eligible');
  });
});

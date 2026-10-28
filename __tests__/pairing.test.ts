import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { evaluateCompatibility } from '../src/intelligence/compatibility/compatibilityGate';
import { COMPATIBILITY_POLICY_V1 } from '../src/intelligence/compatibility/compatibilityPolicy';
import { evaluatePair, pairItemFromSignals } from '../src/intelligence/pairing/pairing';
import { PAIRING_EVIDENCE_POLICY_V1, PAIRING_POLICY_V1 } from '../src/intelligence/pairing/pairingPolicy';
import {
  PAIR_ROLES,
  type PairConfidence,
  type PairConflictCode,
  type PairGender,
  type PairRole,
  type PairSignalSource,
} from '../src/intelligence/pairing/pairingTypes';
import { buildProductIntelligence } from '../src/intelligence/product/productIntelligence';
import { buildStyleContext } from '../src/intelligence/style/styleContext';
import { OUTFIT_ROLES, type OutfitRole, type Product, type ProductGender } from '../types/product';
import type {
  ProductConflictCode,
  ProductIntelligence,
  ProductSemanticConflict,
  ProductSignal,
  ProductSignalConfidence,
  ProductSignalSource,
} from '../types/productIntelligence';
import type { SessionIntent } from '../types/recommendation';
import { emptySessionIntent } from '../lib/scoring';
import { LEGACY_COMPATIBILITY_POLICY_V1, legacyEvaluateCompatibility } from './fixtures/legacyCompatibilityGate';
import { b0PrimeSourcesPresent, loadB0PrimeDataset } from './fixtures/b0PrimeReplay';
import { productIntelligenceInputFromContext } from '../src/intelligence/product/productIntelligence';

// The pairing schema mirrors the product unions; these fail to compile when they drift apart.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const assertTrue = <T extends true>(): T => true as T;
assertTrue<Same<PairRole, OutfitRole>>();
assertTrue<Same<PairGender, ProductGender>>();
assertTrue<Same<PairConfidence, ProductSignalConfidence>>();
assertTrue<Same<PairConflictCode, ProductConflictCode>>();
assertTrue<Same<Exclude<PairSignalSource, 'derived_from_subtype' | 'human_review'>, ProductSignalSource>>();

const product = (id: string, title: string, patch: Partial<Product> = {}): Product => ({
  id, title, category: 'upper_body', brand: 'Mavi', price: 400,
  imageUrl: `https://example.com/${id}.jpg`, garmentDescription: title, ...patch,
});

const signal = <T>(value: T | null, confidence: ProductSignalConfidence): ProductSignal<T> => value === null
  ? { value: null, origin: 'unknown', source: 'unknown', confidence: 'unknown' }
  : confidence === 'high'
    ? { value, origin: 'declared', source: 'catalog_repair', confidence }
    : { value, origin: 'derived', source: 'title_inferred', confidence };

interface Item { product: Product; intelligence: ProductIntelligence }

const item = (
  id: string,
  role: OutfitRole | null,
  gender: ProductGender | null,
  confidence: ProductSignalConfidence,
  conflicts: ProductSemanticConflict[] = [],
  subtype: string | null = null,
): Item => {
  const base = product(id, id);
  return {
    product: base,
    intelligence: {
      ...buildProductIntelligence({ product: base }),
      role: signal(role, confidence),
      gender: signal(gender, confidence),
      subtype: signal(subtype, confidence),
      conflicts,
    },
  };
};

const session = (gender: string | null): SessionIntent | null =>
  (gender === null ? null : { ...emptySessionIntent(), constraints: { category: null, gender, size: null } });

const ROLES: (OutfitRole | null)[] = [...OUTFIT_ROLES, null];
const GENDERS: (ProductGender | null)[] = ['women', 'men', 'unisex', null];
const CONFIDENCES: ProductSignalConfidence[] = ['high', 'low'];
const CONFLICTS: ProductSemanticConflict[][] = [
  [],
  [{ field: 'subtype', code: 'suit_blazer_ambiguity', values: ['blazer'] }],
  [{ field: 'gender', code: 'declared_inferred_mismatch', values: ['women', 'men'] }],
];
const SESSIONS: (string | null)[] = [null, 'women', 'men', 'unisex', 'kids'];

describe('pairing schema and policy', () => {
  it('keeps the role list and the policy of the absorbed gate', () => {
    expect([...PAIR_ROLES]).toEqual([...OUTFIT_ROLES]);
    expect(PAIRING_POLICY_V1).toEqual(LEGACY_COMPATIBILITY_POLICY_V1);
    expect(COMPATIBILITY_POLICY_V1).toBe(PAIRING_POLICY_V1);
  });
});

describe('pairing equality with the S1 gate (synthetic grid)', () => {
  const candidates = ROLES.flatMap(role => GENDERS.flatMap(gender => CONFIDENCES.flatMap(confidence =>
    CONFLICTS.map(conflicts => item('candidate', role, gender, confidence, conflicts)))));

  const compareAll = (anchor: Item, sessionGender: string | null): number => {
    const context = buildStyleContext({
      anchor: anchor.product, anchorIntelligence: anchor.intelligence, user: null, sessionIntent: session(sessionGender),
    });
    expect(context.session.constraints.gender).toBe(sessionGender);
    for (const candidate of [...candidates, anchor]) {
      const input = { context, candidate: candidate.product, candidateIntelligence: candidate.intelligence };
      expect(evaluateCompatibility(input)).toEqual(legacyEvaluateCompatibility(input));
    }
    return candidates.length + 1;
  };

  it('returns the same result as the frozen gate for every anchor and candidate role, gender, confidence and conflict', () => {
    let compared = 0;
    for (const role of ROLES) for (const gender of GENDERS) for (const confidence of CONFIDENCES) for (const conflicts of CONFLICTS) {
      compared += compareAll(item('anchor', role, gender, confidence, conflicts), null);
    }
    expect(compared).toBe(216 * 217);
  });

  it('returns the same result as the frozen gate under every session gender filter', () => {
    let compared = 0;
    for (const sessionGender of SESSIONS) for (const gender of GENDERS) for (const confidence of CONFIDENCES) {
      compared += compareAll(item('anchor', 'top', gender, confidence), sessionGender);
    }
    expect(compared).toBe(5 * 4 * 2 * 217);
  });
});

describe('pairing evidence (reported, never decisive)', () => {
  const pair = (anchor: Item, candidate: Item, sessionGender: string | null = null) => evaluatePair({
    anchor: pairItemFromSignals(anchor.product.id, anchor.intelligence, anchor.intelligence.conflicts),
    candidate: pairItemFromSignals(candidate.product.id, candidate.intelligence, candidate.intelligence.conflicts),
    sessionGender,
  });

  it('reports unknown gender as unknown and a heuristic unisex as unverified', () => {
    const result = pair(item('suit', 'outerwear', 'men', 'high'), item('necklace', 'accessory', 'unisex', 'low'));
    expect(result.outcome).toBe('eligible');
    expect(result.evidence.gender).toEqual([
      { subject: 'anchor', value: 'men', source: 'catalog_repair', confidence: 'high', status: 'reliable' },
      { subject: 'candidate', value: 'unisex', source: 'title_inferred', confidence: 'low', status: 'unverified' },
    ]);
    const unknown = pair(item('a', 'top', 'women', 'high'), item('b', 'bottom', null, 'high'));
    expect(unknown.reasons).toContain('gender_unknown');
    expect(unknown.evidence.gender[1]).toEqual({ subject: 'candidate', value: null, source: 'unknown', confidence: 'unknown', status: 'unknown' });
  });

  it('a conflicting gender value is never reliable', () => {
    const conflicted = item('c', 'top', 'women', 'high', [{ field: 'gender', code: 'declared_inferred_mismatch', values: [] }]);
    expect(pair(item('a', 'bottom', 'men', 'high'), conflicted).evidence.gender[1].status).toBe('unverified');
  });

  it('derives season and formality from the subtype with derived_from_subtype provenance', () => {
    const suit = item('suit', 'outerwear', 'men', 'high', [], 'blazer');
    const shorts = item('shorts', 'bottom', 'men', 'low', [], 'sort');
    const result = pair(suit, shorts);
    expect(result.evidence.formality).toEqual([
      { subject: 'anchor', value: 'formal', source: 'derived_from_subtype', confidence: 'high', status: 'reliable' },
      { subject: 'candidate', value: 'casual', source: 'derived_from_subtype', confidence: 'low', status: 'unverified' },
    ]);
    expect(result.evidence.season).toEqual([
      { subject: 'anchor', value: null, source: 'unknown', confidence: 'unknown', status: 'unknown' },
      { subject: 'candidate', value: 'warm', source: 'derived_from_subtype', confidence: 'low', status: 'unverified' },
    ]);
  });

  it('season and formality never change the outcome or reasons (S2)', () => {
    for (const anchorSubtype of [null, 'blazer', 'kazak', 'sort'])
      for (const candidateSubtype of [null, 'blazer', 'kazak', 'sort', 'kargo', 'esofman']) {
        const bare = pair(item('a', 'outerwear', 'men', 'high'), item('b', 'bottom', 'men', 'high'));
        const withSubtypes = pair(item('a', 'outerwear', 'men', 'high', [], anchorSubtype),
          item('b', 'bottom', 'men', 'high', [], candidateSubtype));
        expect({ outcome: withSubtypes.outcome, reasons: withSubtypes.reasons, checks: withSubtypes.checks })
          .toEqual({ outcome: bare.outcome, reasons: bare.reasons, checks: bare.checks });
      }
  });

  it('maps only coarse subtypes; an unmapped subtype stays unknown', () => {
    expect(PAIRING_EVIDENCE_POLICY_V1.seasonBySubtype.ceket).toBeUndefined();
    expect(PAIRING_EVIDENCE_POLICY_V1.formalityBySubtype.gomlek).toBeUndefined();
  });
});

describe('pairing boundary (Edge-compatible)', () => {
  const root = join(__dirname, '..');
  const dir = join(root, 'src/intelligence/pairing');
  const files = readdirSync(dir).filter(name => name.endsWith('.ts'));

  it('imports only sibling .ts files and no runtime-specific modules', () => {
    for (const name of files) {
      const lines = readFileSync(join(dir, name), 'utf8').split(/\r?\n/);
      for (const line of lines.filter(entry => /from '/.test(entry))) {
        expect(line).toMatch(/from '\.\/[A-Za-z]+\.ts';$/);
      }
      const code = lines.filter(line => !/^\s*(\/\/|\*|\/\*\*)/.test(line)).join('\n');
      for (const forbidden of ['require(', 'react', 'AsyncStorage', 'process.', 'Date.now', 'new Date', 'Math.random', 'fetch(', 'console.', '.sort(']) {
        expect(code).not.toContain(forbidden);
      }
    }
  });

  it('is reached by app code only through the gate adapter and the S3b catalog adapter', () => {
    const sourceFiles = (path: string): string[] => readdirSync(path).flatMap(name => {
      const child = join(path, name);
      if (statSync(child).isDirectory()) return sourceFiles(child);
      return /\.(ts|tsx)$/.test(name) ? [child] : [];
    });
    const importers = ['app', 'components', 'services', 'store', 'lib', 'hooks', 'src']
      .map(entry => join(root, entry))
      .filter(entry => existsSync(entry))
      .flatMap(sourceFiles)
      .filter(path => /pairing\/pairing/.test(readFileSync(path, 'utf8')))
      .map(path => relative(root, path).replace(/\\/g, '/'))
      .filter(path => !path.startsWith('src/intelligence/pairing/'));
    expect(importers).toEqual([
      'src/intelligence/compatibility/compatibilityGate.ts',
      'src/intelligence/compatibility/compatibilityPolicy.ts',
      'src/intelligence/recommendations/catalogPairing.ts',
    ]);
  });
});

// B0′ pool: every anchor × pool pair, new gate vs the frozen gate. Inputs are gitignored, so
// this runs only where reports/ exists (same rule as b0PrimeCharacterization).
const b0Root = join(__dirname, '..');
const describeB0 = b0PrimeSourcesPresent(b0Root) ? describe : describe.skip;

describeB0('pairing equality with the S1 gate (B0′ pool)', () => {
  it('matches the frozen gate on every anchor-pool pair', () => {
    const dataset = loadB0PrimeDataset(b0Root);
    const intelligence = (entry: Product) => buildProductIntelligence(productIntelligenceInputFromContext(entry, {
      productId: entry.id, status: 'loaded', attributes: dataset.attributes.get(entry.id) ?? null, semanticColumns: 'loaded',
    }));
    const pool = dataset.poolIds.map(id => dataset.products.get(id)!);
    let compared = 0;
    for (const anchorId of dataset.anchorIds) {
      const anchor = dataset.products.get(anchorId)!;
      const context = buildStyleContext({ anchor, anchorIntelligence: intelligence(anchor), user: null, sessionIntent: null });
      for (const candidate of pool) {
        if (candidate.id === anchorId) continue;
        const input = { context, candidate, candidateIntelligence: intelligence(candidate) };
        expect(evaluateCompatibility(input)).toEqual(legacyEvaluateCompatibility(input));
        compared++;
      }
    }
    expect(compared).toBe(2386);
  }, 120_000);
});

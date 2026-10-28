import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isAttributeRow, isFeedProductRow, mapFeedRow } from '../../services/catalogProductAdapter';
import { evaluateCompatibility } from '../../src/intelligence/compatibility/compatibilityGate';
import { catalogCompatibility, type CatalogCompatibility } from '../../src/intelligence/outfits/catalogCompatibility';
import { hasHardConflict, type OutfitCandidateItem } from '../../src/intelligence/outfits/outfitCandidate';
import {
  buildProductIntelligence,
  productIntelligenceInputFromContext,
  type ProductSemanticAttributeRow,
} from '../../src/intelligence/product/productIntelligence';
import { complementaryProductsForDisplay } from '../../src/intelligence/recommendations/complementaryProductsForDisplay';
import {
  completeDiscoverRecommendationsAsync,
  prepareDiscoverRankingAsync,
} from '../../src/intelligence/recommendations/getDiscoverRecommendations';
import { isHumanIncompatible as isVerifiedHumanIncompatibility } from '../../src/intelligence/pairing/humanDecisions';
import { buildStyleContext } from '../../src/intelligence/style/styleContext';
import { enrichProduct } from '../../src/intelligence/style/productStyle';
import { anchorContext } from '../../src/recommendationCache/feedPacket';
import type { Product } from '../../types/product';

/**
 * B0′: the B0 protocol (30 anchors, 80-product pool, empty wardrobe, no taste, no exposure)
 * replayed on the current main. The 2026-10-27 catalog cleanup removed 133 of the 278 rows
 * from the B0 manifest; they are restored in memory from that cleanup's backup and never
 * written back. Every input lives under the gitignored reports/ directory.
 */
export const B0_PRIME_SCHEMA = 'vitrify-b0-prime-v1';

export const B0_PRIME_SOURCES = {
  manifest: 'reports/b0-baseline-2026-10-08.manifest.json',
  backup: 'reports/catalog-live-audit-2026-10-27/remaining-120-backup.json',
  /** The B0 report names this audit as its frozen input; its anchor and pool lists are intact. */
  audit: 'reports/semantic-usage-audit-2026-10-08/manifest.json',
  b0Report: 'reports/b0-baseline-2026-10-08.md',
} as const;

export const B0_PRIME_GOLDEN = 'reports/b0-prime-2026-10-28/golden.json';

export interface B0PrimeDataset {
  datasetSha256: string;
  products: ReadonlyMap<string, Product>;
  attributes: ReadonlyMap<string, ProductSemanticAttributeRow>;
  anchorIds: readonly string[];
  poolIds: readonly string[];
}

export interface B0PrimeAnchorResult {
  anchorId: string;
  engineInputCount: number;
  rankedCount: number;
  supportingCandidateId: string | null;
  finalIds: string[];
  /** complementaryProductsForDisplay over the same recommendation. */
  displayIds: string[];
  finalCompatibility: CatalogCompatibility[];
}

export interface B0PrimePair {
  anchorId: string;
  productId: string;
  compatibility: CatalogCompatibility;
  /** null when either product has no outfit role. */
  hardConflict: boolean | null;
  gateOutcome: string;
  gateReasons: string[];
  humanBlock: boolean;
}

export interface B0PrimeGolden {
  schema: typeof B0_PRIME_SCHEMA;
  datasetSha256: string;
  anchorIds: string[];
  poolIds: string[];
  anchors: B0PrimeAnchorResult[];
  pairs: B0PrimePair[];
}

const readJson = (root: string, path: string): unknown => JSON.parse(readFileSync(join(root, path), 'utf8'));

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const stringArray = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) throw new Error(`${label} is not a string list`);
  return value;
};

export const b0PrimeSourcesPresent = (root: string): boolean =>
  Object.values(B0_PRIME_SOURCES).every((path) => existsSync(join(root, path)));

const byKey = <T>(rows: readonly T[], key: (row: T) => string): T[] =>
  [...rows].sort((left, right) => (key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0));

export const loadB0PrimeDataset = (root: string): B0PrimeDataset => {
  const manifest = readJson(root, B0_PRIME_SOURCES.manifest);
  const backup = readJson(root, B0_PRIME_SOURCES.backup);
  const audit = readJson(root, B0_PRIME_SOURCES.audit);
  if (!isRecord(manifest) || !isRecord(manifest.dataset) || !isRecord(manifest.dataset.rawSnapshot)) {
    throw new Error('B0 manifest has no raw snapshot');
  }
  if (!isRecord(backup) || !Array.isArray(backup.localRows)) throw new Error('Cleanup backup has no local rows');
  if (!isRecord(audit)) throw new Error('Semantic usage audit manifest is unreadable');
  const raw = manifest.dataset.rawSnapshot;
  const removed = backup.localRows.find((entry) => isRecord(entry) && entry.file === B0_PRIME_SOURCES.manifest);
  if (!isRecord(removed) || !Array.isArray(removed.rows) || !Array.isArray(raw.products) || !Array.isArray(raw.attributes)) {
    throw new Error('Removed B0 rows are missing from the cleanup backup');
  }
  const productRows = [...raw.products, ...removed.rows.filter((row) => isRecord(row) && 'external_id' in row)];
  const attributeRows = [...raw.attributes, ...removed.rows.filter((row) => isRecord(row) && 'season' in row && 'product_id' in row)];
  if (!productRows.every(isFeedProductRow) || !attributeRows.every(isAttributeRow)) throw new Error('Invalid B0 rows');
  if (new Set(productRows.map((row) => row.id)).size !== 278 || new Set(attributeRows.map((row) => row.product_id)).size !== 278) {
    throw new Error('B0′ requires 278 unique products and attribute rows');
  }

  const attributes = new Map(attributeRows.map((row) => [row.product_id, row as ProductSemanticAttributeRow]));
  // Same hydration as productRepository: mapFeedRow, then enrichProduct with the attribute row.
  const products = new Map<string, Product>();
  for (const row of productRows) {
    const product = mapFeedRow(row);
    if (!product) throw new Error(`Unsupported B0 product: ${row.id}`);
    products.set(product.id, enrichProduct(product, attributes.get(product.id)));
  }
  const anchorIds = stringArray(audit.anchorIds, 'anchorIds');
  const poolIds = stringArray(audit.poolIds, 'poolIds');
  if (anchorIds.length !== 30 || poolIds.length !== 80 || ![...anchorIds, ...poolIds].every((id) => products.has(id))) {
    throw new Error('B0′ anchors or pool are not in the restored catalog');
  }
  // The original raw order was lost in the cleanup, so the hash covers rows sorted by id.
  const datasetSha256 = createHash('sha256').update(JSON.stringify({
    products: byKey(productRows, (row) => row.id),
    attributes: byKey(attributeRows, (row) => row.product_id),
  })).digest('hex');
  return { datasetSha256, products, attributes, anchorIds, poolIds };
};

const catalogItem = (product: Product): OutfitCandidateItem | null =>
  product.outfitRole ? { sourceType: 'catalog', sourceId: product.id, role: product.outfitRole, product } : null;

export const replayB0Prime = async (dataset: B0PrimeDataset): Promise<B0PrimeGolden> => {
  const pool = dataset.poolIds.map((id) => dataset.products.get(id)!);
  const intelligence = (product: Product) => buildProductIntelligence(productIntelligenceInputFromContext(product, {
    productId: product.id,
    status: 'loaded',
    attributes: dataset.attributes.get(product.id) ?? null,
    semanticColumns: 'loaded',
  }));

  const anchors: B0PrimeAnchorResult[] = [];
  const pairs: B0PrimePair[] = [];
  for (const anchorId of dataset.anchorIds) {
    const anchor = dataset.products.get(anchorId)!;
    const { input } = anchorContext(pool, anchor, [], new Map());
    const prepared = await prepareDiscoverRankingAsync(input);
    const recommendations = await completeDiscoverRecommendationsAsync(prepared, new Map());
    const final = recommendations[0]?.displayProducts ?? [];
    anchors.push({
      anchorId,
      engineInputCount: input.catalogProducts.length,
      rankedCount: prepared.ranked.length,
      supportingCandidateId: recommendations[0]?.candidate.id ?? null,
      finalIds: final.map((product) => product.id),
      displayIds: complementaryProductsForDisplay(recommendations, anchorId).map((product) => product.id),
      finalCompatibility: final.map((product) => catalogCompatibility(anchor, product)),
    });

    const context = buildStyleContext({ anchor, anchorIntelligence: intelligence(anchor), user: null, sessionIntent: null });
    const anchorItem = catalogItem(anchor);
    for (const product of pool) {
      if (product.id === anchorId) continue;
      const productItem = catalogItem(product);
      const gate = evaluateCompatibility({ context, candidate: product, candidateIntelligence: intelligence(product) });
      pairs.push({
        anchorId,
        productId: product.id,
        compatibility: catalogCompatibility(anchor, product),
        hardConflict: anchorItem && productItem ? hasHardConflict([anchorItem, productItem]) : null,
        gateOutcome: gate.outcome,
        gateReasons: [...gate.reasons],
        humanBlock: isVerifiedHumanIncompatibility(anchorId, product.id),
      });
    }
  }
  return {
    schema: B0_PRIME_SCHEMA,
    datasetSha256: dataset.datasetSha256,
    anchorIds: [...dataset.anchorIds],
    poolIds: [...dataset.poolIds],
    anchors,
    pairs,
  };
};

/** Ordered final IDs from the B0 report table (the manifest rows were scrubbed by the cleanup). */
export const readB0ReportFinals = (root: string): Map<string, string[]> => {
  const finals = new Map<string, string[]>();
  for (const line of readFileSync(join(root, B0_PRIME_SOURCES.b0Report), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\| \d+ \| ([^ ]+) \/ [^|]+\| ([^|]+) \| \d+ \|/);
    if (!match) continue;
    const ids = match[2].trim() === '∅' ? [] : match[2].split('<br>').map((id) => id.trim());
    finals.set(match[1], ids);
  }
  return finals;
};

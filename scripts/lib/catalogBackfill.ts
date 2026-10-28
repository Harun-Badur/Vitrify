import { computeCatalogEnrichment, type EligibilityField, type EnrichmentProductInput } from '../../lib/catalogEnrichment';

/** Pure planning for scripts/backfillCatalogEnrichment.ts and its rollback. No I/O here. */

export const BACKUP_FORMAT = 'catalog-enrichment-backup-v1';

export interface ProductEnrichmentColumns {
  gender: string | null;
  feed_eligible: boolean;
  eligibility_missing: string[] | null;
  attribute_source: string | null;
  attribute_version: number | null;
}

export type BackfillProductRow = EnrichmentProductInput & ProductEnrichmentColumns;

export interface AttributeColumns {
  colors: string[] | null;
  fit: string | null;
  subcategory: string | null;
}

export interface BackfillAttributeRow extends AttributeColumns {
  product_id: string;
}

export interface PlannedProductChange {
  id: string;
  before: ProductEnrichmentColumns;
  after: ProductEnrichmentColumns;
}

export interface PlannedAttributeWrite {
  product_id: string;
  mode: 'update' | 'insert';
  before: AttributeColumns | null;
  patch: Partial<AttributeColumns>;
}

export interface BackfillPlan {
  products: PlannedProductChange[];
  attributes: PlannedAttributeWrite[];
  summary: {
    total: number;
    eligible: number;
    ineligible: number;
    missing: Partial<Record<EligibilityField, number>>;
    gender: Record<string, number>;
    productChanges: number;
    attributeUpdates: number;
    attributeInserts: number;
  };
}

export interface BackfillArgs { apply: boolean; verbose: boolean }

export const parseBackfillArgs = (argv: readonly string[]): BackfillArgs => {
  const args = { apply: false, verbose: false };
  for (const arg of argv) {
    if (arg === '--apply') args.apply = true;
    else if (arg === '--verbose') args.verbose = true;
    else throw new Error(`Bilinmeyen argüman: ${arg}`);
  }
  return args;
};

const sameArray = (left: readonly unknown[] | null, right: readonly unknown[] | null) =>
  JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

const sameColumns = (left: ProductEnrichmentColumns, right: ProductEnrichmentColumns) =>
  left.gender === right.gender && left.feed_eligible === right.feed_eligible
  && sameArray(left.eligibility_missing, right.eligibility_missing)
  && left.attribute_source === right.attribute_source && left.attribute_version === right.attribute_version;

const textArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

export const planCatalogBackfill = (
  products: readonly BackfillProductRow[],
  attributes: readonly BackfillAttributeRow[],
): BackfillPlan => {
  const storedById = new Map(attributes.map(row => [row.product_id, row]));
  const plan: BackfillPlan = { products: [], attributes: [], summary: {
    total: products.length, eligible: 0, ineligible: 0, missing: {}, gender: {},
    productChanges: 0, attributeUpdates: 0, attributeInserts: 0 } };

  for (const product of products) {
    const stored = storedById.get(product.id);
    const result = computeCatalogEnrichment(product, stored);
    const before: ProductEnrichmentColumns = {
      gender: product.gender, feed_eligible: product.feed_eligible === true,
      eligibility_missing: product.eligibility_missing, attribute_source: product.attribute_source,
      attribute_version: product.attribute_version,
    };
    const after: ProductEnrichmentColumns = {
      gender: result.gender, feed_eligible: result.feedEligible, eligibility_missing: result.eligibilityMissing,
      attribute_source: result.attributeSource, attribute_version: result.attributeVersion,
    };
    if (!sameColumns(before, after)) plan.products.push({ id: product.id, before, after });

    // Only title evidence is written; a stored value is never replaced by "unknown".
    const patch: Partial<AttributeColumns> = {};
    if (result.inferred.colors.length > 0 && !sameArray(textArray(stored?.colors), result.inferred.colors)) {
      patch.colors = result.inferred.colors;
    }
    if (result.inferred.subcategory && stored?.subcategory !== result.inferred.subcategory) {
      patch.subcategory = result.inferred.subcategory;
    }
    if (result.inferred.fit && stored?.fit !== result.inferred.fit) patch.fit = result.inferred.fit;
    if (Object.keys(patch).length > 0) {
      plan.attributes.push({ product_id: product.id, mode: stored ? 'update' : 'insert',
        before: stored ? { colors: stored.colors, fit: stored.fit, subcategory: stored.subcategory } : null, patch });
    }

    const { summary } = plan;
    if (result.feedEligible) summary.eligible++;
    else summary.ineligible++;
    for (const field of result.eligibilityMissing) summary.missing[field] = (summary.missing[field] ?? 0) + 1;
    const genderKey = result.gender ?? 'NULL';
    summary.gender[genderKey] = (summary.gender[genderKey] ?? 0) + 1;
  }
  plan.summary.productChanges = plan.products.length;
  plan.summary.attributeUpdates = plan.attributes.filter(write => write.mode === 'update').length;
  plan.summary.attributeInserts = plan.attributes.filter(write => write.mode === 'insert').length;
  return plan;
};

const show = (value: unknown): string =>
  value === null || value === undefined ? '∅' : Array.isArray(value) ? `[${value.join('|')}]` : String(value);

const SAMPLE_LINES = 25;

/** Summary and planned changes. Never includes credentials or environment values. */
export const formatBackfillPlan = (plan: BackfillPlan, args: BackfillArgs): string[] => {
  const { summary } = plan;
  const counts = (map: Record<string, number | undefined>) =>
    Object.entries(map).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([key, value]) => `${key} ${value}`).join(', ') || 'yok';
  const lines = [
    args.apply ? 'APPLY: aşağıdaki değişiklikler yazılacak.' : 'DRY-RUN: veritabanına hiçbir şey yazılmadı.',
    `Ürün: ${summary.total}; feed_eligible=true: ${summary.eligible}; elenen: ${summary.ineligible}.`,
    `Eksik alan: ${counts(summary.missing)}. Gender: ${counts(summary.gender)}.`,
    `products güncellemesi: ${summary.productChanges}; product_attributes güncelleme: ${summary.attributeUpdates}, yeni satır: ${summary.attributeInserts}.`,
  ];
  const changes = [
    ...plan.products.map(change => `${change.id}: gender ${show(change.before.gender)}→${show(change.after.gender)}; `
      + `feed_eligible ${change.before.feed_eligible}→${change.after.feed_eligible}; eksik ${show(change.after.eligibility_missing?.length ? change.after.eligibility_missing : null)}`),
    ...plan.attributes.map(write => `${write.product_id} attributes (${write.mode}): ${Object.entries(write.patch)
      .map(([key, value]) => `${key} ${show(write.before?.[key as keyof AttributeColumns])}→${show(value)}`).join('; ')}`),
  ];
  lines.push(...(args.verbose ? changes : changes.slice(0, SAMPLE_LINES)));
  if (!args.verbose && changes.length > SAMPLE_LINES) lines.push(`… ${changes.length - SAMPLE_LINES} satır daha (tamamı için --verbose).`);
  if (!args.apply) lines.push('Gerçek yazma için --apply ile çalıştırın (önce yedek alınır).');
  return lines;
};

export interface BackfillBackup {
  format: typeof BACKUP_FORMAT;
  createdAt: string;
  products: Array<{ id: string } & ProductEnrichmentColumns>;
  attributes: Array<{ product_id: string; existed: boolean } & AttributeColumns>;
}

/** Previous values of every row the plan touches. */
export const buildBackfillBackup = (plan: BackfillPlan, createdAt: string): BackfillBackup => ({
  format: BACKUP_FORMAT,
  createdAt,
  products: plan.products.map(change => ({ id: change.id, ...change.before })),
  attributes: plan.attributes.map(write => ({ product_id: write.product_id, existed: write.before !== null,
    colors: write.before?.colors ?? null, fit: write.before?.fit ?? null, subcategory: write.before?.subcategory ?? null })),
});

export interface RollbackPlan {
  products: Array<{ id: string; values: ProductEnrichmentColumns }>;
  attributes: Array<{ product_id: string; mode: 'restore'; values: AttributeColumns } | { product_id: string; mode: 'delete' }>;
}

export const planCatalogRollback = (backup: BackfillBackup): RollbackPlan => {
  if (backup?.format !== BACKUP_FORMAT || !Array.isArray(backup.products) || !Array.isArray(backup.attributes)) {
    throw new Error('Yedek biçimi tanınmadı');
  }
  return {
    products: backup.products.map(({ id, ...values }) => ({ id, values })),
    // A row the backfill inserted did not exist before; restoring means removing it.
    attributes: backup.attributes.map(({ product_id, existed, ...values }) => existed
      ? { product_id, mode: 'restore' as const, values }
      : { product_id, mode: 'delete' as const }),
  };
};

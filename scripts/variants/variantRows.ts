import type { VariantRecord } from './types';

/** attribute_source='manual_review' rows (accessory_gender_review_apply.sql); never touched here. */
export const MANUAL_REVIEW_PRODUCT_IDS: readonly string[] = [
  'flo-201729383',
  'flo-201729387',
  'flo-201729388',
  'flo-201845552',
  'flo-201846669',
  'hepsiburada-HBCV0000CYITMK',
  'trendyol-1086036215',
  'trendyol-353730430',
  'trendyol-662226049',
  'trendyol-943974640',
  'trendyol-952669343',
  'trendyol-990425210',
];

export interface VariantUpdateValues {
  color_variants: Array<{ name: string | null; url: string; imageUrl?: string }> | null;
  size_options: Array<{ label: string; inStock?: boolean }> | null;
  variants_fetched_at: string;
}

export interface VariantUpdate {
  id: string;
  values: VariantUpdateValues;
}

export interface VariantPlan {
  updates: VariantUpdate[];
  skippedManualReview: number;
  skippedErrors: number;
  colorCount: number;
  sizeCount: number;
}

export const buildVariantUpdate = (record: VariantRecord): VariantUpdateValues => ({
  color_variants:
    record.colors.length > 0
      ? record.colors.map((c) => ({
          name: c.name === '' ? null : c.name,
          url: c.url,
          ...(c.imageUrl ? { imageUrl: c.imageUrl } : {}),
        }))
      : null,
  size_options:
    record.sizes.length > 0
      ? record.sizes.map((s) => ({
          label: s.label,
          ...(typeof s.inStock === 'boolean' ? { inStock: s.inStock } : {}),
        }))
      : null,
  variants_fetched_at: record.fetched_at,
});

export const planVariantUpdates = (records: readonly VariantRecord[]): VariantPlan => {
  const manual = new Set(MANUAL_REVIEW_PRODUCT_IDS);
  const plan: VariantPlan = {
    updates: [],
    skippedManualReview: 0,
    skippedErrors: 0,
    colorCount: 0,
    sizeCount: 0,
  };
  for (const record of records) {
    if (manual.has(record.product_id)) {
      plan.skippedManualReview += 1;
      continue;
    }
    // A failed fetch says nothing about the product; do not stamp it as fetched.
    if (record.error) {
      plan.skippedErrors += 1;
      continue;
    }
    const values = buildVariantUpdate(record);
    plan.colorCount += values.color_variants?.length ?? 0;
    plan.sizeCount += values.size_options?.length ?? 0;
    plan.updates.push({ id: record.product_id, values });
  }
  return plan;
};

import type { FitSlug, PriceBand } from '../lib/productAttributes';
import type { GarmentCategory, OutfitRole, ProductGender } from './product';

export const PRODUCT_INTELLIGENCE_VERSION = 1;

/**
 * Where a value came from. `catalog_attribute` rows were partly seeded from title
 * heuristics and carry no per-row provenance, so their confidence stays `unknown`.
 */
export const PRODUCT_SIGNAL_SOURCES = [
  'catalog_repair',
  'curated_title_override',
  'catalog_attribute',
  'catalog_variant',
  'product_snapshot',
  'category_rule',
  'price_rule',
  'title_inferred',
  'unknown',
] as const;

export type ProductSignalSource = (typeof PRODUCT_SIGNAL_SOURCES)[number];

export const PRODUCT_SIGNAL_CONFIDENCES = ['high', 'medium', 'low', 'unknown'] as const;

export type ProductSignalConfidence = (typeof PRODUCT_SIGNAL_CONFIDENCES)[number];

/** Declared values come from catalog data; derived values come from rules over other fields. */
export type ProductSignalOrigin = 'declared' | 'derived' | 'unknown';

/** `value: null` is missing evidence, never a default such as unisex/regular/tisort. */
export interface ProductSignal<T> {
  value: T | null;
  origin: ProductSignalOrigin;
  source: ProductSignalSource;
  confidence: ProductSignalConfidence;
}

export type ProductSemanticField =
  | 'role'
  | 'subtype'
  | 'gender'
  | 'colors'
  | 'fit'
  | 'priceBand';

export const PRODUCT_CONFLICT_CODES = [
  'role_category_mismatch',
  'role_subtype_mismatch',
  'subtype_category_mismatch',
  'declared_inferred_mismatch',
  'declared_value_rejected',
  'suit_blazer_ambiguity',
] as const;

export type ProductConflictCode = (typeof PRODUCT_CONFLICT_CODES)[number];

/** Conflicts are reported alongside the kept value; they are never auto-resolved. */
export interface ProductSemanticConflict {
  field: ProductSemanticField;
  code: ProductConflictCode;
  values: readonly string[];
}

export interface ProductIntelligence {
  version: typeof PRODUCT_INTELLIGENCE_VERSION;
  productId: string;
  category: GarmentCategory;
  role: ProductSignal<OutfitRole>;
  subtype: ProductSignal<string>;
  gender: ProductSignal<ProductGender>;
  /** Empty list means unknown color evidence. */
  colors: readonly ProductSignal<string>[];
  fit: ProductSignal<FitSlug>;
  material: ProductSignal<string>;
  season: ProductSignal<string>;
  occasion: ProductSignal<string>;
  /** Empty list means unknown; style tags are never inferred from titles. */
  styleTags: readonly ProductSignal<string>[];
  priceBand: ProductSignal<PriceBand>;
  conflicts: readonly ProductSemanticConflict[];
}

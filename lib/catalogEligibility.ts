import { isFeedProductRow, mapFeedRow } from '../services/catalogProductAdapter';
import { catalogStyleSignal } from '../src/intelligence/outfits/catalogCompatibility';
import { resolveCatalogAppearance, type ProductAttributeRow } from '../src/intelligence/style/productStyle';
import { isFeedProvider, isGarmentCategory, type Product } from '../types/product';

/**
 * Active-catalog gate. Usable color is the stored attribute color or the
 * existing title/name inference inside resolveCatalogAppearance. style_tags are not a
 * gate: outfit scoring reads catalogStyleSignal(subcategory), and an unmapped
 * subtype stays eligible because that scorer treats it as no style points.
 * Eligibility is derived from the record, so a later import cannot reactivate
 * a row while a required field is still missing.
 */
export const CATALOG_ELIGIBILITY_FIELDS = [
  'id',
  'title',
  'image',
  'category',
  'provider',
  'productUrl',
  'externalId',
  'color',
] as const;

export type CatalogEligibilityField = (typeof CATALOG_ELIGIBILITY_FIELDS)[number];

export type CatalogEligibilityStatus = 'eligible' | 'incomplete';

export interface CatalogEligibilityRecord {
  id?: unknown;
  title?: unknown;
  imageUrl?: unknown;
  image_url?: unknown;
  images?: unknown;
  category?: unknown;
  provider?: unknown;
  productUrl?: unknown;
  product_url?: unknown;
  externalId?: unknown;
  external_id?: unknown;
  brand?: unknown;
  price?: unknown;
  garmentDescription?: unknown;
  /** Present only after enrichProduct. Empty means resolved and unusable. */
  colorSlugs?: unknown;
  subcategory?: unknown;
  colors?: unknown;
  currency?: unknown;
  affiliate_url?: unknown;
  affiliateUrl?: unknown;
}

export interface CatalogAttributeEvidence {
  product_id?: unknown;
  colors?: unknown;
  gender?: unknown;
  fit?: unknown;
  subcategory?: unknown;
  brand_slug?: unknown;
  price_band?: unknown;
  outfit_role?: unknown;
  style_tags?: unknown;
}

export interface CatalogEligibility {
  status: CatalogEligibilityStatus;
  missing: readonly CatalogEligibilityField[];
  /** Null when the outfit map has no class. That is not an eligibility failure. */
  styleSignal: string | null;
}

const trimmed = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const firstText = (...values: unknown[]): string => {
  for (const value of values) {
    const text = trimmed(value);
    if (text.length > 0) return text;
  }
  return '';
};

const httpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && url.username.length === 0
      && url.password.length === 0;
  } catch {
    return false;
  }
};

const imageReference = (record: CatalogEligibilityRecord): string => {
  if (Array.isArray(record.images)) {
    for (const item of record.images) {
      const text = trimmed(item);
      if (text.length > 0) return text;
    }
  }
  return firstText(record.imageUrl, record.image_url);
};

const textOrNull = (value: unknown): string | null => {
  const text = trimmed(value);
  return text.length > 0 ? text : null;
};

const mapFeedRowAlias = (record: CatalogEligibilityRecord): Product | null => {
  const affiliate = record.affiliate_url !== undefined ? record.affiliate_url : record.affiliateUrl ?? null;
  const row = {
    ...record,
    external_id: firstText(record.external_id, record.externalId),
    product_url: firstText(record.product_url, record.productUrl),
    image_url: firstText(record.image_url, record.imageUrl),
    affiliate_url: affiliate,
  };
  return isFeedProductRow(row) ? mapFeedRow(row) : null;
};

const isCatalogProduct = (record: CatalogEligibilityRecord): record is Product =>
  typeof record.id === 'string'
  && typeof record.title === 'string'
  && typeof record.imageUrl === 'string'
  && typeof record.brand === 'string'
  && typeof record.price === 'number'
  && Number.isFinite(record.price)
  && isGarmentCategory(record.category)
  && typeof record.garmentDescription === 'string';

const attributeRow = (
  record: CatalogEligibilityRecord,
  attributes: CatalogAttributeEvidence,
): ProductAttributeRow => ({
  product_id: textOrNull(attributes.product_id) ?? (trimmed(record.id) || 'catalog-row'),
  gender: textOrNull(attributes.gender),
  colors: attributes.colors,
  fit: textOrNull(attributes.fit),
  subcategory: textOrNull(attributes.subcategory),
  brand_slug: textOrNull(attributes.brand_slug),
  price_band: textOrNull(attributes.price_band),
  outfit_role: textOrNull(attributes.outfit_role),
});

const preparedAppearance = (
  record: CatalogEligibilityRecord,
  attributes: CatalogAttributeEvidence | null | undefined,
): { colors: readonly string[]; subcategory: string } => {
  if (attributes === undefined && Array.isArray(record.colorSlugs)) {
    return {
      colors: record.colorSlugs.filter((color): color is string =>
        typeof color === 'string' && color.trim().length > 0),
      subcategory: trimmed(record.subcategory),
    };
  }
  const product = isCatalogProduct(record)
    ? record
    : mapFeedRowAlias(record);
  if (!product) return { colors: [], subcategory: trimmed(record.subcategory) };
  const appearance = resolveCatalogAppearance(
    product,
    attributes == null ? undefined : attributeRow(record, attributes),
  );
  return {
    colors: appearance.colors.filter((color) => color.trim().length > 0),
    subcategory: appearance.subcategory,
  };
};

export const evaluateCatalogEligibility = (
  record: CatalogEligibilityRecord,
  attributes?: CatalogAttributeEvidence | null,
): CatalogEligibility => {
  const missing: CatalogEligibilityField[] = [];
  if (trimmed(record.id).length === 0) missing.push('id');
  if (trimmed(record.title).length === 0) missing.push('title');
  if (!httpUrl(imageReference(record))) missing.push('image');
  if (!isGarmentCategory(record.category)) missing.push('category');
  if (!isFeedProvider(record.provider)) missing.push('provider');
  if (!httpUrl(firstText(record.productUrl, record.product_url))) missing.push('productUrl');
  if (firstText(record.externalId, record.external_id).length === 0) missing.push('externalId');
  const appearance = preparedAppearance(record, attributes);
  if (appearance.colors.length === 0) missing.push('color');
  return {
    status: missing.length === 0 ? 'eligible' : 'incomplete',
    missing,
    styleSignal: catalogStyleSignal(appearance.subcategory),
  };
};

export const isActiveCatalogRecord = (
  record: CatalogEligibilityRecord,
  attributes?: CatalogAttributeEvidence | null,
): boolean => evaluateCatalogEligibility(record, attributes).status === 'eligible';

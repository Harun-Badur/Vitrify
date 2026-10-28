import { cleanDeclaredCatalogColors, declaredCatalogFit } from './catalogMetadata';
import {
  inferColorsFromText,
  inferFitFromTitle,
  inferGenderDetail,
  inferSubcategory,
  type GenderLabel,
} from './productAttributes';

/** Written to products.attribute_source / attribute_version by the backfill. */
export const ENRICHMENT_ATTRIBUTE_SOURCE = 'title_rules';
/** Bump when an inference rule changes, so a rerun rewrites every row. */
export const ENRICHMENT_ATTRIBUTE_VERSION = 1;

export const FEED_CATEGORIES = ['upper_body', 'lower_body', 'dresses', 'shoes', 'bags', 'accessories', 'hats'] as const;
export const FEED_GENDERS = ['kadin', 'erkek', 'unisex'] as const;

export type StoredGender = Exclude<GenderLabel, 'bilinmiyor'>;
export type EligibilityField = 'kategori' | 'gender' | 'alt_tur' | 'renk' | 'fiyat' | 'gorsel';

export interface FeedEligibilityInput {
  category: string;
  gender: string | null;
  subcategory: string | null;
  colors: readonly string[];
  price: number;
  imageUrl: string | null | undefined;
}

/** Feed rule: category, gender kadin/erkek/unisex, subtype, color, price and image must ALL be known; fit is optional. */
export const feedEligibilityMissing = (input: FeedEligibilityInput): EligibilityField[] => [
  !(FEED_CATEGORIES as readonly string[]).includes(input.category) && 'kategori',
  !(FEED_GENDERS as readonly string[]).includes(input.gender ?? '') && 'gender',
  !input.subcategory && 'alt_tur',
  input.colors.length === 0 && 'renk',
  !(input.price > 0) && 'fiyat',
  !input.imageUrl?.trim() && 'gorsel',
].filter((field): field is EligibilityField => field !== false);

export interface EnrichmentProductInput {
  id: string;
  title: string;
  brand: string | null;
  category: string;
  product_url: string | null;
  price: number | string | null;
  current_price: number | string | null;
  image_url: string | null;
}

export interface EnrichmentStoredAttributes {
  colors: unknown;
  fit: string | null;
  subcategory: string | null;
}

export interface CatalogEnrichment {
  gender: StoredGender | null;
  /** Inferred value, else the stored one; this is what eligibility is judged on. */
  colors: string[];
  subcategory: string | null;
  fit: string | null;
  /** Title-rule output alone; empty means no evidence. */
  inferred: { colors: string[]; subcategory: string; fit: string };
  feedEligible: boolean;
  eligibilityMissing: EligibilityField[];
  attributeSource: typeof ENRICHMENT_ATTRIBUTE_SOURCE;
  attributeVersion: typeof ENRICHMENT_ATTRIBUTE_VERSION;
}

/**
 * The single enrichment code path: the same title rules as the preview, then the
 * feed rule over the values that will be stored. A stored value is kept when the
 * title gives no evidence; an unknown gender is stored as NULL, never guessed.
 */
export const computeCatalogEnrichment = (
  product: EnrichmentProductInput,
  stored: EnrichmentStoredAttributes | undefined,
): CatalogEnrichment => {
  const inferred = {
    colors: inferColorsFromText(product.title, product.brand),
    subcategory: inferSubcategory(product.title, product.category) ?? '',
    fit: inferFitFromTitle(product.title),
  };
  const detail = inferGenderDetail(product.title, product.product_url, product.category);
  const gender = detail.gender === 'bilinmiyor' ? null : detail.gender;
  const colors = inferred.colors.length > 0 ? inferred.colors : cleanDeclaredCatalogColors(product.id, stored?.colors);
  const subcategory = inferred.subcategory || stored?.subcategory?.trim() || null;
  const fit = inferred.fit || declaredCatalogFit(stored?.fit) || null;
  const missing = feedEligibilityMissing({
    category: product.category, gender, subcategory, colors,
    price: Number(product.current_price ?? product.price), imageUrl: product.image_url,
  });
  return {
    gender, colors, subcategory, fit, inferred,
    feedEligible: missing.length === 0,
    eligibilityMissing: missing,
    attributeSource: ENRICHMENT_ATTRIBUTE_SOURCE,
    attributeVersion: ENRICHMENT_ATTRIBUTE_VERSION,
  };
};

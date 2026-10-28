import { cleanDeclaredCatalogColors, declaredCatalogFit } from './catalogMetadata';
import {
  inferColorsFromText,
  inferFitFromTitle,
  inferGenderDetail,
  inferSubcategory,
  matchSubcategoryFromTitle,
  type GenderLabel,
} from './productAttributes';

/** Written to products.attribute_source / attribute_version by the backfill. */
export const ENRICHMENT_ATTRIBUTE_SOURCE = 'title_rules';
/** Bump when an inference rule changes, so a rerun rewrites every row. */
export const ENRICHMENT_ATTRIBUTE_VERSION = 4;
/** A person decided these attributes; the title backfill never rewrites such a row. */
export const MANUAL_REVIEW_ATTRIBUTE_SOURCE = 'manual_review';
export const MANUAL_REVIEW_ATTRIBUTE_VERSION = 1;

export const FEED_CATEGORIES = ['upper_body', 'lower_body', 'dresses', 'shoes', 'bags', 'accessories', 'hats'] as const;
export const FEED_GENDERS = ['kadin', 'erkek', 'unisex'] as const;

export type StoredGender = Exclude<GenderLabel, 'bilinmiyor'>;
export type EligibilityField = 'kategori' | 'gender' | 'alt_tur' | 'renk' | 'fiyat' | 'gorsel';
export type ReviewField = 'gender' | 'alt_tur' | 'renk' | 'kalip';

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

const isEmpty = (value: unknown): boolean =>
  value === null || value === undefined || value === '' || value === 'bilinmiyor'
  || (Array.isArray(value) && value.length === 0);

const asKey = (value: unknown): string =>
  Array.isArray(value) ? [...value].sort().join('|') : String(value);
const asText = (value: unknown): string => Array.isArray(value) ? value.join('|') : String(value);

export interface MergeResult<T> {
  value: T | null;
  /** Set only when a known stored value was replaced by a different inference. */
  review: { from: string; to: string } | null;
}

/**
 * The one merge rule. An unknown/empty inference never changes a stored value; a filled
 * inference fills an empty value; a filled inference that differs from a stored value wins
 * and is marked for review. A known value is never turned into unknown.
 */
export const mergeAttribute = <T extends string | readonly string[]>(
  existing: T | null | undefined,
  inferred: T | null | undefined,
): MergeResult<T> => {
  if (isEmpty(inferred)) return { value: isEmpty(existing) ? null : existing as T, review: null };
  if (isEmpty(existing)) return { value: inferred as T, review: null };
  if (asKey(existing) === asKey(inferred)) return { value: existing as T, review: null };
  return { value: inferred as T, review: { from: asText(existing), to: asText(inferred) } };
};

/** `ceket` is the uncertain outerwear subtype; these refine it (rule v4) and are never a contradiction of it. */
const CEKET_REFINEMENTS: readonly string[] = ['mont', 'kaban', 'trenckot', 'blazer'];

/**
 * Subtype merge: mergeAttribute, except that refining `ceket` into a specific outerwear slug is
 * not a review item, and a refined slug is never replaced by the less specific `ceket`.
 */
export const mergeSubcategory = (
  existing: string | null | undefined,
  inferred: string | null | undefined,
): MergeResult<string> => {
  if (existing === 'ceket' && inferred && CEKET_REFINEMENTS.includes(inferred)) return { value: inferred, review: null };
  if (inferred === 'ceket' && existing && CEKET_REFINEMENTS.includes(existing)) return { value: existing, review: null };
  return mergeAttribute<string>(existing, inferred);
};

export interface EnrichmentProductInput {
  id: string;
  title: string;
  brand: string | null;
  category: string;
  product_url: string | null;
  price: number | string | null;
  current_price: number | string | null;
  image_url: string | null;
  /** products.gender when already written (kadin/erkek/unisex/cocuk). */
  gender?: string | null;
}

export interface EnrichmentStoredAttributes {
  colors: unknown;
  fit: string | null;
  subcategory: string | null;
  /** Legacy product_attributes.gender (women/men/unisex): the starting value for products.gender. */
  gender?: string | null;
}

export interface ReviewChange { field: ReviewField; from: string; to: string }

export interface CatalogEnrichment {
  gender: StoredGender | null;
  colors: string[];
  subcategory: string | null;
  fit: string | null;
  /** Which merged values came from the title and differ from what was stored. */
  changed: { colors: boolean; subcategory: boolean; fit: boolean };
  /** Known stored values the title contradicts; the title value wins and is listed here. */
  review: ReviewChange[];
  feedEligible: boolean;
  eligibilityMissing: EligibilityField[];
  attributeSource: typeof ENRICHMENT_ATTRIBUTE_SOURCE;
  attributeVersion: typeof ENRICHMENT_ATTRIBUTE_VERSION;
}

const LEGACY_GENDER: Readonly<Record<string, StoredGender>> = { women: 'kadin', men: 'erkek', unisex: 'unisex' };
const STORED_GENDERS: readonly string[] = ['kadin', 'erkek', 'unisex', 'cocuk'];

/** products.gender first, else the legacy product_attributes.gender mapped to the new vocabulary. */
export const existingGender = (productGender: string | null | undefined, legacy: string | null | undefined): StoredGender | null => {
  if (productGender && STORED_GENDERS.includes(productGender)) return productGender as StoredGender;
  return LEGACY_GENDER[legacy ?? ''] ?? null;
};

const isMaviBrand = (brand: string | null): boolean =>
  (brand ?? '').toLocaleLowerCase('tr-TR').match(/[\p{L}\p{N}]+/gu)?.includes('mavi') ?? false;

/**
 * The single enrichment code path (preview, dry-run, --apply and tests). Title rules
 * give an inference per attribute; mergeAttribute combines it with the stored value, and
 * feed eligibility is judged on the merged values.
 */
export const computeCatalogEnrichment = (
  product: EnrichmentProductInput,
  stored: EnrichmentStoredAttributes | undefined,
): CatalogEnrichment => {
  const review: ReviewChange[] = [];
  const note = (field: ReviewField, result: MergeResult<unknown>) => { if (result.review) review.push({ field, ...result.review }); };

  // Only an explicit title token (high confidence) may replace a stored gender. Medium rules
  // (URL, womenswear/dress defaults) fill an empty gender only.
  const storedGender = existingGender(product.gender, stored?.gender);
  const genderEvidence = inferGenderDetail(product.title, product.product_url, product.category);
  const gender = mergeAttribute<string>(storedGender,
    genderEvidence.confidence === 'high' || storedGender === null ? genderEvidence.gender : null);
  note('gender', gender);

  const storedColors = cleanDeclaredCatalogColors(product.id, stored?.colors);
  let inferredColors = inferColorsFromText(product.title, product.brand);
  // The title cannot confirm or deny blue on a Mavi product (the word is the brand), so a stored one stands.
  if (isMaviBrand(product.brand) && storedColors.includes('mavi') && !inferredColors.includes('mavi')) {
    inferredColors = inferredColors.length > 0 ? [...inferredColors, 'mavi'] : [];
  }
  const colors = mergeAttribute<readonly string[]>(storedColors, inferredColors);
  note('renk', colors);

  // A category default is not title evidence: it may fill an empty subtype but never replace one.
  const storedSubcategory = stored?.subcategory?.trim() || null;
  const keyword = matchSubcategoryFromTitle(product.title, product.category);
  const subcategory = keyword
    ? mergeSubcategory(storedSubcategory, keyword)
    : mergeSubcategory(storedSubcategory, storedSubcategory ? null : inferSubcategory(product.title, product.category));
  note('alt_tur', subcategory);

  const storedFit = declaredCatalogFit(stored?.fit) || null;
  const fit = mergeAttribute<string>(storedFit, inferFitFromTitle(product.title));
  note('kalip', fit);

  const mergedColors = [...(colors.value ?? [])];
  const missing = feedEligibilityMissing({
    category: product.category, gender: gender.value, subcategory: subcategory.value, colors: mergedColors,
    price: Number(product.current_price ?? product.price), imageUrl: product.image_url,
  });
  return {
    gender: gender.value as StoredGender | null,
    colors: mergedColors,
    subcategory: subcategory.value,
    fit: fit.value,
    changed: {
      colors: asKey(mergedColors) !== asKey(storedColors),
      subcategory: subcategory.value !== storedSubcategory,
      fit: fit.value !== storedFit,
    },
    review,
    feedEligible: missing.length === 0,
    eligibilityMissing: missing,
    attributeSource: ENRICHMENT_ATTRIBUTE_SOURCE,
    attributeVersion: ENRICHMENT_ATTRIBUTE_VERSION,
  };
};

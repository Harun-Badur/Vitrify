import { COLOR_ALIASES, FIT_VOCAB, slugify, type FitSlug } from '../../lib/productAttributes';
import { canonicalizeCatalogUrl } from './seedExpansionRules';
import { extractCatalogExternalId } from './retailProviders';
import {
  isFeedProvider,
  isGarmentCategory,
  isOutfitRole,
  type FeedProvider,
  type GarmentCategory,
  type OutfitRole,
  type ProductGender,
} from '../../types/product';

const PRICE_BAND_LOW_MAX = 499.99;
const PRICE_BAND_MID_MAX = 1499.99;
const PRICE_BAND_HIGH_MAX = 2999.99;

const COLOR_SLUGS = new Set(COLOR_ALIASES.map((alias) => alias.slug));
const FIT_SLUGS = new Set<string>(FIT_VOCAB);

const CATEGORY_FOR_ROLE: Record<OutfitRole, GarmentCategory> = {
  top: 'upper_body',
  bottom: 'lower_body',
  outerwear: 'upper_body',
  one_piece: 'dresses',
  shoes: 'shoes',
  bag: 'bags',
  hat: 'hats',
  accessory: 'accessories',
};

export interface ImportCandidateRecord {
  id: string;
  externalId: string;
  source: string;
  title: string;
  brand: string | null;
  productUrl: string;
  imageUrl: string;
  price: number | null;
  currency: string | null;
  observedOn: string;
  category: string | null;
  role: string | null;
  roleStatus: string;
  pieceKind: string;
  gender: string | null;
  genderStatus: string;
  color: string | null;
  colorStatus: string;
  fit: string | null;
  fitStatus: string;
  canonicalSubtype: string | null;
  child: boolean;
}

export interface CatalogImportProductRow {
  id: string;
  provider: FeedProvider;
  external_id: string;
  title: string;
  brand: string | null;
  price: number;
  currency: 'TRY';
  image_url: string;
  images: string[];
  product_url: string;
  category: GarmentCategory;
  affiliate_url: null;
  garment_description: null;
}

export interface CatalogImportAttributeRow {
  product_id: string;
  gender: ProductGender | null;
  colors: string[];
  fit: FitSlug | null;
  subcategory: null;
  brand_slug: string | null;
  price_band: 'low' | 'mid' | 'high' | 'luxury';
  material: null;
  season: null;
  occasion: null;
  style_tags: null;
  outfit_role: OutfitRole;
}

export interface CatalogImportPayload {
  product: CatalogImportProductRow;
  attributes: CatalogImportAttributeRow;
}

export type ImportCandidateDecision =
  | { status: 'ready'; payload: CatalogImportPayload }
  | { status: 'rejected'; id: string; productUrl: string; reason: string };

export interface ImportBatchResult {
  ready: CatalogImportPayload[];
  rejected: Array<{ id: string; productUrl: string; reason: string }>;
}

const reject = (
  record: ImportCandidateRecord,
  reason: string,
): ImportCandidateDecision => ({
  status: 'rejected',
  id: record.id,
  productUrl: record.productUrl,
  reason,
});

const priceBandOf = (price: number): CatalogImportAttributeRow['price_band'] => {
  if (price <= PRICE_BAND_LOW_MAX) return 'low';
  if (price <= PRICE_BAND_MID_MAX) return 'mid';
  if (price <= PRICE_BAND_HIGH_MAX) return 'high';
  return 'luxury';
};

const isFitSlug = (value: string): value is FitSlug => FIT_SLUGS.has(value);

const verifiedGender = (record: ImportCandidateRecord): ProductGender | null | 'invalid' => {
  if (record.genderStatus !== 'verified') return null;
  if (record.gender === 'women' || record.gender === 'men' || record.gender === 'unisex') {
    return record.gender;
  }
  return 'invalid';
};

/** Maps one candidate to a catalog row. Title text is stored, never parsed. */
export const mapImportCandidate = (
  record: ImportCandidateRecord,
): ImportCandidateDecision => {
  if (!isFeedProvider(record.source)) return reject(record, 'unsupported_provider');
  if (record.child || record.pieceKind !== 'single' || record.roleStatus !== 'verified') {
    return reject(record, 'unverified_role');
  }
  if (!isOutfitRole(record.role) || !isGarmentCategory(record.category)) {
    return reject(record, 'invalid_role_or_category');
  }
  if (CATEGORY_FOR_ROLE[record.role] !== record.category) {
    return reject(record, 'role_category_mismatch');
  }
  if (record.title.trim().length === 0) return reject(record, 'missing_title');
  if (!(typeof record.price === 'number' && Number.isFinite(record.price) && record.price > 0)) {
    return reject(record, 'missing_price');
  }
  if (record.currency !== 'TRY') return reject(record, 'missing_currency');
  if (!record.imageUrl.startsWith('https://')) return reject(record, 'missing_image');
  if (!record.observedOn.trim()) return reject(record, 'missing_observed_on');

  let productUrl: string;
  try {
    productUrl = canonicalizeCatalogUrl(record.productUrl);
  } catch {
    return reject(record, 'invalid_url');
  }
  const provider = record.source;
  const externalId = extractCatalogExternalId(productUrl, provider);
  if (!externalId || externalId !== record.externalId || record.id !== `${provider}-${externalId}`) {
    return reject(record, 'identity_mismatch');
  }

  const gender = verifiedGender(record);
  if (gender === 'invalid') return reject(record, 'invalid_gender');
  if (record.colorStatus === 'verified' && (record.color === null || !COLOR_SLUGS.has(record.color))) {
    return reject(record, 'color_outside_vocab');
  }
  if (record.fitStatus === 'verified' && (record.fit === null || !FIT_SLUGS.has(record.fit))) {
    return reject(record, 'fit_outside_vocab');
  }
  if (record.canonicalSubtype !== null) return reject(record, 'unverified_subtype_present');

  const brand = record.brand?.trim() ? record.brand.trim() : null;
  const fit = record.fitStatus === 'verified' && record.fit !== null && isFitSlug(record.fit)
    ? record.fit
    : null;

  return {
    status: 'ready',
    payload: {
      product: {
        id: record.id,
        provider,
        external_id: externalId,
        title: record.title.trim(),
        brand,
        price: record.price,
        currency: 'TRY',
        image_url: record.imageUrl,
        images: [record.imageUrl],
        product_url: productUrl,
        category: record.category,
        affiliate_url: null,
        garment_description: null,
      },
      attributes: {
        product_id: record.id,
        gender,
        colors: record.colorStatus === 'verified' && record.color ? [record.color] : [],
        fit,
        subcategory: null,
        brand_slug: brand ? slugify(brand) : null,
        price_band: priceBandOf(record.price),
        material: null,
        season: null,
        occasion: null,
        style_tags: null,
        outfit_role: record.role,
      },
    },
  };
};

export const buildImportBatch = (
  records: readonly ImportCandidateRecord[],
  existingIds: ReadonlySet<string>,
  existingUrls: ReadonlySet<string>,
): ImportBatchResult => {
  const ready: CatalogImportPayload[] = [];
  const rejected: ImportBatchResult['rejected'] = [];
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const ordered = [...records].sort((left, right) => left.id.localeCompare(right.id));
  for (const record of ordered) {
    const decision = mapImportCandidate(record);
    if (decision.status === 'rejected') {
      rejected.push({ id: decision.id, productUrl: decision.productUrl, reason: decision.reason });
      continue;
    }
    const { payload } = decision;
    if (seenIds.has(payload.product.id) || seenUrls.has(payload.product.product_url)) {
      rejected.push({ id: record.id, productUrl: record.productUrl, reason: 'duplicate_in_input' });
      continue;
    }
    if (existingIds.has(payload.product.id) || existingUrls.has(payload.product.product_url)) {
      rejected.push({ id: record.id, productUrl: record.productUrl, reason: 'already_in_catalog' });
      continue;
    }
    seenIds.add(payload.product.id);
    seenUrls.add(payload.product.product_url);
    ready.push(payload);
  }
  ready.sort((left, right) => left.product.id.localeCompare(right.product.id));
  rejected.sort((left, right) => left.id.localeCompare(right.id) || left.reason.localeCompare(right.reason));
  return { ready, rejected };
};

import { evaluateCatalogEligibility } from '../../../lib/catalogEligibility';
import {
  computeCatalogEnrichment,
  type CatalogEnrichment,
  type EligibilityField,
} from '../../../lib/catalogEnrichment';
import { FIT_VOCAB, inferPriceBand, slugify, type FitSlug } from '../../../lib/productAttributes';
import type { ColorVariant, ProductGender, SizeOption } from '../../../types/product';
import type { CatalogImportAttributeRow, CatalogImportProductRow } from '../catalogImportPreflight';
import { canonicalizeCatalogUrl } from '../seedExpansionRules';
import { mapFeedCategory, type CategoryDecision } from './categoryMap';
import { mapFeedColors } from './colorMap';
import { field, fieldAll, type RawFeedItem } from './parse';

export type MerchantRejectReason =
  | 'missing_id'
  | 'missing_title'
  | 'child'
  | 'out_of_stock'
  | 'missing_link'
  | 'invalid_url'
  | 'missing_image'
  | 'invalid_image'
  | 'missing_price'
  | 'invalid_price'
  | 'missing_currency'
  | 'unsupported_currency'
  | 'unmapped_category'
  | 'unsupported_category'
  | 'category_conflict'
  | 'duplicate_in_input';

/** products row in the existing import shape, with the provider widened to the CLI slug and the new columns added. */
export type MerchantProductRow = Omit<CatalogImportProductRow, 'provider'> & {
  provider: string;
  current_price: number;
  gender: CatalogEnrichment['gender'];
  feed_eligible: boolean;
  eligibility_missing: EligibilityField[];
  attribute_source: string;
  attribute_version: number;
  color_variants: ColorVariant[] | null;
  size_options: SizeOption[] | null;
};

export type MerchantAttributeRow = Omit<CatalogImportAttributeRow, 'subcategory'> & { subcategory: string | null };

export interface MerchantPayload {
  product: MerchantProductRow;
  attributes: MerchantAttributeRow;
  /** isActiveCatalogRecord-equivalent verdict; the provider check is skipped until the provider constraint migration. */
  active: boolean;
  activeMissing: string[];
}

export interface MerchantRejection {
  id: string;
  reason: MerchantRejectReason;
  /** Folded category leaf for category rejections. */
  key?: string;
}

export interface MerchantStats {
  totalItems: number;
  units: number;
  childItems: number;
  outOfStockItems: number;
  variantGroups: number;
  multiColorGroups: number;
  unmappedColors: Record<string, number>;
  unmappedCategories: Record<string, number>;
  enrichmentReview: number;
}

export interface MerchantImportResult {
  provider: string;
  payloads: MerchantPayload[];
  rejected: MerchantRejection[];
  stats: MerchantStats;
}

const PROVIDER_SLUG = /^[a-z][a-z0-9]{1,23}$/;

export const isValidProviderSlug = (value: string): boolean => PROVIDER_SLUG.test(value);

export interface ParsedFeedPrice {
  amount: number;
  /** Upper-case ISO code; empty when the feed gave none. "TL" is read as TRY. */
  currency: string;
}

const numberOf = (raw: string): number | null => {
  const text = raw.replace(/[\s ]/g, '');
  if (!/^\d[\d.,]*$/.test(text)) return null;
  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    // The later separator is the decimal mark; the other one groups thousands.
    const decimal = lastDot > lastComma ? '.' : ',';
    const group = decimal === '.' ? ',' : '.';
    normalized = text.split(group).join('').replace(decimal, '.');
  } else if (lastDot >= 0 || lastComma >= 0) {
    const mark = lastDot >= 0 ? '.' : ',';
    const parts = text.split(mark);
    // "1.299" / "1,299" with exactly three trailing digits and one mark group thousands; otherwise decimal.
    const groups = parts.length > 2 || (parts.length === 2 && parts[1].length === 3);
    normalized = groups ? parts.join('') : `${parts[0]}.${parts[1]}`;
  } else {
    normalized = text;
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
};

/** Parses "1.299,00 TRY", "1299.00 TRY", "1,299.50 TRY", "299,90 TL". Null when no valid positive-format number exists. */
export const parseFeedPrice = (raw: string): ParsedFeedPrice | null => {
  const match = raw.trim().match(/^(.*?)(?:\s*([A-Za-z]{2,3}))?$/);
  if (!match) return null;
  const amount = numberOf(match[1] ?? '');
  if (amount === null) return null;
  const code = (match[2] ?? '').toUpperCase();
  return { amount, currency: code === 'TL' ? 'TRY' : code };
};

const CHILD_AGE_GROUPS = new Set(['kids', 'infant', 'toddler', 'newborn']);

const fold = (value: string): string => value.trim().toLocaleLowerCase('en-US');

const isOutOfStock = (item: RawFeedItem): boolean =>
  fold(field(item, 'availability')).replace(/[\s-]+/g, '_').replace(/^outofstock$/, 'out_of_stock') === 'out_of_stock';

const isChild = (item: RawFeedItem): boolean => CHILD_AGE_GROUPS.has(fold(field(item, 'age_group')));

const feedGender = (item: RawFeedItem): 'kadin' | 'erkek' | 'unisex' | null => {
  const value = field(item, 'gender').trim().toLocaleLowerCase('tr-TR');
  if (value === 'male' || value === 'men' || value === 'erkek') return 'erkek';
  if (value === 'female' || value === 'women' || value === 'kadin' || value === 'kadın') return 'kadin';
  if (value === 'unisex') return 'unisex';
  return null;
};

const LEGACY_GENDER: Record<string, ProductGender> = { kadin: 'women', erkek: 'men', unisex: 'unisex' };

const httpsUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
};

interface ValidItem {
  id: string;
  title: string;
  brand: string | null;
  productUrl: string;
  imageUrl: string;
  extraImages: string[];
  price: number;
  currentPrice: number;
  colorRaw: string;
  gender: 'kadin' | 'erkek' | 'unisex' | null;
  category: Extract<CategoryDecision, { ok: true }>;
}

type ItemCheck = { ok: true; value: ValidItem } | { ok: false; reason: MerchantRejectReason; key?: string };

const fail = (reason: MerchantRejectReason, key?: string): ItemCheck => ({ ok: false, reason, key });

const checkItem = (item: RawFeedItem): ItemCheck => {
  const id = field(item, 'id');
  if (id.length === 0) return fail('missing_id');
  const title = field(item, 'title');
  if (title.length === 0) return fail('missing_title');
  const link = field(item, 'link');
  if (link.length === 0) return fail('missing_link');
  let productUrl: string;
  try {
    productUrl = canonicalizeCatalogUrl(link);
  } catch {
    return fail('invalid_url');
  }
  const imageUrl = field(item, 'image_link');
  if (imageUrl.length === 0) return fail('missing_image');
  if (!httpsUrl(imageUrl)) return fail('invalid_image');
  const priceRaw = field(item, 'price');
  if (priceRaw.length === 0) return fail('missing_price');
  const price = parseFeedPrice(priceRaw);
  if (price === null || !(price.amount > 0)) return fail('invalid_price');
  if (price.currency === '') return fail('missing_currency');
  if (price.currency !== 'TRY') return fail('unsupported_currency');
  const decision = mapFeedCategory({
    googleCategory: field(item, 'google_product_category'),
    productTypes: fieldAll(item, 'product_type'),
  });
  if (!decision.ok) return fail(decision.reason, decision.key);
  const sale = parseFeedPrice(field(item, 'sale_price'));
  const useSale = sale !== null && sale.currency === 'TRY' && sale.amount > 0 && sale.amount < price.amount;
  return {
    ok: true,
    value: {
      id,
      title,
      brand: field(item, 'brand') || null,
      productUrl,
      imageUrl,
      extraImages: fieldAll(item, 'additional_image_link').filter(httpsUrl),
      price: price.amount,
      currentPrice: useSale ? sale.amount : price.amount,
      colorRaw: field(item, 'color'),
      gender: feedGender(item),
      category: decision,
    },
  };
};

interface Unit {
  groupId: string;
  colorKey: string;
  externalId: string;
  members: RawFeedItem[];
}

const buildUnits = (items: readonly RawFeedItem[]): Unit[] => {
  const units = new Map<string, Unit>();
  items.forEach((item, index) => {
    const id = field(item, 'id');
    const groupId = field(item, 'item_group_id');
    const colorKey = slugify(field(item, 'color'));
    let key: string;
    let externalId: string;
    if (id.length === 0) {
      key = `noid:${index}`;
      externalId = '';
    } else if (groupId.length === 0) {
      key = `item:${id}`;
      externalId = id;
    } else {
      key = `group:${groupId}\u0000${colorKey}`;
      externalId = colorKey ? `${groupId}-${colorKey}` : groupId;
    }
    const unit = units.get(key);
    if (unit) unit.members.push(item);
    else units.set(key, { groupId, colorKey, externalId, members: [item] });
  });
  return [...units.values()];
};

const sizeOptionsOf = (members: readonly RawFeedItem[]): SizeOption[] | null => {
  const sizes = new Map<string, boolean>();
  for (const item of members) {
    const inStock = !isOutOfStock(item);
    for (const raw of fieldAll(item, 'size')) {
      const label = raw.trim();
      if (label.length > 0) sizes.set(label, (sizes.get(label) ?? false) || inStock);
    }
  }
  return sizes.size === 0 ? null : [...sizes].map(([label, inStock]) => ({ label, inStock }));
};

const unique = (values: readonly string[]): string[] => [...new Set(values)];

const isFit = (value: string | null): value is FitSlug =>
  value !== null && (FIT_VOCAB as readonly string[]).includes(value);

interface Candidate {
  unit: Unit;
  payload: MerchantPayload;
  colorRaw: string;
  unmappedColors: string[];
  reviewCount: number;
}

const bump = (counts: Record<string, number>, key: string): void => {
  counts[key] = (counts[key] ?? 0) + 1;
};

export const buildMerchantImport = (
  items: readonly RawFeedItem[],
  provider: string,
): MerchantImportResult => {
  if (!isValidProviderSlug(provider)) throw new Error('invalid_provider');

  const rejected: MerchantRejection[] = [];
  const candidates: Candidate[] = [];
  const stats: MerchantStats = {
    totalItems: items.length,
    units: 0,
    childItems: items.filter(isChild).length,
    outOfStockItems: items.filter((item) => !isChild(item) && isOutOfStock(item)).length,
    variantGroups: 0,
    multiColorGroups: 0,
    unmappedColors: {},
    unmappedCategories: {},
    enrichmentReview: 0,
  };

  const units = buildUnits(items);
  stats.units = units.length;

  for (const unit of units) {
    const adults = unit.members.filter((item) => !isChild(item));
    if (adults.length === 0) {
      rejected.push({ id: unit.externalId || field(unit.members[0], 'id'), reason: 'child' });
      continue;
    }
    const inStock = adults
      .filter((item) => !isOutOfStock(item))
      .sort((left, right) => (field(left, 'id') < field(right, 'id') ? -1 : field(left, 'id') > field(right, 'id') ? 1 : 0));
    if (inStock.length === 0) {
      rejected.push({ id: unit.externalId || field(adults[0], 'id'), reason: 'out_of_stock' });
      continue;
    }
    let value: ValidItem | null = null;
    let firstFailure: Extract<ItemCheck, { ok: false }> | null = null;
    for (const item of inStock) {
      const check = checkItem(item);
      if (check.ok) {
        value = check.value;
        break;
      }
      firstFailure ??= check;
    }
    if (value === null) {
      const failure = firstFailure!;
      rejected.push({ id: unit.externalId || field(inStock[0], 'id'), reason: failure.reason, key: failure.key });
      if (failure.key !== undefined) bump(stats.unmappedCategories, failure.key);
      continue;
    }

    const colors = mapFeedColors(value.colorRaw);
    const externalId = unit.externalId;
    const id = `${provider}-${externalId}`;
    const images = unique([value.imageUrl, ...value.extraImages, ...adults.flatMap((item) => [
      field(item, 'image_link'), ...fieldAll(item, 'additional_image_link'),
    ].filter(httpsUrl))]);
    const enrichment = computeCatalogEnrichment(
      {
        id,
        title: value.title,
        brand: value.brand,
        category: value.category.category,
        product_url: value.productUrl,
        price: value.price,
        current_price: value.currentPrice,
        image_url: value.imageUrl,
        gender: value.gender,
      },
      { colors: colors.slugs, fit: null, subcategory: value.category.subcategory, gender: null },
    );
    if (enrichment.gender === 'cocuk') {
      rejected.push({ id: externalId, reason: 'child' });
      continue;
    }
    const eligibility = evaluateCatalogEligibility({
      id,
      title: value.title,
      image_url: value.imageUrl,
      images,
      category: value.category.category,
      provider,
      product_url: value.productUrl,
      external_id: externalId,
      colorSlugs: enrichment.colors,
      subcategory: enrichment.subcategory,
    });
    // Unknown providers only fail the provider check until the constraint migration; every other gap is real.
    const activeMissing = eligibility.missing.filter((missing) => missing !== 'provider');

    candidates.push({
      unit,
      colorRaw: value.colorRaw,
      unmappedColors: colors.unmapped,
      reviewCount: enrichment.review.length,
      payload: {
        product: {
          id,
          provider,
          external_id: externalId,
          title: value.title,
          brand: value.brand,
          price: value.price,
          current_price: value.currentPrice,
          currency: 'TRY',
          image_url: value.imageUrl,
          images,
          product_url: value.productUrl,
          category: value.category.category,
          garment_description: null,
          affiliate_url: null,
          gender: enrichment.gender,
          feed_eligible: enrichment.feedEligible,
          eligibility_missing: enrichment.eligibilityMissing,
          attribute_source: enrichment.attributeSource,
          attribute_version: enrichment.attributeVersion,
          color_variants: null,
          size_options: sizeOptionsOf(adults),
        },
        attributes: {
          product_id: id,
          gender: enrichment.gender ? LEGACY_GENDER[enrichment.gender] ?? null : null,
          colors: enrichment.colors,
          fit: isFit(enrichment.fit) ? enrichment.fit : null,
          subcategory: enrichment.subcategory,
          brand_slug: value.brand ? slugify(value.brand) : null,
          price_band: inferPriceBand(value.currentPrice),
          material: null,
          season: null,
          occasion: null,
          style_tags: null,
          outfit_role: value.category.outfitRole,
        },
        active: activeMissing.length === 0,
        activeMissing,
      },
    });
  }

  // Duplicate guard on the final identity: first id wins, later same-id or same-url products are dropped.
  candidates.sort((left, right) => (left.payload.product.id < right.payload.product.id ? -1 : 1));
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const survivors: Candidate[] = [];
  for (const candidate of candidates) {
    const { id, product_url } = candidate.payload.product;
    if (seenIds.has(id) || seenUrls.has(product_url)) {
      rejected.push({ id: candidate.unit.externalId, reason: 'duplicate_in_input' });
      continue;
    }
    seenIds.add(id);
    seenUrls.add(product_url);
    survivors.push(candidate);
  }

  // Siblings of one item_group_id (surviving products only), in feed order, become color_variants.
  const byGroup = new Map<string, Candidate[]>();
  for (const candidate of survivors) {
    if (candidate.unit.groupId.length === 0) continue;
    byGroup.set(candidate.unit.groupId, [...(byGroup.get(candidate.unit.groupId) ?? []), candidate]);
  }
  const feedOrder = new Map(units.map((unit, index) => [unit, index]));
  for (const members of byGroup.values()) {
    if (members.length < 2) continue;
    const ordered = [...members].sort((left, right) => feedOrder.get(left.unit)! - feedOrder.get(right.unit)!);
    const variants: ColorVariant[] = ordered.map((member) => ({
      name: member.colorRaw || null,
      url: member.payload.product.product_url,
      imageUrl: member.payload.product.image_url,
    }));
    for (const member of members) member.payload.product.color_variants = variants;
  }

  const groupColors = new Map<string, Set<string>>();
  for (const unit of units) {
    if (unit.groupId.length === 0) continue;
    groupColors.set(unit.groupId, (groupColors.get(unit.groupId) ?? new Set()).add(unit.colorKey));
  }
  const itemsPerGroup = new Map<string, number>();
  for (const item of items) {
    const group = field(item, 'item_group_id');
    if (group.length > 0) itemsPerGroup.set(group, (itemsPerGroup.get(group) ?? 0) + 1);
  }
  stats.variantGroups = [...itemsPerGroup.values()].filter((count) => count > 1).length;
  stats.multiColorGroups = [...groupColors.values()].filter((colors) => colors.size > 1).length;

  for (const candidate of survivors) {
    for (const color of candidate.unmappedColors) bump(stats.unmappedColors, color);
    stats.enrichmentReview += candidate.reviewCount;
  }

  rejected.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : left.reason < right.reason ? -1 : 1));
  return { provider, payloads: survivors.map((candidate) => candidate.payload), rejected, stats };
};

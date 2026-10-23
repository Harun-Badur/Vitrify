import {
  isFeedProvider,
  isGarmentCategory,
  isOutfitRole,
  type OutfitRole,
  type ProductGender,
} from '../../types/product';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export interface HydratedImportRecord {
  id: string;
  provider: string;
  externalId: string;
  title: string;
  brand: string;
  garmentDescription: string | null;
  price: number;
  currency: 'TRY';
  imageUrl: string;
  productUrl: string;
  category: string;
  outfitRole: OutfitRole;
  gender: ProductGender | null;
  colors: string[];
  fit: string | null;
  subcategory: null;
  material: null;
  season: null;
  occasion: null;
  styleTags: null;
}

export type ImportHydrationDecision =
  | { status: 'import_ready'; record: HydratedImportRecord }
  | { status: 'needs_enrichment' | 'manual_review'; id: string; reason: string };

const text = (value: unknown): string | null => typeof value === 'string' ? value.trim() : null;

const CATEGORY_FOR_ROLE: Record<OutfitRole, string> = {
  top: 'upper_body',
  bottom: 'lower_body',
  outerwear: 'upper_body',
  one_piece: 'dresses',
  shoes: 'shoes',
  bag: 'bags',
  hat: 'hats',
  accessory: 'accessories',
};

const reject = (
  id: string,
  status: 'needs_enrichment' | 'manual_review',
  reason: string,
): ImportHydrationDecision => ({ status, id, reason });

const synthesizedDescription = (brand: string, title: string, description: string): boolean =>
  description === title || description === `${brand} ${title}`.trim();

/** Read a stored import row without filling nulls from the title or a placeholder brand. */
export const hydrateImportPayload = (value: unknown): ImportHydrationDecision => {
  if (!isRecord(value) || !isRecord(value.product) || !isRecord(value.attributes)) {
    return reject('unknown', 'needs_enrichment', 'missing_row');
  }
  const product = value.product;
  const attributes = value.attributes;
  const id = text(product.id) ?? 'unknown';
  if (!isFeedProvider(product.provider)) return reject(id, 'manual_review', 'unsupported_provider');
  if (!text(product.title)) return reject(id, 'needs_enrichment', 'missing_title');
  if (!(typeof product.price === 'number' && Number.isFinite(product.price) && product.price > 0)) {
    return reject(id, 'needs_enrichment', 'missing_price');
  }
  if (product.currency !== 'TRY') return reject(id, 'needs_enrichment', 'missing_currency');
  if (!text(product.image_url)?.startsWith('https://')) return reject(id, 'needs_enrichment', 'missing_image');
  if (!text(product.product_url)?.startsWith('https://')) return reject(id, 'needs_enrichment', 'missing_url');
  if (!isGarmentCategory(product.category)) return reject(id, 'manual_review', 'invalid_category');
  if (!isOutfitRole(attributes.outfit_role)) return reject(id, 'manual_review', 'unverified_role');
  if (CATEGORY_FOR_ROLE[attributes.outfit_role] !== product.category) {
    return reject(id, 'manual_review', 'role_category_mismatch');
  }
  const brand = text(product.brand);
  if (!brand) return reject(id, 'needs_enrichment', 'missing_brand');
  const description = product.garment_description;
  let garmentDescription: string | null = null;
  if (description !== null) {
    const title = text(product.title) ?? '';
    if (typeof description !== 'string') return reject(id, 'needs_enrichment', 'synthesized_description');
    const trimmed = description.trim();
    if (trimmed.length > 0 && synthesizedDescription(brand, title, trimmed)) {
      return reject(id, 'needs_enrichment', 'synthesized_description');
    }
    garmentDescription = trimmed.length > 0 ? trimmed : null;
  }
  const gender = attributes.gender;
  if (gender !== null && gender !== 'women' && gender !== 'men' && gender !== 'unisex') {
    return reject(id, 'manual_review', 'invalid_gender');
  }
  const colors = attributes.colors;
  if (!Array.isArray(colors) || !colors.every((color): color is string => typeof color === 'string')) {
    return reject(id, 'needs_enrichment', 'invalid_colors');
  }
  if (attributes.subcategory !== null || attributes.material !== null || attributes.season !== null || attributes.occasion !== null || attributes.style_tags !== null) {
    return reject(id, 'needs_enrichment', 'unverified_optional_metadata');
  }
  const title = text(product.title);
  const imageUrl = text(product.image_url);
  const productUrl = text(product.product_url);
  if (!title || !imageUrl || !productUrl) return reject(id, 'needs_enrichment', 'missing_row');
  return {
    status: 'import_ready',
    record: {
      id,
      provider: product.provider,
      externalId: text(product.external_id) ?? '',
      title,
      brand,
      garmentDescription,
      price: product.price,
      currency: 'TRY',
      imageUrl,
      productUrl,
      category: product.category,
      outfitRole: attributes.outfit_role,
      gender,
      colors,
      fit: typeof attributes.fit === 'string' && attributes.fit.trim() ? attributes.fit.trim() : null,
      subcategory: null,
      material: null,
      season: null,
      occasion: null,
      styleTags: null,
    },
  };
};

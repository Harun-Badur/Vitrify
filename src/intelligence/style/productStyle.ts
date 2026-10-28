import { catalogMetadataRepair, cleanDeclaredCatalogColors, declaredCatalogFit, declaredCatalogGender } from '../../../lib/catalogMetadata.ts';
import { inferProductAttributes, type InferredProductAttributes } from '../../../lib/productAttributes.ts';
import {
  getDisplayPrice,
  isOutfitRole,
  type GarmentCategory,
  type OutfitRole,
  type Product,
  type ProductGender,
} from '../../../types/product.ts';

export interface ProductAttributeRow {
  product_id: string;
  gender: string | null;
  colors: unknown;
  fit: string | null;
  subcategory: string | null;
  brand_slug: string | null;
  price_band: string | null;
  outfit_role?: string | null;
}

const OUTFIT_ROLE_BY_CATEGORY: Readonly<Record<GarmentCategory, OutfitRole>> = {
  upper_body: 'top',
  lower_body: 'bottom',
  dresses: 'one_piece',
  shoes: 'shoes',
  bags: 'bag',
  hats: 'hat',
  accessories: 'accessory',
};

/** Explicit metadata wins; only known catalog categories receive a fallback role. */
export const resolveCatalogOutfitRole = (
  category: GarmentCategory,
  explicitRole: unknown,
): OutfitRole | null =>
  isOutfitRole(explicitRole) ? explicitRole : OUTFIT_ROLE_BY_CATEGORY[category] ?? null;

const isProductGender = (value: unknown): value is ProductGender =>
  value === 'women' || value === 'men' || value === 'unisex';

// Product objects are immutable in the catalog pipeline; scope reuse to their lifetime.
const inferredByProduct = new WeakMap<Product, { key: string; attributes: InferredProductAttributes }>();
export const preparedProductAttributes = (product: Product): InferredProductAttributes => {
  const price = getDisplayPrice(product);
  const names = product.colors?.map(color => color.name);
  const key = JSON.stringify([product.title, product.brand, price, product.category, names]);
  const cached = inferredByProduct.get(product);
  if (cached?.key === key) return cached.attributes;
  const attributes = inferProductAttributes({ title: product.title, brand: product.brand,
    price, category: product.category, existingColorNames: names });
  inferredByProduct.set(product, { key, attributes });
  return attributes;
};

/** Same color and subcategory evidence enrichProduct writes. Not a second predictor. */
export const resolveCatalogAppearance = (
  product: Product,
  attr: ProductAttributeRow | undefined,
): { colors: string[]; subcategory: string | undefined } => {
  const inferred = preparedProductAttributes(product);
  const repair = catalogMetadataRepair(product.id);
  const declaredColors = cleanDeclaredCatalogColors(product.id, attr?.colors);
  return {
    colors: declaredColors.length > 0 ? declaredColors : inferred.colors,
    subcategory: repair?.subcategory ?? attr?.subcategory ?? inferred.subcategory,
  };
};

export const enrichProduct = (
  product: Product,
  attr: ProductAttributeRow | undefined,
): Product => {
  const inferred = preparedProductAttributes(product);
  const repair = catalogMetadataRepair(product.id);
  const appearance = resolveCatalogAppearance(product, attr);
  const genderRaw = declaredCatalogGender(attr?.gender) || inferred.gender;
  const enriched: Product = {
    ...product,
    gender: isProductGender(genderRaw) ? genderRaw : inferred.gender ?? '',
    colorSlugs: appearance.colors,
    fit: declaredCatalogFit(attr?.fit) || inferred.fit,
    subcategory: appearance.subcategory,
    brandSlug: attr?.brand_slug ?? inferred.brand_slug,
    priceBand: attr?.price_band ?? inferred.price_band,
    outfitRole: resolveCatalogOutfitRole(
      product.category,
      repair?.outfitRole ?? (isOutfitRole(attr?.outfit_role) ? attr.outfit_role : product.outfitRole),
    ),
  };
  const prepared = inferredByProduct.get(product);
  if (prepared) inferredByProduct.set(enriched, prepared);
  return enriched;
};

export { inferGenderFromTitle } from '../../../lib/productAttributes.ts';

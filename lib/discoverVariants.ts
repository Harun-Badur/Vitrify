import type { ColorVariant, Product, SizeOption } from '../types/product';
import { resolveSwatch } from './colorSwatch';

const MAX_COLOR_DOTS = 6;
const COLOR_DOTS_WHEN_CAPPED = 5;
const MAX_SIZE_CHIPS = 10;
const SINGLE_LINE_MAX_SIZES = 5;
const SINGLE_LINE_MAX_COLORS = 4;

export interface VariantRowPlan {
  showColors: boolean;
  showSizes: boolean;
  sizesOnSecondLine: boolean;
}

export const planVariantRow = (
  colorVariants: readonly ColorVariant[] | undefined,
  sizeOptions: readonly SizeOption[] | undefined,
): VariantRowPlan => {
  const colorCount = colorVariants?.length ?? 0;
  const sizeCount = sizeOptions?.length ?? 0;
  return {
    showColors: colorCount > 0,
    showSizes: sizeCount > 0,
    sizesOnSecondLine: sizeCount > SINGLE_LINE_MAX_SIZES || colorCount > SINGLE_LINE_MAX_COLORS,
  };
};

export const visibleColors = <T,>(colors: readonly T[]): { shown: T[]; overflow: number } =>
  colors.length > MAX_COLOR_DOTS
    ? { shown: colors.slice(0, COLOR_DOTS_WHEN_CAPPED), overflow: colors.length - COLOR_DOTS_WHEN_CAPPED }
    : { shown: [...colors], overflow: 0 };

export const visibleSizes = <T,>(sizes: readonly T[]): { shown: T[]; overflow: number } =>
  sizes.length > MAX_SIZE_CHIPS
    ? { shown: sizes.slice(0, MAX_SIZE_CHIPS - 1), overflow: sizes.length - (MAX_SIZE_CHIPS - 1) }
    : { shown: [...sizes], overflow: 0 };

/** The product's single known color (no variants available): dot + name. */
export const fallbackColor = (product: Product): { name: string; hex: string } | null => {
  if (product.colors?.length !== 1) return null;
  const [color] = product.colors;
  const swatch = resolveSwatch(color.name);
  return swatch.kind === 'hex' ? { name: color.name, hex: swatch.hex } : null;
};

export interface VariantSelectionState {
  productId: string;
  index: number;
}

/** Selection belongs to one card; any other product id reads as "nothing selected". */
export const activeVariantIndex = (
  state: VariantSelectionState | null,
  productId: string,
): number | null => (state !== null && state.productId === productId ? state.index : null);

export const selectedImageFor = (
  variants: readonly ColorVariant[] | undefined,
  index: number | null,
): string | null => (index === null ? null : variants?.[index]?.imageUrl?.trim() || null);

/** Store button target: variant url on the main product (identity, price, title unchanged). */
export const storeProductFor = (product: Product, index: number | null): Product => {
  const variant = index === null ? undefined : product.colorVariants?.[index];
  if (!variant?.url) return product;
  return { ...product, productUrl: variant.url, affiliateUrl: undefined };
};

import type { ColorVariant, Product, SizeOption } from '../types/product';
import { resolveSwatch } from './colorSwatch';

/** Fixed height of the price row (color/chip baseline) so the footer never changes height. */
export const VARIANT_ROW_HEIGHT = 28;
const MAX_COLOR_PREVIEWS = 3;
const MIN_COLOR_PREVIEWS = 2;
const COLOR_SIZE = 26;
const COLOR_GAP = 6;
const COLOR_MORE_WIDTH = 20;
const DIVIDER_SPAN = 13; // 1px line + 6dp each side
const CHIP_GAP = 4;
const CHIP_MIN = 24;
const CHIP_PADDING = 12;
const CHIP_CHAR = 7;

export interface VariantRowFit {
  colorCount: number;
  colorOverflow: number;
  chipCount: number;
  /** Sizes not shown as chips; rendered as a single "+K" chip. */
  hiddenSizes: number;
}

export const chipWidth = (label: string): number =>
  Math.max(CHIP_MIN, CHIP_PADDING + label.length * CHIP_CHAR);

const colorsWidth = (count: number, overflow: number): number =>
  count === 0 ? 0 : count * COLOR_SIZE + (count - 1) * COLOR_GAP + (overflow > 0 ? COLOR_GAP + COLOR_MORE_WIDTH : 0);

const fitChips = (labels: readonly string[], room: number): { shown: number; hidden: number } => {
  let used = 0;
  let shown = 0;
  while (shown < labels.length) {
    const next = used + (shown > 0 ? CHIP_GAP : 0) + chipWidth(labels[shown]);
    const hidden = labels.length - (shown + 1);
    const reserve = hidden > 0 ? CHIP_GAP + chipWidth(`+${hidden}`) : 0;
    if (next + reserve > room) break;
    used = next;
    shown += 1;
  }
  const hidden = labels.length - shown;
  if (shown === 0 && chipWidth(`+${hidden}`) > room) return { shown: 0, hidden: 0 };
  return { shown, hidden };
};

/**
 * Single-line fit for the right side of the price row. Priority: up to 3 color previews,
 * divider, as many size chips as fit, remainder collapsed into one "+K" chip.
 * Colors drop to 2 when that is needed to show at least 2 chips.
 */
export const fitVariantRow = (
  width: number,
  colorTotal: number,
  sizeLabels: readonly string[],
): VariantRowFit => {
  let maxColors = Math.min(colorTotal, MAX_COLOR_PREVIEWS);
  while (maxColors > 0 && colorsWidth(maxColors, colorTotal - maxColors) > width) maxColors -= 1;
  if (sizeLabels.length === 0) {
    return { colorCount: maxColors, colorOverflow: colorTotal - maxColors, chipCount: 0, hiddenSizes: 0 };
  }
  const attempt = (colorCount: number): VariantRowFit => {
    const overflow = colorTotal - colorCount;
    const colorSpan = colorCount === 0 ? 0 : colorsWidth(colorCount, overflow) + DIVIDER_SPAN;
    const { shown, hidden } = fitChips(sizeLabels, width - colorSpan);
    return { colorCount, colorOverflow: overflow, chipCount: shown, hiddenSizes: hidden };
  };
  const wanted = Math.min(MIN_COLOR_PREVIEWS, sizeLabels.length);
  const first = attempt(maxColors);
  if (first.chipCount >= wanted || maxColors <= MIN_COLOR_PREVIEWS) return first;
  return attempt(MIN_COLOR_PREVIEWS);
};

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

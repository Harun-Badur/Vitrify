import { STUDIO_BRANDS, STUDIO_COLORS } from '../types/profile';
import { COLORS } from './styleVocabulary';

// Display layer only: nothing here is written back to raw data or the database.

export const NEUTRAL_SWATCH = '#D1D5DB';

const fold = (value: string) => value.trim().toLocaleLowerCase('tr-TR').normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, ' ').trim();
const compact = (value: string) => fold(value).replace(/ /g, '');

export const displayLabel = (raw: string): string =>
  raw.trim().replace(/[-_]+/g, ' ').split(/\s+/).filter(Boolean)
    .map(word => word.charAt(0).toLocaleUpperCase('tr-TR') + word.slice(1).toLocaleLowerCase('tr-TR')).join(' ');

const CANONICAL_BRANDS = new Map<string, string>([
  ...STUDIO_BRANDS.map(brand => [compact(brand), brand] as [string, string]),
  ['hm', 'H&M'],
]);

/** "lcw-classic" → "LC Waikiki". Known names keep their own casing; the rest is title-cased. */
export const brandLabel = (raw: string): string => {
  const key = compact(raw);
  if (!key) return '';
  const words = fold(raw).split(' ');
  if (words[0] === 'lcw' || key.startsWith('lcwaikiki') || key.startsWith('lcw')) return 'LC Waikiki';
  return CANONICAL_BRANDS.get(key) ?? displayLabel(raw);
};

const EXTRA_SWATCHES: Record<string, string> = {
  altin: '#C9A227', gumus: '#C0C0C0', turkuaz: '#26B5B0', camel: '#C19A6B',
};
const swatches = new Map<string, string>();
for (const color of STUDIO_COLORS) swatches.set(fold(color.label), color.hex);
for (const [name, hex] of Object.entries(EXTRA_SWATCHES)) swatches.set(name, hex);
for (const color of COLORS) {
  if (!color.hex) continue;
  swatches.set(fold(color.slug), color.hex);
  swatches.set(fold(color.label), color.hex);
}

const EXTRA_NAMES: Record<string, string> = { altin: 'Altın', gumus: 'Gümüş', turkuaz: 'Turkuaz', camel: 'Camel' };
const colorNames = new Map<string, string>();
for (const color of STUDIO_COLORS) colorNames.set(fold(color.label), color.label);
for (const [slug, name] of Object.entries(EXTRA_NAMES)) colorNames.set(slug, name);
for (const color of COLORS) { colorNames.set(fold(color.slug), color.label); colorNames.set(fold(color.label), color.label); }

/** Turkish colour name for a slug or label; unknown values are only title-cased. */
export const colorName = (raw: string): string => colorNames.get(fold(raw)) ?? displayLabel(raw);

export const colorHex = (raw: string): string => swatches.get(fold(raw)) ?? NEUTRAL_SWATCH;

export type CategoryIcon = 'shirt' | 'outerwear' | 'pants' | 'dress' | 'shoe' | 'bag' | 'hat' | 'accessory';
const CATEGORY_ICONS: Record<string, CategoryIcon> = {
  ceket: 'outerwear', blazer: 'outerwear', mont: 'outerwear', kaban: 'outerwear', trenckot: 'outerwear', hirka: 'outerwear',
  pantolon: 'pants', jean: 'pants', kargo: 'pants', esofman: 'pants', sort: 'pants', etek: 'pants', 'alt giyim': 'pants',
  elbise: 'dress', dresses: 'dress',
  'upper body': 'shirt', 'lower body': 'pants', shoes: 'shoe', bags: 'bag', hats: 'hat', accessories: 'accessory',
  sneaker: 'shoe', bot: 'shoe', topuklu: 'shoe', sandalet: 'shoe', loafer: 'shoe', babet: 'shoe', ayakkabi: 'shoe',
  canta: 'bag', sapka: 'hat', bere: 'hat',
  kemer: 'accessory', atki: 'accessory', gozluk: 'accessory', taki: 'accessory', saat: 'accessory', aksesuar: 'accessory',
};
export const categoryIcon = (raw: string): CategoryIcon => CATEGORY_ICONS[fold(raw)] ?? 'shirt';

export type FitShape = 'slim' | 'regular' | 'relaxed' | 'oversized';
const FIT_SHAPES: readonly FitShape[] = ['slim', 'regular', 'relaxed', 'oversized'];
export const fitShape = (raw: string): FitShape | null => FIT_SHAPES.find(shape => shape === fold(raw)) ?? null;

export const PRICE_BANDS = ['low', 'mid', 'high', 'luxury'] as const;
export const priceBandIndex = (raw: string): number => PRICE_BANDS.findIndex(band => band === fold(raw));

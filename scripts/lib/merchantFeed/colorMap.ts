import { COLOR_ALIASES } from '../../../lib/productAttributes';

export interface FeedColorResult {
  slugs: string[];
  /** Lowercased color parts with no known slug; reported, never guessed. */
  unmapped: string[];
}

const fold = (value: string): string =>
  value.trim().toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').replace(/\s+/g, ' ');

const SLUG_BY_KEY = new Map<string, string>();
for (const alias of COLOR_ALIASES) {
  for (const key of alias.keys) SLUG_BY_KEY.set(fold(key), alias.slug);
}
// Feed-only spellings; the slugs themselves stay the existing vocabulary.
const EXTRA_PHRASES: ReadonlyArray<readonly [string, string]> = [
  ['navy blue', 'navy'],
  ['khaki', 'yesil'],
  ['off white', 'bej'],
];
for (const [phrase, slug] of EXTRA_PHRASES) SLUG_BY_KEY.set(phrase, slug);

/** Shade words that do not change the base color ("Açık Mavi", "Dark Grey"). */
const SHADE_MODIFIERS = new Set([
  'acik', 'açik', 'koyu', 'light', 'dark', 'pastel', 'neon', 'soft', 'bright', 'canli', 'canlı',
]);

const PART_SEPARATOR = /\s*(?:[/,;&|+]|\sve\s|\sand\s)\s*/;

const mapPart = (part: string): string | null => {
  const direct = SLUG_BY_KEY.get(part);
  if (direct) return direct;
  const tokens = part.split(' ');
  if (tokens.length < 2) return null;
  const rest = tokens.filter((token) => !SHADE_MODIFIERS.has(token));
  if (rest.length === tokens.length || rest.length === 0) return null;
  return SLUG_BY_KEY.get(rest.join(' ')) ?? null;
};

export const mapFeedColors = (raw: string): FeedColorResult => {
  const slugs: string[] = [];
  const unmapped: string[] = [];
  for (const piece of raw.split(PART_SEPARATOR)) {
    const part = fold(piece);
    if (part.length === 0) continue;
    const slug = mapPart(part);
    if (slug === null) {
      const display = piece.trim().toLocaleLowerCase('tr-TR');
      if (!unmapped.includes(display)) unmapped.push(display);
    } else if (!slugs.includes(slug)) {
      slugs.push(slug);
    }
  }
  return { slugs, unmapped };
};

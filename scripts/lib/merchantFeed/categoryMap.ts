import { GOOGLE_TAXONOMY_IDS } from './googleTaxonomy';
import type { GarmentCategory, OutfitRole } from '../../../types/product';

export interface CategoryInput {
  /** g:google_product_category: numeric id, or a ">" separated text path. */
  googleCategory: string;
  /** g:product_type values: ">" separated paths in the merchant's own language. */
  productTypes: readonly string[];
}

export type CategoryRejectReason = 'unmapped_category' | 'unsupported_category' | 'category_conflict';

export type CategoryDecision =
  | { ok: true; category: GarmentCategory; subcategory: string | null; outfitRole: OutfitRole }
  | { ok: false; reason: CategoryRejectReason; key: string };

interface Rule {
  /** Folded keys: single words match whole (plus plural suffix) or by prefix when 5+ letters; phrases match as word sequences. */
  keys: readonly string[];
  category: GarmentCategory;
  /** Existing subcategory slug, or null when the path only says "tops"/"bottoms" (title rules may refine it). */
  subcategory: string | null;
  role: OutfitRole;
}

type Excluded = { excluded: true; keys: readonly string[] };

const top = (subcategory: string | null, ...keys: string[]): Rule =>
  ({ keys, category: 'upper_body', subcategory, role: 'top' });
const outer = (subcategory: string | null, ...keys: string[]): Rule =>
  ({ keys, category: 'upper_body', subcategory, role: 'outerwear' });
const bottom = (subcategory: string | null, ...keys: string[]): Rule =>
  ({ keys, category: 'lower_body', subcategory, role: 'bottom' });

/** Not catalog garments for this app; rejected as unsupported, never mapped by guess. */
const EXCLUDED: Excluded = {
  excluded: true,
  keys: [
    'bikini', 'mayo', 'swimwear', 'swimsuit', 'plaj', 'ic giyim', 'underwear', 'lingerie', 'sutyen', 'bra',
    'pijama', 'pajama', 'gecelik', 'corap', 'sock', 'boxer', 'panties', 'bebek', 'baby',
  ],
};

// Order matters: the first rule that matches a path segment wins.
const RULES: readonly (Rule | Excluded)[] = [
  EXCLUDED,
  { keys: ['tulum', 'jumpsuit', 'romper', 'salopet'], category: 'dresses', subcategory: null, role: 'one_piece' },
  { keys: ['elbise', 'dress'], category: 'dresses', subcategory: 'elbise', role: 'one_piece' },
  top(null, 'shirts tops', 'shirts and tops', 'tops', 'top', 'ust giyim', 'atlet', 'tank', 'camisole', 'tunik'),
  top('tisort', 't shirt', 'tshirt', 'tisort', 'tee'),
  top('polo', 'polo'),
  top('sweatshirt', 'sweatshirt', 'sweatshirts'),
  top('hoodie', 'hoodie', 'kapuson'),
  top('kazak', 'kazak', 'suveter', 'sweater', 'jumper', 'triko', 'knitwear'),
  top('bluz', 'bluz', 'blouse'),
  top('body', 'body', 'bodysuit'),
  top('gomlek', 'gomlek', 'shirt'),
  outer('hirka', 'hirka', 'cardigan'),
  outer('blazer', 'blazer', 'kruvaze'),
  outer('trenckot', 'trenckot', 'trench'),
  outer('kaban', 'kaban', 'palto', 'coat'),
  outer('mont', 'mont', 'parka', 'puffer', 'sisme mont'),
  outer('ceket', 'ceket', 'jacket'),
  outer(null, 'dis giyim', 'outerwear', 'coats jackets', 'coats and jackets'),
  bottom('jean', 'jean', 'kot', 'denim'),
  bottom('kargo', 'kargo', 'cargo'),
  bottom('esofman', 'esofman', 'jogger', 'sweatpants', 'sweat pants'),
  bottom('sort', 'sort', 'shorts'),
  bottom('etek', 'etek', 'skirt'),
  bottom('pantolon', 'pantolon', 'pants', 'trousers'),
  bottom(null, 'alt giyim', 'bottoms', 'tayt', 'legging', 'tozluk'),
  { keys: ['ayakkabi', 'shoe', 'sneaker', 'bot', 'boot', 'sandalet', 'sandal', 'terlik', 'babet', 'loafer', 'topuklu', 'oxford', 'footwear'], category: 'shoes', subcategory: 'ayakkabi', role: 'shoes' },
  { keys: ['canta', 'bag', 'handbag', 'backpack', 'tote', 'clutch'], category: 'bags', subcategory: 'canta', role: 'bag' },
  { keys: ['sapka', 'hat', 'cap', 'bere', 'beanie', 'bucket'], category: 'hats', subcategory: 'sapka', role: 'hat' },
  { keys: ['gozluk', 'sunglasses', 'eyewear'], category: 'accessories', subcategory: 'gozluk', role: 'accessory' },
  { keys: ['aksesuar', 'accessories', 'kemer', 'belt', 'atki', 'scarf', 'sal', 'kolye', 'necklace', 'kupe', 'earring', 'bileklik', 'bracelet', 'yuzuk', 'saat', 'watch', 'eldiven', 'glove', 'cuzdan', 'wallet'], category: 'accessories', subcategory: 'aksesuar', role: 'accessory' },
];

export const foldText = (value: string): string =>
  value
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const SUFFIXES = ['s', 'es', 'lar', 'ler', 'i', 'si', 'lari', 'leri'];

const tokenMatches = (token: string, key: string): boolean =>
  token === key
  || SUFFIXES.some((suffix) => token === key + suffix)
  || (key.length >= 5 && token.startsWith(key));

const keyMatches = (tokens: readonly string[], key: string): boolean => {
  const parts = key.split(' ');
  if (parts.length === 1) return tokens.some((token) => tokenMatches(token, key));
  for (let start = 0; start + parts.length <= tokens.length; start++) {
    if (parts.every((part, offset) => tokenMatches(tokens[start + offset], part))) return true;
  }
  return false;
};

type SegmentMatch = Rule | Excluded | null;

const matchSegment = (segment: string): SegmentMatch => {
  const tokens = foldText(segment).split(' ').filter((token) => token.length > 0);
  for (const rule of RULES) {
    if (rule.keys.some((key) => keyMatches(tokens, key))) return rule;
  }
  return null;
};

interface PathDecision {
  match: Rule | Excluded | null;
  /** Folded leaf text, used as the report key when nothing matched. */
  leaf: string;
}

/** Leaf first: the most specific segment that matches decides; parents only fill in when the leaf says nothing. */
const decidePath = (path: string): PathDecision => {
  const segments = path.split('>').map((segment) => segment.trim()).filter((segment) => segment.length > 0);
  for (let index = segments.length - 1; index >= 0; index--) {
    const match = matchSegment(segments[index]);
    if (match) return { match, leaf: foldText(segments[index]) };
  }
  return { match: null, leaf: foldText(segments[segments.length - 1] ?? '') };
};

const isExcluded = (match: Rule | Excluded): match is Excluded => 'excluded' in match;

export const mapFeedCategory = (input: CategoryInput): CategoryDecision => {
  const google = input.googleCategory.trim().replace(/^(\d+)\s*-.*$/, '$1');
  const googlePath = GOOGLE_TAXONOMY_IDS[google] ?? (/^\d+$/.test(google) ? '' : google);
  const sources = [
    ...input.productTypes.map((path) => decidePath(path)),
    decidePath(googlePath),
  ];
  const matches = sources.filter((source): source is PathDecision & { match: Rule | Excluded } => source.match !== null);

  if (matches.length === 0) {
    // Report the leaf of the first non-empty path, or the raw id when only an unknown id was given.
    const firstPath = input.productTypes.find((path) => path.trim().length > 0) ?? googlePath;
    const leaf = firstPath.split('>').pop() ?? '';
    return { ok: false, reason: 'unmapped_category', key: foldText(leaf.length > 0 ? leaf : google) };
  }
  const excluded = matches.find((source) => isExcluded(source.match));
  if (excluded) return { ok: false, reason: 'unsupported_category', key: excluded.leaf };

  const rules = matches.map((source) => source.match as Rule);
  const [first] = rules;
  if (rules.some((rule) => rule.category !== first.category || rule.role !== first.role)) {
    return { ok: false, reason: 'category_conflict', key: matches.map((source) => source.leaf).join(' | ') };
  }
  const subcategories = [...new Set(rules.map((rule) => rule.subcategory).filter((value): value is string => value !== null))];
  if (subcategories.length > 1) {
    return { ok: false, reason: 'category_conflict', key: matches.map((source) => source.leaf).join(' | ') };
  }
  return { ok: true, category: first.category, subcategory: subcategories[0] ?? null, outfitRole: first.role };
};

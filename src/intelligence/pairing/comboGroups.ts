/**
 * Combo groups: coarse sub-groups of shoes, bags, hats and accessories (plus the few garment classes the
 * pair table needs), read from the title. The stored subcategory of these categories is a single value
 * (ayakkabi, canta, sapka, aksesuar), so the title is the only evidence. A product whose group cannot be
 * proven is `null`; `null` never blocks and never penalises. Edge-compatible: no imports.
 */

export type ComboGroup =
  | 'boot_heeled' | 'boot_flat' | 'boot_outdoor'
  | 'shoe_athletic' | 'shoe_sneaker' | 'shoe_classic' | 'shoe_heel' | 'shoe_sandal' | 'shoe_flat' | 'shoe_casual_other'
  | 'bag_work' | 'bag_backpack' | 'bag_sport' | 'bag_evening' | 'bag_handbag'
  | 'hat_straw' | 'hat_beanie' | 'hat_cap'
  | 'acc_belt' | 'acc_jewelry_formal' | 'acc_jewelry' | 'acc_scarf' | 'acc_sunglasses'
  | 'bt_sport' | 'bt_short' | 'bt_skirt' | 'bt_relaxed'
  | 'ow_blazer' | 'ow_puffer' | 'ow_coat'
  | 'tp_sport' | 'dress_formal';

export type ComboRelation = 'hard' | 'weak' | 'ok';

/** The catalog fields the classifier reads; app Products satisfy it structurally. */
export interface ComboGroupInput {
  title: string;
  category: string;
  subcategory?: string | null;
}

// Lower-case in Turkish, then fold to ASCII so "KOŞU", "koşu" and "kosu" match one pattern.
const fold = (value: string): string => value.toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
  .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c');

const classifyShoe = (t: string): ComboGroup | null => {
  if (/\b(bot|botu|bootie|cizme)\b/.test(t)) {
    if (/topuklu/.test(t)) return 'boot_heeled';
    if (/outdoor|su gecirmez|kar |polarli|trekking|kislik/.test(t)) return 'boot_outdoor';
    return 'boot_flat';
  }
  if (/kosu|running|basketbol|futbol|antrenman|training/.test(t)) return 'shoe_athletic';
  // "gizli topuklu babet" is a flat, so babet is read before topuklu.
  if (/babet/.test(t)) return 'shoe_flat';
  if (/topuklu|stiletto|\bpump\b|abiye|iskarpin/.test(t)) return 'shoe_heel';
  if (/sneaker|spor ayakkabi|bez ayakkabi|keten bez/.test(t)) return 'shoe_sneaker';
  if (/klasik|oxford|derby|mokasen|loafer|comfort ayakkabi/.test(t)) return 'shoe_classic';
  if (/sandalet|terlik|espadril|slip|plaj/.test(t)) return 'shoe_sandal';
  if (/casual|gunluk|ortopedik/.test(t)) return 'shoe_casual_other';
  return null;
};

const classifyBag = (t: string): ComboGroup | null => {
  if (/laptop|evrak|briefcase/.test(t) && !/sirt/.test(t)) return 'bag_work';
  if (/sirt cantasi|backpack/.test(t)) return 'bag_backpack';
  if (/spor canta|gogus|bel cantasi|\bbel\b|fanny|duffle/.test(t)) return 'bag_sport';
  if (/clutch|abiye|baget/.test(t)) return 'bag_evening';
  if (/canta/.test(t)) return 'bag_handbag';
  return null;
};

const classifyHat = (t: string): ComboGroup | null => {
  if (/hasir|straw/.test(t)) return 'hat_straw';
  if (/bere|orgu sapka|kislik/.test(t)) return 'hat_beanie';
  if (/\bcap\b|kep\b|siperli|snapback|beyzbol/.test(t)) return 'hat_cap';
  return null; // a plain "Şapka" may be a cap, a bucket hat or anything else
};

const classifyAccessory = (t: string): ComboGroup | null => {
  if (/kemer/.test(t)) return 'acc_belt';
  if (/inci|gelin|dugun|nisan/.test(t)) return 'acc_jewelry_formal';
  if (/kolye|kupe|bileklik|yuzuk|takim set|\btaki\b/.test(t)) return 'acc_jewelry';
  if (/atki|sal\b|bandana|esarp/.test(t)) return 'acc_scarf';
  if (/gozluk/.test(t)) return 'acc_sunglasses';
  return null;
};

const classifyLower = (t: string, subcategory: string): ComboGroup | null => {
  if (/esofman|jogger|sporcu|tayt|spor /.test(t)) return 'bt_sport';
  if (subcategory === 'sort' || /\bsort\b|\bshort\b|bermuda/.test(t)) return /sort etek/.test(t) ? 'bt_skirt' : 'bt_short';
  if (subcategory === 'etek') return 'bt_skirt';
  if (/balon|beli lastikli|lastikli/.test(t)) return 'bt_relaxed';
  return null;
};

const classifyUpper = (t: string): ComboGroup | null => {
  if (/blazer|kruvaze|takim elbise|smokin/.test(t)) return 'ow_blazer';
  if (/\bmont\b|montu|sisme|kapitone|kayak|parka/.test(t)) return 'ow_puffer';
  if (/kaban|palto|trenc|trench/.test(t)) return 'ow_coat';
  if (/hoodie|sweatshirt|kapuson/.test(t)) return 'tp_sport';
  return null;
};

const classify = (product: ComboGroupInput): ComboGroup | null => {
  const t = fold(product.title);
  switch (product.category) {
    case 'shoes': return classifyShoe(t);
    case 'bags': return classifyBag(t);
    case 'hats': return classifyHat(t);
    case 'accessories': return classifyAccessory(t);
    case 'lower_body': return classifyLower(t, product.subcategory ? fold(product.subcategory) : '');
    case 'upper_body': return classifyUpper(t);
    case 'dresses': return /abiye|gece|davet|dugun/.test(t) ? 'dress_formal' : null;
    default: return null;
  }
};

const grouped = new WeakMap<object, { title: string; category: string; subcategory: string | null | undefined;
  group: ComboGroup | null }>();

/** Memoized per product object; rechecked against the raw fields so in-place edits are seen. */
export const comboGroupOf = (product: ComboGroupInput): ComboGroup | null => {
  const cached = grouped.get(product);
  if (cached && cached.title === product.title && cached.category === product.category
    && cached.subcategory === product.subcategory) return cached.group;
  const group = classify(product);
  grouped.set(product, { title: product.title, category: product.category, subcategory: product.subcategory, group });
  return group;
};

// Explicit contradictions only: a clearly sporty item against a clearly dressy one, dressy shoes against
// shorts, a sneaker against wedding/pearl jewelry, and summer-only against winter-only items.
const SPORT: ReadonlySet<ComboGroup> = new Set(['shoe_athletic', 'hat_cap', 'bag_sport', 'bt_sport']);
const DRESSY: ReadonlySet<ComboGroup> = new Set(['shoe_classic', 'shoe_heel', 'acc_jewelry_formal', 'ow_blazer', 'dress_formal']);
const WARM_ONLY: ReadonlySet<ComboGroup> = new Set(['shoe_sandal', 'hat_straw']);
const COLD_ONLY: ReadonlySet<ComboGroup> = new Set(['ow_puffer', 'ow_coat', 'hat_beanie', 'acc_scarf', 'boot_outdoor']);
const DRESSY_SHOES: ReadonlySet<ComboGroup> = new Set(['shoe_classic', 'shoe_heel']);
const CASUAL_SIDE: ReadonlySet<ComboGroup> = new Set(['shoe_sneaker', 'bag_backpack', 'hat_cap', 'bt_relaxed', 'tp_sport', 'bt_short']);
const RELAXED_SIDE: ReadonlySet<ComboGroup> = new Set(['bag_backpack', 'bt_relaxed', 'tp_sport']);
const COLD_SIDE: ReadonlySet<ComboGroup> = new Set(['hat_beanie', 'acc_scarf', 'ow_puffer']);

const between = (a: ComboGroup, b: ComboGroup, left: ReadonlySet<ComboGroup>, right: ReadonlySet<ComboGroup>): boolean =>
  (left.has(a) && right.has(b)) || (left.has(b) && right.has(a));
const pairOf = (a: ComboGroup, b: ComboGroup, x: ComboGroup, y: ComboGroup): boolean =>
  (a === x && b === y) || (a === y && b === x);

/** Symmetric. A missing group is never a contradiction and never evidence of compatibility. */
export const comboRelation = (a: ComboGroup | null, b: ComboGroup | null): ComboRelation => {
  if (a === null || b === null) return 'ok';
  if (between(a, b, SPORT, DRESSY)) return 'hard';
  if (pairOf(a, b, 'shoe_sneaker', 'acc_jewelry_formal')) return 'hard';
  if (between(a, b, DRESSY_SHOES, new Set<ComboGroup>(['bt_short']))) return 'hard';
  if (between(a, b, WARM_ONLY, COLD_ONLY)) return 'hard';
  if (between(a, b, CASUAL_SIDE, DRESSY)) return 'weak';
  if (between(a, b, DRESSY_SHOES, RELAXED_SIDE)) return 'weak';
  if (between(a, b, COLD_SIDE, new Set<ComboGroup>(['bt_short']))) return 'weak';
  if (between(a, b, new Set<ComboGroup>(['shoe_sandal']), new Set<ComboGroup>(['acc_jewelry_formal', 'ow_blazer']))) return 'weak';
  return 'ok';
};

export const productComboRelation = (a: ComboGroupInput, b: ComboGroupInput): ComboRelation =>
  comboRelation(comboGroupOf(a), comboGroupOf(b));

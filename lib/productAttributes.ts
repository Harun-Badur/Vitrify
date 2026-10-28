import { normalizedRecommendationToken } from './recommendationMemo';

// Exact raw-string key and the existing bounded cache preserve Turkish casing,
// whitespace and missing evidence while avoiding repeated ICU work on Android.
const lowerTurkish = (value: string): string => normalizedRecommendationToken(value, false,
  () => value.toLocaleLowerCase('tr-TR'));

export const FIT_VOCAB = ['oversized', 'relaxed', 'regular', 'slim'] as const;

export type FitSlug = (typeof FIT_VOCAB)[number];

export const PRICE_BANDS = ['low', 'mid', 'high', 'luxury'] as const;

export type PriceBand = (typeof PRICE_BANDS)[number];

export type ProductGender = 'women' | 'men' | 'unisex';

export interface InferredProductAttributes {
  gender: ProductGender | undefined;
  colors: string[];
  fit: FitSlug | '';
  /** undefined = no title or category evidence; never a guessed default. */
  subcategory: string | undefined;
  brand_slug: string;
  price_band: PriceBand;
}

export interface ProductAttributeSeedInput {
  title: string;
  brand: string | null;
  price: number;
  category: string;
  existingColorNames?: string[];
}

export interface ColorAlias {
  slug: string;
  keys: readonly string[];
}

/** Kanonik renk sözlüğü (~20). Skorlama bu slug'ları bekler. */
export const COLOR_ALIASES: readonly ColorAlias[] = [
  { slug: 'siyah', keys: ['siyah', 'black'] },
  { slug: 'beyaz', keys: ['beyaz', 'white'] },
  { slug: 'gri', keys: ['gri', 'grey', 'gray', 'antrasit', 'anthracite'] },
  { slug: 'bej', keys: ['bej', 'beige', 'krem', 'ekru', 'ivory'] },
  { slug: 'kahverengi', keys: ['kahverengi', 'kahve', 'brown'] },
  { slug: 'navy', keys: ['navy', 'lacivert', 'indigo'] },
  { slug: 'mavi', keys: ['mavi', 'blue'] },
  { slug: 'kirmizi', keys: ['kırmızı', 'kirmizi', 'red'] },
  { slug: 'pembe', keys: ['pembe', 'pink', 'fuşya', 'fusya'] },
  { slug: 'yesil', keys: ['yeşil', 'yesil', 'green', 'haki', 'olive'] },
  { slug: 'sari', keys: ['sarı', 'sari', 'yellow', 'hardal'] },
  { slug: 'turuncu', keys: ['turuncu', 'orange'] },
  { slug: 'mor', keys: ['mor', 'purple', 'lila', 'violet'] },
  { slug: 'bordo', keys: ['bordo', 'burgundy', 'maroon'] },
  { slug: 'camel', keys: ['camel', 'camel rengi'] },
  { slug: 'altin', keys: ['altın', 'altin', 'gold'] },
  { slug: 'gumus', keys: ['gümüş', 'gumus', 'silver'] },
  { slug: 'turkuaz', keys: ['turkuaz', 'teal'] },
  { slug: 'krem', keys: ['cream'] },
];

// Precompile alias normalization once, outside catalog preparation and ranking.
const COLOR_TOKEN_RULES = COLOR_ALIASES.map(alias => ({
  slug: alias.slug,
  keys: alias.keys.map(key => lowerTurkish(key).replace(/ı/g, 'i')),
}));

interface SubcategoryRule {
  slug: string;
  keys: readonly string[];
}

const SUBCATEGORY_RULES: readonly SubcategoryRule[] = [
  // A suit (takım elbise) is a blazer set, not a dress: try the phrase before the bare 'elbise' key.
  { slug: 'blazer', keys: ['takım elbise', 'takim elbise'] },
  { slug: 'elbise', keys: ['elbise', 'dress', 'midi elbise'] },
  { slug: 'blazer', keys: ['blazer', 'kruvaze'] },
  { slug: 'ceket', keys: ['ceket', 'jacket', 'mont', 'kaban', 'trençkot', 'trenckot', 'trench'] },
  { slug: 'hoodie', keys: ['hoodie', 'kapüşon', 'kapuson'] },
  { slug: 'sweatshirt', keys: ['sweatshirt', 'sweat'] },
  { slug: 'kazak', keys: ['kazak', 'süveter', 'suveter'] },
  { slug: 'hirka', keys: ['hırka', 'hirka', 'cardigan'] },
  { slug: 'gomlek', keys: ['gömlek', 'gomlek', 'shirt'] },
  { slug: 'polo', keys: ['polo'] },
  { slug: 'tisort', keys: ['tişört', 'tisort', 't-shirt', 'tshirt', 't shirt'] },
  { slug: 'jean', keys: ['jean', 'kot', 'denim'] },
  { slug: 'kargo', keys: ['kargo', 'cargo'] },
  { slug: 'esofman', keys: ['eşofman', 'esofman', 'jogger'] },
  { slug: 'sort', keys: ['şort', 'sort', 'short'] },
  { slug: 'etek', keys: ['etek', 'skirt'] },
  { slug: 'pantolon', keys: ['pantolon', 'pants', 'trousers'] },
  { slug: 'pareo', keys: ['pareo'] },
];

const GENDER_MEN_TOKENS = ['erkek', 'oğlan', 'oglan'] as const;
const GENDER_WOMEN_TOKENS = ['kadın', 'kadin', 'kız', 'kiz'] as const;

const PRICE_BAND_LOW_MAX = 499.99;
const PRICE_BAND_MID_MAX = 1499.99;
const PRICE_BAND_HIGH_MAX = 2999.99;

export const slugify = (value: string): string =>
  lowerTurkish(value.trim())
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const normalizeTitleKey = (title: string): string =>
  lowerTurkish(title.trim());

const haystackOf = (title: string): string => lowerTurkish(title);

const titleHasToken = (haystack: string, token: string): boolean => {
  const needle = lowerTurkish(token);
  const start = haystack.indexOf(needle);
  if (start < 0) {
    return false;
  }
  const before = start === 0 ? '' : haystack[start - 1];
  const afterIndex = start + needle.length;
  const after = afterIndex >= haystack.length ? '' : haystack[afterIndex];
  const isBoundary = (char: string): boolean =>
    char.length === 0 || /[^a-z0-9ğüşöçı]/i.test(char);
  return isBoundary(before ?? '') && isBoundary(after ?? '');
};

export const inferGenderFromTitle = (title: string): ProductGender | undefined => {
  const haystack = haystackOf(title);
  if (GENDER_MEN_TOKENS.some((token) => titleHasToken(haystack, token))) {
    return 'men';
  }
  if (GENDER_WOMEN_TOKENS.some((token) => titleHasToken(haystack, token))) {
    return 'women';
  }
  if (['unisex', 'uniseks'].some(token => titleHasToken(haystack, token))) return 'unisex';
  return undefined;
};

/** Exact Unicode words only; patterns and brand tokens are not color evidence. */
export const inferColorsFromText = (text: string, brand?: string | null): string[] => {
  const tokens = haystackOf(text).replace(/ı/g, 'i').match(/[\p{L}\p{N}]+/gu) ?? [];
  const brandTokens = brand ? haystackOf(brand).replace(/ı/g, 'i').match(/[\p{L}\p{N}]+/gu) ?? [] : [];
  const words = new Set<string>();
  for (let index = 0; index < tokens.length; index++) {
    if (brandTokens.length > 0 && brandTokens.every((token, offset) => tokens[index + offset] === token)) {
      index += brandTokens.length - 1;
    } else words.add(tokens[index]);
  }
  const slugs: string[] = [];
  for (const alias of COLOR_TOKEN_RULES) {
    if (alias.keys.some(key => words.has(key))) slugs.push(alias.slug);
  }
  return slugs;
};

export const inferFitFromTitle = (title: string): FitSlug | '' => {
  const haystack = haystackOf(title);
  if (
    haystack.includes('oversize') ||
    haystack.includes('bol kesim') ||
    haystack.includes('over-size')
  ) {
    return 'oversized';
  }
  if (
    haystack.includes('slim') ||
    haystack.includes('dar kesim') ||
    haystack.includes('skinny')
  ) {
    return 'slim';
  }
  if (
    haystack.includes('relaxed') ||
    haystack.includes('comfort') ||
    haystack.includes('rahat kalıp') ||
    haystack.includes('rahat kalip')
  ) {
    return 'relaxed';
  }
  if (haystack.includes('regular')) {
    return 'regular';
  }
  return '';
};

// Categories whose titles mention garments only as a use ("Kot Pantolon Kemeri").
const NON_GARMENT_CATEGORIES = ['shoes', 'bags', 'hats', 'accessories'];
const NON_GARMENT_SUBCATEGORY_SLUGS = ['pareo'];

const isWordChar = (char: string | undefined): boolean =>
  char !== undefined && /[\p{L}\p{N}]/u.test(char);

// Keys match only at the start of a word, so suffixes ("pantolonu", "kapüşonlu")
// still match but embedded fragments ("trençkot" -> "kot") do not.
const startsAWord = (haystack: string, key: string): boolean => {
  for (let from = haystack.indexOf(key); from >= 0; from = haystack.indexOf(key, from + 1)) {
    if (!isWordChar(haystack[from - 1])) return true;
  }
  return false;
};

const SUBCATEGORY_KEYS = SUBCATEGORY_RULES.map(rule => ({
  slug: rule.slug,
  keys: rule.keys.map(key => lowerTurkish(key)),
}));

/**
 * Title keyword evidence only; `''` means no keyword matched. Pass `category` so
 * garment words in accessory/shoe/bag titles are not read as the product type.
 */
export const matchSubcategoryFromTitle = (title: string, category?: string): string => {
  // "t-shirt" would otherwise be split into "t" + "shirt" (a shirt keyword).
  const haystack = haystackOf(title).replace(/(^|[^\p{L}\p{N}])t[-\s]?shirt/gu, '$1tshirt');
  const restricted = category !== undefined && NON_GARMENT_CATEGORIES.includes(category);
  for (const rule of SUBCATEGORY_KEYS) {
    if (restricted && !NON_GARMENT_SUBCATEGORY_SLUGS.includes(rule.slug)) continue;
    if (rule.keys.some((key) => startsAWord(haystack, key))) {
      return rule.slug;
    }
  }
  return '';
};

/** `undefined` = unknown: an upper_body title without a type keyword is not guessed. */
export const inferSubcategory = (title: string, category: string): string | undefined => {
  const matched = matchSubcategoryFromTitle(title, category);
  if (matched) {
    return matched;
  }
  if (category === 'dresses') {
    return 'elbise';
  }
  if (category === 'lower_body') {
    return 'pantolon';
  }
  if (category === 'shoes') {
    return 'ayakkabi';
  }
  if (category === 'bags') {
    return 'canta';
  }
  if (category === 'hats') {
    return 'sapka';
  }
  if (category === 'accessories') {
    return 'aksesuar';
  }
  return undefined;
};

export type GenderLabel = 'kadin' | 'erkek' | 'cocuk' | 'unisex' | 'bilinmiyor';

export interface GenderInference {
  gender: GenderLabel;
  /** none = unknown; medium = URL path only; high = title word. */
  confidence: 'high' | 'medium' | 'none';
  /** title_token | title_child_token | title_conflict | url_token | url_conflict | none */
  rule: string;
  /** The matched word, or '' when unknown. */
  key: string;
}

const GENDER_TOKEN_LABELS: ReadonlyArray<readonly [GenderLabel, readonly string[]]> = [
  ['kadin', ['kadın', 'kadin', 'bayan']],
  ['erkek', ['erkek']],
  ['unisex', ['unisex', 'uniseks']],
];
const CHILD_TOKENS = ['çocuk', 'cocuk', 'bebek'] as const;
// Child-only words: they say "child" but not which gender.
const CHILD_IMPLIED_TOKENS = ['kız', 'kiz', 'oğlan', 'oglan'] as const;

const wordsOf = (text: string): string[] =>
  lowerTurkish(text).match(/[\p{L}\p{N}]+/gu) ?? [];

const genderFromWords = (words: string[], rulePrefix: 'title' | 'url'): GenderInference | undefined => {
  const present = new Set(words);
  const child = [...CHILD_TOKENS, ...CHILD_IMPLIED_TOKENS].find(token => present.has(token));
  const hits = GENDER_TOKEN_LABELS.flatMap(([gender, tokens]) => {
    const key = tokens.find(token => present.has(token));
    return key ? [{ gender, key }] : [];
  });
  if (child) {
    return { gender: 'cocuk', confidence: rulePrefix === 'title' ? 'high' : 'medium',
      rule: `${rulePrefix}_child_token`, key: child };
  }
  if (hits.length > 1) {
    return { gender: 'bilinmiyor', confidence: 'none', rule: `${rulePrefix}_conflict`, key: '' };
  }
  if (hits.length === 1) {
    return { gender: hits[0].gender, confidence: rulePrefix === 'title' ? 'high' : 'medium',
      rule: `${rulePrefix}_token`, key: hits[0].key };
  }
  return undefined;
};

/**
 * Pure gender evidence from whole words in the title, then (title silent only) the
 * product URL path. Ambiguous or conflicting evidence is 'bilinmiyor', never a guess.
 */
export const inferGenderDetail = (
  title: string,
  productUrl?: string | null,
  category?: string,
): GenderInference => {
  const base = inferGenderEvidence(title, productUrl);
  if (category !== 'dresses') return base;
  // Dresses are sold as womenswear; a men's word on one is contradictory, so stay unknown.
  if (base.gender === 'erkek') {
    return { gender: 'bilinmiyor', confidence: 'none', rule: 'dress_conflict', key: base.key };
  }
  if (base.rule === 'none') return { gender: 'kadin', confidence: 'medium', rule: 'dress_default', key: '' };
  return base;
};

const inferGenderEvidence = (title: string, productUrl?: string | null): GenderInference => {
  const fromTitle = genderFromWords(wordsOf(title), 'title');
  if (fromTitle) return fromTitle;
  if (productUrl) {
    try {
      const fromUrl = genderFromWords(wordsOf(decodeURIComponent(new URL(productUrl).pathname)), 'url');
      if (fromUrl) return fromUrl;
    } catch {
      // Malformed URL: no URL evidence.
    }
  }
  return { gender: 'bilinmiyor', confidence: 'none', rule: 'none', key: '' };
};

export const inferPriceBand = (price: number): PriceBand => {
  if (price <= PRICE_BAND_LOW_MAX) {
    return 'low';
  }
  if (price <= PRICE_BAND_MID_MAX) {
    return 'mid';
  }
  if (price <= PRICE_BAND_HIGH_MAX) {
    return 'high';
  }
  return 'luxury';
};

export const uniqueSlugs = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const slug = slugify(value);
    if (slug.length === 0 || seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    result.push(slug);
  }
  return result;
};

/**
 * seedRealCatalog.ts CATALOG başlıkları — heuristic'i net vakalarda ezer.
 * Yeni ürünler title heuristic ile düşer.
 */
export const CURATED_ATTRIBUTE_OVERRIDES: Record<
  string,
  Partial<Pick<InferredProductAttributes, 'colors' | 'fit' | 'subcategory' | 'gender'>>
> = {
  [normalizeTitleKey('Keten Karışımlı Bol Kesim Pantolon')]: {
    fit: 'oversized',
    subcategory: 'pantolon',
  },
  [normalizeTitleKey('Kare Yaka Askılı Tişört')]: {
    subcategory: 'tisort',
    fit: 'regular',
  },
  [normalizeTitleKey('Kahverengi Drapeli Çiçek Aksesuarlı Midi Elbise')]: {
    colors: ['kahverengi'],
    subcategory: 'elbise',
    gender: 'women',
  },
  [normalizeTitleKey('Erkek Kahverengi Polo Yaka Tişört')]: {
    colors: ['kahverengi'],
    subcategory: 'polo',
    fit: 'slim',
    gender: 'men',
  },
  [normalizeTitleKey('Erkek Gri Keten Relaxed Fit Pantolon')]: {
    colors: ['gri'],
    subcategory: 'pantolon',
    fit: 'relaxed',
    gender: 'men',
  },
  [normalizeTitleKey('Gri Çizgili Kruvaze Takım Elbise')]: {
    colors: ['gri'],
    subcategory: 'blazer',
    fit: 'regular',
    gender: 'men',
  },
  [normalizeTitleKey('Slogan Baskılı Basic Beyaz T-Shirt')]: {
    colors: ['beyaz'],
    subcategory: 'tisort',
    fit: 'regular',
  },
  [normalizeTitleKey('Erkek İndigo Comfort Fit Bisiklet Yaka Tişört')]: {
    colors: ['navy'],
    subcategory: 'tisort',
    fit: 'relaxed',
    gender: 'men',
  },
  [normalizeTitleKey("Kahverengi ve Siyah Tül Pareo 2'li Set")]: {
    colors: ['kahverengi', 'siyah'],
    subcategory: 'pareo',
    gender: 'women',
  },
  [normalizeTitleKey('Firfirlı Transparan Şifon Pareo')]: {
    subcategory: 'pareo',
    gender: 'women',
  },
};

export const inferProductAttributes = (
  input: ProductAttributeSeedInput,
): InferredProductAttributes => {
  const titleKey = normalizeTitleKey(input.title);
  const curated = CURATED_ATTRIBUTE_OVERRIDES[titleKey];
  const fromTitle = inferColorsFromText(input.title, input.brand);
  const fromExisting = (input.existingColorNames ?? []).flatMap((name) =>
    inferColorsFromText(name),
  );

  return {
    gender: curated?.gender ?? inferGenderFromTitle(input.title),
    colors: uniqueSlugs(curated?.colors ?? [...fromExisting, ...fromTitle]),
    fit: curated?.fit ?? inferFitFromTitle(input.title),
    subcategory: curated?.subcategory ?? inferSubcategory(input.title, input.category),
    brand_slug: slugify(input.brand?.trim() || 'kabin'),
    price_band: inferPriceBand(input.price),
  };
};

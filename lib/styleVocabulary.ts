import type { GarmentCategory } from '../types/product';

/**
 * Shared wardrobe style vocabulary. Pure data plus small pure helpers.
 * Nothing imports this yet: catalog inference, scoring and outfit generation keep their own tables.
 */

export interface VocabularyColor {
  slug: string;
  label: string;
  /** null = no single swatch (multi-color); the UI draws its own marker. */
  hex: string | null;
  neutral: boolean;
}

// Neutral flags mirror NEUTRAL_COLORS in catalogCompatibility.ts.
export const COLORS: readonly VocabularyColor[] = [
  { slug: 'siyah', label: 'Siyah', hex: '#111111', neutral: true },
  { slug: 'beyaz', label: 'Beyaz', hex: '#FFFFFF', neutral: true },
  { slug: 'gri', label: 'Gri', hex: '#9CA3AF', neutral: true },
  { slug: 'krem', label: 'Krem', hex: '#F5EBD7', neutral: true },
  { slug: 'bej', label: 'Bej', hex: '#D8C3A5', neutral: true },
  { slug: 'kahverengi', label: 'Kahverengi', hex: '#6F4E37', neutral: false },
  { slug: 'navy', label: 'Lacivert', hex: '#1F2A44', neutral: true },
  { slug: 'mavi', label: 'Mavi', hex: '#2F6FDE', neutral: false },
  { slug: 'kirmizi', label: 'Kırmızı', hex: '#D32F2F', neutral: false },
  { slug: 'bordo', label: 'Bordo', hex: '#7B1E3A', neutral: false },
  { slug: 'pembe', label: 'Pembe', hex: '#F4A6C0', neutral: false },
  { slug: 'mor', label: 'Mor', hex: '#7E57C2', neutral: false },
  { slug: 'yesil', label: 'Yeşil', hex: '#2E7D32', neutral: false },
  { slug: 'sari', label: 'Sarı', hex: '#F6C945', neutral: false },
  { slug: 'turuncu', label: 'Turuncu', hex: '#F57C00', neutral: false },
  { slug: 'cok_renkli', label: 'Çok renkli', hex: null, neutral: false },
];

// Catalog slugs outside the palette keep their existing labels (see reasons.ts) so old data still reads.
const LEGACY_COLOR_LABELS: Readonly<Record<string, string>> = {
  camel: 'Camel',
  altin: 'Altın',
  gumus: 'Gümüş',
  turkuaz: 'Turkuaz',
  desenli: 'Desenli',
};

export const colorLabel = (slug: string): string =>
  COLORS.find(color => color.slug === slug)?.label ?? LEGACY_COLOR_LABELS[slug] ?? slug;

export const SUBTYPE_SLOTS = ['ust', 'alt', 'tek_parca', 'dis_giyim', 'ayakkabi', 'canta', 'sapka', 'aksesuar'] as const;
export const STYLE_FAMILIES = ['gunluk', 'klasik', 'spor', 'sokak', 'minimal'] as const;
export const SUBTYPE_SEASONS = ['sicak', 'soguk', 'tumu'] as const;

export type SubtypeSlot = (typeof SUBTYPE_SLOTS)[number];
export type StyleFamily = (typeof STYLE_FAMILIES)[number];
export type SubtypeSeason = (typeof SUBTYPE_SEASONS)[number];

export interface VocabularySubtype {
  slug: string;
  label: string;
  slot: SubtypeSlot;
  /** 1 = very casual, 5 = very formal. */
  formality: 1 | 2 | 3 | 4 | 5;
  family: StyleFamily;
  season: SubtypeSeason;
  /** Same class the outfit scorer reads today (STYLE_BY_SUBCATEGORY); null = unscored. */
  scorerStyle: 'casual' | 'tailored' | null;
}

const subtype = (
  slug: string, label: string, slot: SubtypeSlot, formality: VocabularySubtype['formality'],
  family: StyleFamily, season: SubtypeSeason, scorerStyle: VocabularySubtype['scorerStyle'] = null,
): VocabularySubtype => ({ slug, label, slot, formality, family, season, scorerStyle });

// 'diger' is the unknown bucket: neutral defaults, treated as "belirsiz" by compatibility.
export const SUBTYPES: Readonly<Record<GarmentCategory, readonly VocabularySubtype[]>> = {
  upper_body: [
    subtype('tisort', 'Tişört', 'ust', 1, 'gunluk', 'sicak', 'casual'),
    subtype('gomlek', 'Gömlek', 'ust', 3, 'klasik', 'tumu', 'tailored'),
    subtype('bluz', 'Bluz', 'ust', 3, 'klasik', 'tumu'),
    subtype('body', 'Body', 'ust', 2, 'minimal', 'tumu'),
    subtype('polo', 'Polo', 'ust', 2, 'gunluk', 'sicak', 'casual'),
    subtype('kazak', 'Kazak', 'ust', 2, 'minimal', 'soguk'),
    subtype('hirka', 'Hırka', 'dis_giyim', 2, 'minimal', 'soguk'),
    subtype('sweatshirt', 'Sweatshirt', 'ust', 1, 'spor', 'soguk', 'casual'),
    subtype('hoodie', 'Hoodie', 'ust', 1, 'sokak', 'soguk', 'casual'),
    subtype('ceket', 'Ceket', 'dis_giyim', 3, 'gunluk', 'tumu'),
    subtype('blazer', 'Blazer', 'dis_giyim', 4, 'klasik', 'tumu', 'tailored'),
    subtype('mont', 'Mont', 'dis_giyim', 2, 'gunluk', 'soguk'),
    subtype('kaban', 'Kaban', 'dis_giyim', 4, 'klasik', 'soguk'),
    subtype('trenckot', 'Trençkot', 'dis_giyim', 3, 'klasik', 'tumu'),
  ],
  dresses: [subtype('elbise', 'Elbise', 'tek_parca', 3, 'gunluk', 'tumu')],
  lower_body: [
    subtype('pantolon', 'Pantolon', 'alt', 3, 'klasik', 'tumu'),
    subtype('jean', 'Jean', 'alt', 2, 'gunluk', 'tumu', 'casual'),
    subtype('kargo', 'Kargo', 'alt', 1, 'sokak', 'tumu'),
    subtype('esofman', 'Eşofman', 'alt', 1, 'spor', 'tumu'),
    subtype('sort', 'Şort', 'alt', 1, 'gunluk', 'sicak', 'casual'),
    subtype('etek', 'Etek', 'alt', 3, 'klasik', 'tumu'),
  ],
  shoes: [
    subtype('sneaker', 'Sneaker', 'ayakkabi', 1, 'spor', 'tumu', 'casual'),
    subtype('bot', 'Bot', 'ayakkabi', 2, 'gunluk', 'soguk'),
    subtype('topuklu', 'Topuklu', 'ayakkabi', 4, 'klasik', 'tumu'),
    subtype('sandalet', 'Sandalet', 'ayakkabi', 1, 'gunluk', 'sicak'),
    subtype('loafer', 'Loafer', 'ayakkabi', 3, 'klasik', 'tumu'),
    subtype('babet', 'Babet', 'ayakkabi', 3, 'minimal', 'tumu'),
    subtype('diger', 'Diğer', 'ayakkabi', 3, 'gunluk', 'tumu'),
  ],
  bags: [subtype('canta', 'Çanta', 'canta', 3, 'gunluk', 'tumu')],
  hats: [
    subtype('sapka', 'Şapka', 'sapka', 1, 'gunluk', 'tumu'),
    subtype('bere', 'Bere', 'sapka', 1, 'gunluk', 'soguk'),
    subtype('diger', 'Diğer', 'sapka', 2, 'gunluk', 'tumu'),
  ],
  accessories: [
    subtype('kemer', 'Kemer', 'aksesuar', 3, 'klasik', 'tumu'),
    subtype('atki', 'Atkı', 'aksesuar', 2, 'gunluk', 'soguk'),
    subtype('gozluk', 'Gözlük', 'aksesuar', 2, 'gunluk', 'sicak'),
    subtype('taki', 'Takı', 'aksesuar', 3, 'minimal', 'tumu'),
    subtype('saat', 'Saat', 'aksesuar', 3, 'klasik', 'tumu'),
    subtype('diger', 'Diğer', 'aksesuar', 3, 'gunluk', 'tumu'),
  ],
};

export const CATEGORY_SUBTYPES: Readonly<Record<GarmentCategory, readonly string[]>> = Object.fromEntries(
  (Object.keys(SUBTYPES) as GarmentCategory[]).map(category => [category, SUBTYPES[category].map(item => item.slug)]),
) as unknown as Record<GarmentCategory, readonly string[]>;

export const subtypesForCategory = (category: GarmentCategory): readonly VocabularySubtype[] =>
  SUBTYPES[category] ?? [];

export const isValidSubtype = (category: GarmentCategory, slug: string | null | undefined): boolean =>
  typeof slug === 'string' && subtypesForCategory(category).some(item => item.slug === slug);

/** Only single-option categories pick themselves; everything else needs a user choice. */
export const defaultSubtype = (category: GarmentCategory): string | undefined => {
  const options = subtypesForCategory(category);
  return options.length === 1 ? options[0].slug : undefined;
};

export const isUnknownSubtype = (slug: string): boolean => slug === 'diger';

const UNKNOWN_NOUN: Partial<Record<GarmentCategory, string>> = {
  shoes: 'ayakkabı', hats: 'şapka', accessories: 'aksesuar',
};

/** "Lacivert gömlek". 'diger' needs the category for a noun, otherwise falls back to "parça". */
export const buildAutoTitle = (
  colorSlug: string,
  subtypeSlug: string,
  category?: GarmentCategory,
): string | null => {
  const color = COLORS.find(item => item.slug === colorSlug);
  if (!color) return null;
  const options = category ? subtypesForCategory(category) : Object.values(SUBTYPES).flat();
  const entry = options.find(item => item.slug === subtypeSlug);
  if (!entry) return null;
  const noun = isUnknownSubtype(entry.slug)
    ? (category ? UNKNOWN_NOUN[category] : undefined) ?? 'parça'
    : entry.label.toLocaleLowerCase('tr-TR');
  return `${color.label} ${noun}`;
};

// --- Catalog mapping (data only; nothing reads these yet) -------------------------------------
// Rule: map to the slug the catalog already assigns to the same kind of product. Several wardrobe
// subtypes may share one catalog slug; null where the catalog has no honest slug.
// kazak/hirka have their own catalog slugs now that unmatched upper_body is unknown, not 'tisort'.
const CATALOG_SUBTYPES: Readonly<Record<GarmentCategory, Readonly<Record<string, string | null>>>> = {
  upper_body: {
    tisort: 'tisort', gomlek: 'gomlek', bluz: 'bluz', body: 'body', polo: 'polo', kazak: 'kazak', hirka: 'hirka', sweatshirt: 'sweatshirt',
    hoodie: 'hoodie', ceket: 'ceket', blazer: 'blazer', mont: 'mont', kaban: 'kaban', trenckot: 'trenckot',
  },
  dresses: { elbise: 'elbise' },
  lower_body: { pantolon: 'pantolon', jean: 'jean', kargo: 'kargo', esofman: 'esofman', sort: 'sort', etek: 'etek' },
  shoes: {
    sneaker: 'ayakkabi', bot: 'ayakkabi', topuklu: 'ayakkabi', sandalet: 'ayakkabi',
    loafer: 'ayakkabi', babet: 'ayakkabi', diger: 'ayakkabi',
  },
  bags: { canta: 'canta' },
  hats: { sapka: 'sapka', bere: 'sapka', diger: 'sapka' },
  accessories: {
    kemer: 'aksesuar', atki: 'aksesuar', gozluk: 'aksesuar', taki: 'aksesuar', saat: 'aksesuar', diger: 'aksesuar',
  },
};

// krem -> bej because the catalog's alias table folds the text "krem" into bej.
const CATALOG_COLORS: Readonly<Record<string, string | null>> = {
  siyah: 'siyah', beyaz: 'beyaz', gri: 'gri', krem: 'bej', bej: 'bej', kahverengi: 'kahverengi',
  navy: 'navy', mavi: 'mavi', kirmizi: 'kirmizi', bordo: 'bordo', pembe: 'pembe', mor: 'mor',
  yesil: 'yesil', sari: 'sari', turuncu: 'turuncu', cok_renkli: null,
};

export const toCatalogSubtype = (category: GarmentCategory, slug: string): string | null =>
  CATALOG_SUBTYPES[category]?.[slug] ?? null;

export const toCatalogColor = (slug: string): string | null => CATALOG_COLORS[slug] ?? null;

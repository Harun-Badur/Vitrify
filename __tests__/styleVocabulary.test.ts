import {
  CATEGORY_SUBTYPES,
  COLORS,
  STYLE_FAMILIES,
  SUBTYPE_SEASONS,
  SUBTYPE_SLOTS,
  buildAutoTitle,
  colorLabel,
  defaultSubtype,
  isUnknownSubtype,
  isValidSubtype,
  subtypesForCategory,
  toCatalogColor,
  toCatalogSubtype,
} from '../lib/styleVocabulary';
import { COLOR_ALIASES, inferColorsFromText, inferSubcategory } from '../lib/productAttributes';
import { catalogStyleSignal } from '../src/intelligence/outfits/catalogCompatibility';
import { GARMENT_CATEGORIES, type GarmentCategory } from '../types/product';

const categories = Object.keys(CATEGORY_SUBTYPES) as GarmentCategory[];
const pairs = categories.flatMap(category =>
  CATEGORY_SUBTYPES[category].map(subtype => [category, subtype] as const));

describe('categories and subtypes', () => {
  it('covers exactly the app garment categories', () => {
    expect([...categories].sort()).toEqual([...GARMENT_CATEGORIES].sort());
  });

  it('lists the agreed subtypes per category', () => {
    const slugs = (category: GarmentCategory) => subtypesForCategory(category).map(item => item.slug);
    expect(slugs('upper_body')).toEqual(['tisort', 'gomlek', 'polo', 'kazak', 'hirka', 'sweatshirt', 'hoodie', 'ceket', 'blazer', 'mont']);
    expect(slugs('lower_body')).toEqual(['pantolon', 'jean', 'kargo', 'esofman', 'sort', 'etek']);
    expect(slugs('dresses')).toEqual(['elbise']);
    expect(slugs('shoes')).toEqual(['sneaker', 'bot', 'topuklu', 'sandalet', 'loafer', 'babet', 'diger']);
    expect(slugs('bags')).toEqual(['canta']);
    expect(slugs('hats')).toEqual(['sapka', 'bere', 'diger']);
    expect(slugs('accessories')).toEqual(['kemer', 'atki', 'gozluk', 'taki', 'saat', 'diger']);
  });

  it.each(pairs)('%s / %s is a valid combination', (category, subtype) => {
    expect(isValidSubtype(category, subtype)).toBe(true);
  });

  it('rejects a subtype from another category, unknown slugs and empty input', () => {
    expect(isValidSubtype('shoes', 'gomlek')).toBe(false);
    expect(isValidSubtype('upper_body', 'diger')).toBe(false);
    expect(isValidSubtype('upper_body', 'nope')).toBe(false);
    expect(isValidSubtype('upper_body', '')).toBe(false);
    expect(isValidSubtype('upper_body', null)).toBe(false);
  });

  it('auto-selects only single-option categories', () => {
    expect(defaultSubtype('dresses')).toBe('elbise');
    expect(defaultSubtype('bags')).toBe('canta');
    for (const category of categories.filter(item => item !== 'dresses' && item !== 'bags')) {
      expect(defaultSubtype(category)).toBeUndefined();
    }
  });

  it('treats diger as unknown', () => {
    expect(isUnknownSubtype('diger')).toBe(true);
    expect(isUnknownSubtype('gomlek')).toBe(false);
  });

  it.each(pairs)('%s / %s has complete attributes', (category, subtype) => {
    const entry = subtypesForCategory(category).find(item => item.slug === subtype)!;
    expect(entry.label.length).toBeGreaterThan(0);
    expect(SUBTYPE_SLOTS).toContain(entry.slot);
    expect([1, 2, 3, 4, 5]).toContain(entry.formality);
    expect(STYLE_FAMILIES).toContain(entry.family);
    expect(SUBTYPE_SEASONS).toContain(entry.season);
    expect([null, 'casual', 'tailored']).toContain(entry.scorerStyle);
  });

  it('keeps the outfit scorer style identical to catalogStyleSignal', () => {
    for (const [category, subtype] of pairs) {
      const entry = subtypesForCategory(category).find(item => item.slug === subtype)!;
      expect(entry.scorerStyle).toBe(catalogStyleSignal(subtype));
    }
  });
});

describe('colors', () => {
  it('has unique slugs and well-formed hex values', () => {
    const slugs = COLORS.map(color => color.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toEqual(['siyah', 'beyaz', 'gri', 'krem', 'bej', 'kahverengi', 'navy', 'mavi', 'kirmizi',
      'bordo', 'pembe', 'mor', 'yesil', 'sari', 'turuncu', 'cok_renkli']);
    for (const color of COLORS.filter(item => item.slug !== 'cok_renkli')) {
      expect(color.hex).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect(COLORS.find(item => item.slug === 'cok_renkli')!.hex).toBeNull();
  });

  it('marks the same neutrals the outfit scorer treats as neutral', () => {
    expect(COLORS.filter(color => color.neutral).map(color => color.slug).sort())
      .toEqual(['bej', 'beyaz', 'gri', 'krem', 'navy', 'siyah']);
  });

  it('labels colors in Turkish and tolerates legacy catalog slugs', () => {
    expect(colorLabel('navy')).toBe('Lacivert');
    expect(colorLabel('kirmizi')).toBe('Kırmızı');
    expect(colorLabel('cok_renkli')).toBe('Çok renkli');
    expect(colorLabel('camel')).toBe('Camel');
    expect(colorLabel('desenli')).toBe('Desenli');
    expect(colorLabel('unknown-slug')).toBe('unknown-slug');
  });
});

describe('buildAutoTitle', () => {
  it.each([
    ['navy', 'gomlek', undefined, 'Lacivert gömlek'],
    ['siyah', 'tisort', undefined, 'Siyah tişört'],
    ['kirmizi', 'elbise', undefined, 'Kırmızı elbise'],
    ['bej', 'esofman', undefined, 'Bej eşofman'],
    ['cok_renkli', 'gomlek', undefined, 'Çok renkli gömlek'],
    ['navy', 'diger', 'shoes', 'Lacivert ayakkabı'],
    ['gri', 'diger', 'hats', 'Gri şapka'],
    ['siyah', 'diger', 'accessories', 'Siyah aksesuar'],
    ['navy', 'diger', undefined, 'Lacivert parça'],
  ] as const)('%s + %s (%s) -> %s', (color, subtype, category, expected) => {
    expect(buildAutoTitle(color, subtype, category)).toBe(expected);
  });

  it('returns null for unknown slugs', () => {
    expect(buildAutoTitle('nope', 'gomlek')).toBeNull();
    expect(buildAutoTitle('navy', 'nope')).toBeNull();
  });
});

describe('catalog mapping tables', () => {
  const catalogColors = new Set(COLOR_ALIASES.map(alias => alias.slug));

  it('maps every vocabulary color, with krem -> bej and cok_renkli -> null', () => {
    for (const color of COLORS) expect(toCatalogColor(color.slug)).toBeDefined();
    expect(toCatalogColor('krem')).toBe('bej');
    expect(toCatalogColor('cok_renkli')).toBeNull();
    expect(toCatalogColor('nope')).toBeNull();
  });

  it('only maps to slugs the catalog actually has, and the catalog reads the label back to the same slug', () => {
    for (const color of COLORS) {
      const mapped = toCatalogColor(color.slug);
      if (mapped === null) continue;
      expect(catalogColors.has(mapped)).toBe(true);
      expect(inferColorsFromText(color.label)).toContain(mapped);
    }
  });

  it('maps every vocabulary subtype (mont -> ceket, kazak/hirka have own slugs now that unmatched upper_body is unknown)', () => {
    for (const [category, subtype] of pairs) expect(toCatalogSubtype(category, subtype)).not.toBeUndefined();
    expect(toCatalogSubtype('upper_body', 'mont')).toBe('ceket');
    expect(toCatalogSubtype('upper_body', 'kazak')).toBe('kazak');
    expect(toCatalogSubtype('upper_body', 'hirka')).toBe('hirka');
    expect(toCatalogSubtype('shoes', 'nope')).toBeNull();
  });

  it('only maps to slugs the catalog infers for that same kind of product', () => {
    for (const [category, subtype] of pairs) {
      const mapped = toCatalogSubtype(category, subtype);
      if (mapped === null) continue;
      const label = subtypesForCategory(category).find(item => item.slug === subtype)!.label;
      expect(inferSubcategory(label, category)).toBe(mapped);
    }
  });
});

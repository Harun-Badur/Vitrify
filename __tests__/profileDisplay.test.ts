import {
  NEUTRAL_SWATCH, brandLabel, categoryIcon, colorHex, displayLabel, fitShape, priceBandIndex,
} from '../lib/profileDisplay';

describe('brandLabel (display layer only)', () => {
  test.each([
    ['lcw', 'LC Waikiki'],
    ['lcw-classic', 'LC Waikiki'],
    ['LCW Basic', 'LC Waikiki'],
    ['lc-waikiki', 'LC Waikiki'],
    ['LC WAIKIKI', 'LC Waikiki'],
    ['zara', 'ZARA'],
    ['defacto', 'DeFacto'],
    ['jack-jones', 'Jack & Jones'],
    ['adidas', 'adidas'],
    ['ipekyol', 'İpekyol'],
    ['pull-bear', 'Pull Bear'],
  ])('%s -> %s', (raw, expected) => expect(brandLabel(raw)).toBe(expected));
  test('empty or blank input stays empty instead of inventing a name', () => {
    expect(brandLabel('')).toBe('');
    expect(brandLabel('   ')).toBe('');
  });
});

describe('displayLabel', () => {
  test('capitalises the first letter of each word with Turkish casing and splits slugs', () => {
    expect(displayLabel('açık mavi')).toBe('Açık Mavi');
    expect(displayLabel('ıslak_zemin')).toBe('Islak Zemin');
    expect(displayLabel('  iki   kelime ')).toBe('İki Kelime');
  });
});

describe('colorHex', () => {
  test('known slug, label and Turkish-folded names map to a swatch', () => {
    expect(colorHex('siyah')).toBe('#111111');
    expect(colorHex('navy')).toBe(colorHex('Lacivert'));
    expect(colorHex('Haki')).toBe('#AAA780');
    expect(colorHex('kirmizi')).toBe(colorHex('Kırmızı'));
  });
  test('unknown colours get the neutral grey circle, never a guessed hue', () => {
    expect(colorHex('zzz')).toBe(NEUTRAL_SWATCH);
    expect(colorHex('')).toBe(NEUTRAL_SWATCH);
    expect(colorHex('desenli')).toBe(NEUTRAL_SWATCH);
  });
});

describe('categoryIcon', () => {
  test.each([
    ['gomlek', 'shirt'], ['Tişört', 'shirt'], ['pantolon', 'pants'], ['jean', 'pants'], ['elbise', 'dress'],
    ['sneaker', 'shoe'], ['canta', 'bag'], ['sapka', 'hat'], ['mont', 'outerwear'], ['blazer', 'outerwear'],
    ['saat', 'accessory'],
  ])('%s -> %s', (raw, icon) => expect(categoryIcon(raw)).toBe(icon));
  test('unknown values fall back to the shirt icon', () => {
    expect(categoryIcon('bilinmeyen-parca')).toBe('shirt');
    expect(categoryIcon('')).toBe('shirt');
  });
});

describe('fitShape and price band', () => {
  test('fit values map to silhouettes; unknown is null', () => {
    expect(fitShape('slim')).toBe('slim');
    expect(fitShape('Oversized')).toBe('oversized');
    expect(fitShape('relaxed')).toBe('relaxed');
    expect(fitShape('regular')).toBe('regular');
    expect(fitShape('baggy-x')).toBeNull();
  });
  test('price bands are ordered and unknown bands have no index', () => {
    expect(['low', 'mid', 'high', 'luxury'].map(priceBandIndex)).toEqual([0, 1, 2, 3]);
    expect(priceBandIndex('cheap')).toBe(-1);
  });
});

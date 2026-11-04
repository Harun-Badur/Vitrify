import {
  NEUTRAL_SWATCH, brandLabel, brandMonogram, colorHex, displayLabel, fitShape, initials, priceBandIndex, uniqueLabels,
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

describe('initials and brandMonogram', () => {
  test.each([
    ['harun badur', 'HB'], ['Harun', 'H'], ['  ışık   özdemir ', 'IÖ'], ['a b c', 'AB'], ['', '?'], ['  ', '?'],
  ])('initials(%s) -> %s', (raw, expected) => expect(initials(raw)).toBe(expected));
  test.each([
    ['LC Waikiki', 'LW'], ['ZARA', 'ZA'], ['Jack & Jones', 'JJ'], ['adidas', 'AD'], ['H&M', 'HM'], ['', ''],
  ])('brandMonogram(%s) -> %s', (raw, expected) => expect(brandMonogram(raw)).toBe(expected));
});

describe('uniqueLabels (after normalisation)', () => {
  test('variants that normalise to the same brand collapse to one, keeping the first order', () => {
    expect(uniqueLabels(['lcw', 'lc-waikiki', 'LC WAIKIKI', 'zara', 'ZARA'].map(brandLabel))).toEqual(['LC Waikiki', 'ZARA']);
  });
  test('case and Turkish folding count as the same label; blanks are dropped', () => {
    expect(uniqueLabels(['Işık', 'ışık', '', ' ', 'Siyah'])).toEqual(['Işık', 'Siyah']);
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

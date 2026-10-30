import { resolveSwatch } from '../lib/colorSwatch';
import {
  activeVariantIndex,
  fallbackColor,
  planVariantRow,
  selectedImageFor,
  storeProductFor,
  visibleColors,
  visibleSizes,
} from '../lib/discoverVariants';
import type { Product } from '../types/product';

const base: Product = {
  id: 'p1', title: 'Tisort', brand: 'X', price: 100, imageUrl: 'https://c/main.jpg',
  category: 'upper_body', garmentDescription: '', productUrl: 'https://s/main',
  affiliateUrl: 'https://aff/main',
};
const variants = [
  { name: 'Siyah', url: 'https://s/black', imageUrl: 'https://c/black.jpg' },
  { name: null, url: 'https://s/x', imageUrl: 'https://c/x.jpg' },
];

describe('resolveSwatch', () => {
  it('maps known single colors to hex, accent/case insensitive', () => {
    expect(resolveSwatch('Siyah')).toMatchObject({ kind: 'hex', hex: expect.stringMatching(/^#/) });
    expect(resolveSwatch('LACİVERT').kind).toBe('hex');
    expect(resolveSwatch('Yeşil').kind).toBe('hex');
    expect(resolveSwatch('Kırmızı').kind).toBe('hex');
  });
  it('flags light colors for a border', () => {
    expect(resolveSwatch('Beyaz')).toMatchObject({ kind: 'hex', light: true });
    expect(resolveSwatch('Siyah')).toMatchObject({ kind: 'hex', light: false });
  });
  it('falls back to image for null, multi-color and unknown names', () => {
    expect(resolveSwatch(null).kind).toBe('image');
    expect(resolveSwatch('  ').kind).toBe('image');
    expect(resolveSwatch('Siyah-Beyaz').kind).toBe('image');
    expect(resolveSwatch('Siyah/Beyaz').kind).toBe('image');
    expect(resolveSwatch('Mercan').kind).toBe('image');
  });
});

describe('planVariantRow', () => {
  const sizes = (n: number) => Array.from({ length: n }, (_, i) => ({ label: String(i) }));
  const colors = (n: number) => Array.from({ length: n }, (_, i) => ({ name: 'Siyah', url: `u${i}` }));
  it('keeps one line for <=5 sizes and <=4 colors', () => {
    expect(planVariantRow(colors(4), sizes(5)).sizesOnSecondLine).toBe(false);
  });
  it('moves sizes below when sizes>5 or colors>4', () => {
    expect(planVariantRow(colors(4), sizes(6)).sizesOnSecondLine).toBe(true);
    expect(planVariantRow(colors(5), sizes(3)).sizesOnSecondLine).toBe(true);
  });
  it('hides absent sections, no placeholders', () => {
    expect(planVariantRow(undefined, undefined)).toMatchObject({ showColors: false, showSizes: false });
    expect(planVariantRow([], [])).toMatchObject({ showColors: false, showSizes: false });
    expect(planVariantRow(colors(2), undefined)).toMatchObject({ showColors: true, showSizes: false });
    expect(planVariantRow(undefined, sizes(2))).toMatchObject({ showColors: false, showSizes: true });
  });
  it('caps colors at 4 + overflow, sizes with +N', () => {
    expect(visibleColors(colors(4)).overflow).toBe(0);
    const capped = visibleColors(colors(7));
    expect(capped.shown).toHaveLength(4);
    expect(capped.overflow).toBe(3);
    const s = visibleSizes(sizes(14));
    expect(s.shown.length + s.overflow).toBe(14);
    expect(s.overflow).toBeGreaterThan(0);
    expect(visibleSizes(sizes(5)).overflow).toBe(0);
  });
});

describe('fallbackColor', () => {
  it('returns the single known color only', () => {
    expect(fallbackColor({ ...base, colors: [{ name: 'Siyah', hex: '#000' }] })?.name).toBe('Siyah');
    expect(fallbackColor({ ...base, colors: [{ name: 'Siyah', hex: '#000' }, { name: 'Beyaz', hex: '#fff' }] })).toBeNull();
    expect(fallbackColor({ ...base, colors: [{ name: 'Mercan', hex: '#f00' }] })).toBeNull();
    expect(fallbackColor(base)).toBeNull();
  });
});

describe('selection', () => {
  it('uses the variant image/url while keeping product identity, price, title', () => {
    expect(selectedImageFor(variants, 0)).toBe('https://c/black.jpg');
    expect(selectedImageFor(variants, null)).toBeNull();
    const store = storeProductFor({ ...base, colorVariants: variants }, 0);
    expect(store.productUrl).toBe('https://s/black');
    expect(store.affiliateUrl).toBeUndefined();
    expect(store.id).toBe('p1');
    expect(store.price).toBe(100);
    expect(store.imageUrl).toBe('https://c/main.jpg');
  });
  it('returns the product itself when nothing is selected or index invalid', () => {
    const p = { ...base, colorVariants: variants };
    expect(storeProductFor(p, null)).toBe(p);
    expect(storeProductFor(p, 9)).toBe(p);
  });
  it('resets when the card (product id) changes', () => {
    const state = { productId: 'p1', index: 1 };
    expect(activeVariantIndex(state, 'p1')).toBe(1);
    expect(activeVariantIndex(state, 'p2')).toBeNull();
  });
});

describe('DiscoverVariantRow rendering (source contract)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const src: string = require('fs').readFileSync(require('path').join(__dirname, '../components/DiscoverVariantRow.tsx'), 'utf8');
  it('prefers the variant image preview, hex only as fallback', () => {
    expect(src.indexOf('imageUrl ? (')).toBeGreaterThan(-1);
    expect(src).toMatch(/imageUrl \? \([\s\S]*<Image[\s\S]*\) : \([\s\S]*swatch\.hex/);
  });
  it('uppercases size labels and uses the compact sizes', () => {
    expect(src).toContain('size.label.toUpperCase()');
    expect(src).toMatch(/const DOT = 26;/);
    expect(src).toMatch(/height: 24, minWidth: 26, paddingHorizontal: 7, borderRadius: 8/);
    expect(src).toMatch(/fontSize: 11, fontWeight: '400'/);
    expect(src).toMatch(/height: 16/);
  });
});

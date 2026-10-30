import { resolveSwatch } from '../lib/colorSwatch';
import {
  activeVariantIndex,
  fallbackColor,
  fitVariantRow,
  VARIANT_ROW_HEIGHT,
  chipWidth,
  selectedImageFor,
  storeProductFor,
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

describe('fitVariantRow (single line, no second row)', () => {
  const labels = (n: number) => Array.from({ length: n }, (_, i) => ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '36', '38', '40', '42', '44'][i % 12]);
  const used = (w: number, colors: number, sizes: string[]) => {
    const fit = fitVariantRow(w, colors, sizes);
    const colorSpan = fit.colorCount ? fit.colorCount * 26 + (fit.colorCount - 1) * 6 + (fit.colorOverflow ? 26 : 0) + (fit.chipCount + fit.hiddenSizes > 0 ? 13 : 0) : 0;
    const chips = sizes.slice(0, fit.chipCount).reduce((a, l, i) => a + (i ? 4 : 0) + chipWidth(l), 0)
      + (fit.hiddenSizes ? 4 + chipWidth(`+${fit.hiddenSizes}`) : 0);
    return { fit, total: colorSpan + chips };
  };
  it('never needs more than the measured width (long and short prices)', () => {
    for (const width of [90, 140, 180, 220, 260]) {
      for (const colors of [0, 1, 3, 8]) {
        for (const n of [0, 3, 5, 12]) {
          const { fit, total } = used(width, colors, labels(n));
          if (fit.chipCount + fit.hiddenSizes > 0 || fit.colorCount > 0) {
            expect(total).toBeLessThanOrEqual(width);
          }
          expect(fit.chipCount + fit.hiddenSizes).toBeLessThanOrEqual(n);
        }
      }
    }
  });
  it('shows up to 3 colors then "+N", and collapses hidden sizes into one +K', () => {
    const fit = fitVariantRow(240, 7, labels(12));
    expect(fit.colorCount).toBeLessThanOrEqual(3);
    expect(fit.colorOverflow).toBe(7 - fit.colorCount);
    expect(fit.chipCount + fit.hiddenSizes).toBe(12);
    expect(fit.hiddenSizes).toBeGreaterThan(0);
  });
  it('drops to 2 colors to keep at least 2 chips', () => {
    const widths = Array.from({ length: 200 }, (_, k) => 100 + k)
      .filter(w => { const f = fitVariantRow(w, 3, labels(7)); return f.colorCount === 2 && f.chipCount >= 2; });
    expect(widths.length).toBeGreaterThan(0);
    expect(widths.every(w => fitVariantRow(w, 3, labels(7)).colorOverflow === 1)).toBe(true);
  });
  it('handles missing data: sizes only, colors only, none', () => {
    expect(fitVariantRow(200, 0, labels(3))).toMatchObject({ colorCount: 0, chipCount: 3, hiddenSizes: 0 });
    expect(fitVariantRow(200, 2, [])).toMatchObject({ colorCount: 2, chipCount: 0, hiddenSizes: 0 });
    expect(fitVariantRow(200, 0, [])).toMatchObject({ colorCount: 0, chipCount: 0, hiddenSizes: 0 });
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

describe('footer height is constant (source contract)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const read = (rel: string): string => require('fs').readFileSync(require('path').join(__dirname, rel), 'utf8');
  const row = read('../components/DiscoverVariantRow.tsx');
  const card = read('../components/SwipeCard.tsx');
  it('uses one fixed row height shared by the price row and the variant slot', () => {
    expect(VARIANT_ROW_HEIGHT).toBe(28);
    expect(row).toMatch(/height: VARIANT_ROW_HEIGHT/);
    expect(card).toMatch(/purchaseRow: \{[^}]*height: VARIANT_ROW_HEIGHT/);
    expect(card).not.toMatch(/purchaseRow: \{[^}]*flexWrap/);
  });
  it('has no second-line sizes and always mounts the variant slot', () => {
    expect(card).not.toMatch(/sizesOnSecondLine|DiscoverSizesLine/);
    expect(row).not.toMatch(/flexWrap/);
    expect(card).toMatch(/<DiscoverVariantInline\s/);
    expect(card).not.toMatch(/showVariantInline/);
  });
  it('prefers the variant image preview, hex only as fallback; uppercase compact chips', () => {
    expect(row).toMatch(/imageUrl \? \([\s\S]*<Image[\s\S]*\) : \([\s\S]*swatch\.hex/);
    expect(row).toContain('size.label.toUpperCase()');
    expect(row).toMatch(/const DOT = 26;/);
    expect(row).toMatch(/height: 24, minWidth: 24, paddingHorizontal: 6, borderRadius: 8/);
    expect(row).toMatch(/columnGap: 4/);
  });
});

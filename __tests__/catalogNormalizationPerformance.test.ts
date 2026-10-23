import { inferProductAttributes, matchSubcategoryFromTitle } from '../lib/productAttributes';

test('reuses exact Turkish normalization without changing inferred attributes or missing evidence', () => {
  const input = { title: '  ÖLÇÜM İÇİN SİYAH REGULAR ERKEK GÖMLEK 7319  ', brand: 'Ölçüm 7319', price: 450, category: 'upper_body' };
  const lower = jest.spyOn(String.prototype, 'toLocaleLowerCase');
  try {
    const first = inferProductAttributes(input);
    expect(first).toMatchObject({ gender: 'men', colors: ['siyah'], fit: 'regular', subcategory: 'gomlek' });
    lower.mockClear();
    expect(inferProductAttributes(input)).toEqual(first);
    expect(lower).not.toHaveBeenCalled();
    expect(matchSubcategoryFromTitle('Kapüşonlu SWEATSHIRT')).toBe('hoodie');
    const unknown = inferProductAttributes({ title: 'Belirsiz 7319', brand: null, price: 100, category: 'upper_body' });
    expect(unknown).toMatchObject({ gender: undefined, colors: [], fit: '' });
  } finally { lower.mockRestore(); }
});


test('reuses canonical URL parsing within a recommendation and invalidates by raw URL evidence', () => {
  const { sameCatalogProduct } = require('../src/intelligence/outfits/catalogCompatibility') as typeof import('../src/intelligence/outfits/catalogCompatibility');
  const { createRecommendationMemo, withRecommendationMemo } = require('../lib/recommendationMemo') as typeof import('../lib/recommendationMemo');
  const { MOCK_PRODUCTS } = require('../data/mockProducts') as typeof import('../data/mockProducts');
  const left = { ...MOCK_PRODUCTS[0], id: 'url-left', productUrl: 'https://example.com/item/?a=1' };
  const right = { ...MOCK_PRODUCTS[0], id: 'url-right', productUrl: 'https://example.com/item?a=2' };
  const NativeURL = globalThis.URL;
  const parse = jest.spyOn(globalThis, 'URL').mockImplementation((url, base) => new NativeURL(url, base));
  try {
    withRecommendationMemo(createRecommendationMemo(), () => {
      expect(sameCatalogProduct(left, right)).toBe(true);
      parse.mockClear();
      expect(sameCatalogProduct(left, right)).toBe(true);
      expect(parse).not.toHaveBeenCalled();
      right.productUrl = 'https://example.com/different';
      right.title = 'Different actual product';
      expect(sameCatalogProduct(left, right)).toBe(false);
      expect(parse).toHaveBeenCalledTimes(1);
    });
  } finally { parse.mockRestore(); }
});

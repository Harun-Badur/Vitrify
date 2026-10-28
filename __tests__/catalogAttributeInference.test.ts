import audit from './fixtures/catalogAttributeAudit.json';
import {
  inferGenderDetail,
  inferProductAttributes,
  inferSubcategory,
  matchSubcategoryFromTitle,
} from '../lib/productAttributes';

// Fixtures: the 11 wrong subtypes and 29 silent 'tisort' fallbacks found in
// scripts/queries/catalog_attribute_audit.md (live catalog titles, no user data).
describe('subcategory inference: word boundaries', () => {
  it.each(audit.wrongSubcategory)('$id is not assigned the substring match "$wasSubcategory"', (row) => {
    const matched = matchSubcategoryFromTitle(row.title, row.category);
    expect(matched).not.toBe(row.wasSubcategory);
    expect(matched).toBe(/trençkot/i.test(row.title) ? 'ceket' : '');
  });

  it('keeps real jean/kot words and Turkish suffixes', () => {
    expect(matchSubcategoryFromTitle('Erkek Kot Pantolon', 'lower_body')).toBe('jean');
    expect(matchSubcategoryFromTitle('Mavi Erkek Jean', 'lower_body')).toBe('jean');
    expect(matchSubcategoryFromTitle('Kadın Pantolonu', 'lower_body')).toBe('pantolon');
    expect(matchSubcategoryFromTitle('Kapüşonlu SWEATSHIRT', 'upper_body')).toBe('hoodie');
  });

  it('does not read garment words inside accessory, shoe or bag titles', () => {
    expect(matchSubcategoryFromTitle('Hakiki Deri Kemer - Kot Pantolon Kemeri', 'accessories')).toBe('');
    expect(inferSubcategory('Hakiki Deri Kemer - Kot Pantolon Kemeri', 'accessories')).toBe('aksesuar');
    expect(inferSubcategory('Gömlek Desenli Çanta', 'bags')).toBe('canta');
  });

  it('reads t-shirt as tisort, not as gomlek via the "shirt" substring', () => {
    expect(matchSubcategoryFromTitle('Erkek Siyah T-Shirt', 'upper_body')).toBe('tisort');
    expect(matchSubcategoryFromTitle('Erkek Beyaz Shirt Yaka', 'upper_body')).toBe('gomlek');
  });
});

describe('subcategory inference: unknown stays unknown', () => {
  it.each(audit.upperBodyWithoutTitleKeyword)('$id upper_body has no silent tisort fallback', (row) => {
    expect(inferSubcategory(row.title, row.category)).toBeUndefined();
    const inferred = inferProductAttributes({ title: row.title, brand: null, price: 100, category: row.category });
    expect(inferred.subcategory).toBeUndefined();
  });

  it('keeps category-defined fallbacks for non-upper categories', () => {
    expect(inferSubcategory('Örnek', 'lower_body')).toBe('pantolon');
    expect(inferSubcategory('Örnek', 'dresses')).toBe('elbise');
    expect(inferSubcategory('Örnek', 'shoes')).toBe('ayakkabi');
    expect(inferSubcategory('Örnek', 'bags')).toBe('canta');
    expect(inferSubcategory('Örnek', 'hats')).toBe('sapka');
    expect(inferSubcategory('Örnek', 'accessories')).toBe('aksesuar');
  });

  it('still resolves an explicit upper_body keyword', () => {
    expect(inferSubcategory('Kadın Siyah Oversize Tişört', 'upper_body')).toBe('tisort');
  });
});

describe('inferGenderDetail', () => {
  it.each([
    ['Kadın Siyah Tişört', 'kadin'],
    ['Erkek Lacivert Pantolon', 'erkek'],
    ['Kız Çocuk Elbise', 'cocuk'],
    ['Erkek Çocuk Mont', 'cocuk'],
    ['Bebek Zıbın', 'cocuk'],
    ['Unisex Basic Tişört', 'unisex'],
    ['Belirsiz 7319', 'bilinmiyor'],
  ])('%s -> %s', (title, gender) => {
    expect(inferGenderDetail(title).gender).toBe(gender);
  });

  it('reports rule and matched key with confidence', () => {
    expect(inferGenderDetail('Kadın Siyah Tişört')).toEqual({
      gender: 'kadin', confidence: 'high', rule: 'title_token', key: 'kadın',
    });
    expect(inferGenderDetail('Erkek Çocuk Mont')).toMatchObject({ gender: 'cocuk', rule: 'title_child_token', key: 'çocuk' });
  });

  it('is unknown when title evidence conflicts, and does not match inside words', () => {
    expect(inferGenderDetail('Kadın Erkek Ortak Çanta')).toMatchObject({ gender: 'bilinmiyor', confidence: 'none', rule: 'title_conflict' });
    expect(inferGenderDetail('Unisex Kadın Tişört').gender).toBe('bilinmiyor');
    expect(inferGenderDetail('Erkekçe Tasarım Çanta').gender).toBe('bilinmiyor');
    expect(inferGenderDetail('Bay Cüzdan').gender).toBe('bilinmiyor');
  });

  it('uses the URL path only when the title has no evidence, with lower confidence', () => {
    const url = 'https://www.lcw.com/erkek-siyah-slim-tisort-o-4275208';
    expect(inferGenderDetail('Siyah Slim Tişört', url)).toEqual({
      gender: 'erkek', confidence: 'medium', rule: 'url_token', key: 'erkek',
    });
    expect(inferGenderDetail('Kadın Siyah Tişört', url)).toMatchObject({ gender: 'kadin', rule: 'title_token' });
    expect(inferGenderDetail('Siyah Tişört', 'not a url').gender).toBe('bilinmiyor');
  });
});

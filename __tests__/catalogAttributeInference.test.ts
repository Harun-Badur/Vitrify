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
    expect(matched).toBe(/trençkot/i.test(row.title) ? 'trenckot' : '');
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

  it('reads a suit as blazer, a dress as elbise, plus kazak and hirka keys', () => {
    expect(matchSubcategoryFromTitle('Lacivert Takım Elbise', 'upper_body')).toBe('blazer');
    expect(matchSubcategoryFromTitle('Çiçekli Midi Elbise', 'dresses')).toBe('elbise');
    expect(matchSubcategoryFromTitle('Bej Erkek Hırka', 'upper_body')).toBe('hirka');
    expect(matchSubcategoryFromTitle('Triko Kazak', 'upper_body')).toBe('kazak');
    expect(matchSubcategoryFromTitle('Kazak Desenli Çanta', 'bags')).toBe('');
  });

  it('reads t-shirt as tisort, not as gomlek via the "shirt" substring', () => {
    expect(matchSubcategoryFromTitle('Erkek Siyah T-Shirt', 'upper_body')).toBe('tisort');
    expect(matchSubcategoryFromTitle('Erkek Beyaz Shirt Yaka', 'upper_body')).toBe('gomlek');
  });
});

describe('subcategory inference: unknown stays unknown', () => {
  it.each(audit.upperBodyWithoutTitleKeyword)('$id upper_body has no silent tisort fallback', (row) => {
    // Titles with their own keyword (kazak, hırka, bluz, body, softshell) match it; everything else stays unknown.
    const expected = /kazak/i.test(row.title) ? 'kazak' : /hırka/i.test(row.title) ? 'hirka'
      : /bluz/i.test(row.title) ? 'bluz' : /body/i.test(row.title) ? 'body'
        : /softshell/i.test(row.title) ? 'ceket' : undefined;
    expect(inferSubcategory(row.title, row.category)).toBe(expected);
    const inferred = inferProductAttributes({ title: row.title, brand: null, price: 100, category: row.category });
    expect(inferred.subcategory).toBe(expected);
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

describe('new subtypes bluz, body and softshell', () => {
  it('reads each with word boundaries', () => {
    expect(matchSubcategoryFromTitle('Kadın Uzun Kollu Basic Bluz', 'upper_body')).toBe('bluz');
    expect(matchSubcategoryFromTitle('Siyah Bisiklet Yaka Kadın Body', 'upper_body')).toBe('body');
    expect(matchSubcategoryFromTitle('Freecamp 3In1 Softshell Erkek', 'upper_body')).toBe('ceket');
    expect(matchSubcategoryFromTitle('Kinetix 5SOFTSHELL Gri Erkek Softshell', 'upper_body')).toBe('ceket');
  });

  it('does not match inside other words or in non-garment categories', () => {
    expect(matchSubcategoryFromTitle('Kadın Bodrum Çanta', 'bags')).toBe('');
    expect(matchSubcategoryFromTitle('Bluz Desenli Çanta', 'bags')).toBe('');
    expect(matchSubcategoryFromTitle('Antibody Kremi', 'upper_body')).toBe('');
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

  it.each([
    ['Lacivert Saten Etek', 'skirt_default', 'etek'],
    ['Kısa Abiye Elbise Modeli', 'formal_default', 'abiye'],
    ['Bej Topuklu Ayakkabı', 'heels_default', 'topuklu'],
    ['Tül Pareo', 'pareo_default', 'pareo'],
    ['Basic Bluz', 'blouse_default', 'bluz'],
    ['Bisiklet Yaka Body', 'body_default', 'body'],
  ])('%s defaults to kadin with medium confidence (%s)', (title, rule, key) => {
    expect(inferGenderDetail(title, null, 'upper_body')).toEqual({ gender: 'kadin', confidence: 'medium', rule, key });
  });

  it('is unknown when men or children evidence contradicts a womenswear word', () => {
    expect(inferGenderDetail('Erkek Body', null, 'upper_body')).toMatchObject({ gender: 'bilinmiyor', rule: 'default_conflict' });
    expect(inferGenderDetail('Erkek Çocuk Etek', null, 'lower_body')).toMatchObject({ gender: 'bilinmiyor', rule: 'default_conflict' });
    expect(inferGenderDetail('Basic Bluz', 'https://example.invalid/erkek/bluz', 'upper_body'))
      .toMatchObject({ gender: 'bilinmiyor', rule: 'default_conflict' });
    // Explicit womenswear or unisex evidence is kept as is.
    expect(inferGenderDetail('Kadın Etek', null, 'lower_body')).toMatchObject({ gender: 'kadin', rule: 'title_token' });
  });

  it('gives belts, scarves, necklaces and jewellery no gender without an explicit word (rule v3)', () => {
    for (const title of ['Mara Tokalı Kemer Kahverengi', 'Yün Atkı', 'Altın Kaplama Kolye', 'Çelik Takı Seti',
      'Taşmir 925 Ayar Gümüş Inci Kolye Bileklik Set']) {
      expect(inferGenderDetail(title, null, 'accessories'))
        .toEqual({ gender: 'bilinmiyor', confidence: 'none', rule: 'none', key: '' });
    }
    expect(inferGenderDetail('Unisex Deri Kemer', null, 'accessories'))
      .toMatchObject({ gender: 'unisex', confidence: 'high', rule: 'title_token' });
    expect(inferGenderDetail('Erkek Deri Kemer', null, 'accessories')).toMatchObject({ gender: 'erkek', rule: 'title_token' });
    expect(inferGenderDetail('Kemerli Pantolon', null, 'lower_body').gender).toBe('bilinmiyor');
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

describe('inferGenderDetail: dresses', () => {
  it('defaults an evidence-free dress to kadin with medium confidence', () => {
    expect(inferGenderDetail('Siyah Midi Elbise', null, 'dresses')).toEqual({
      gender: 'kadin', confidence: 'medium', rule: 'dress_default', key: '',
    });
    expect(inferGenderDetail('Siyah Midi Elbise').gender).toBe('bilinmiyor');
    expect(inferGenderDetail('Siyah Pantolon', null, 'lower_body').gender).toBe('bilinmiyor');
  });

  it('keeps explicit evidence and turns a mens word on a dress into bilinmiyor', () => {
    expect(inferGenderDetail('Kadın Midi Elbise', null, 'dresses')).toMatchObject({ gender: 'kadin', rule: 'title_token' });
    expect(inferGenderDetail('Kız Çocuk Elbise', null, 'dresses').gender).toBe('cocuk');
    expect(inferGenderDetail('Erkek Elbise', null, 'dresses')).toMatchObject({ gender: 'bilinmiyor', rule: 'dress_conflict' });
  });
});

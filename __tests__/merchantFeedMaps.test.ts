import { mapFeedCategory } from '../scripts/lib/merchantFeed/categoryMap';
import { mapFeedColors } from '../scripts/lib/merchantFeed/colorMap';
import { isValidProviderSlug, parseFeedPrice } from '../scripts/lib/merchantFeed/mapRow';

describe('parseFeedPrice', () => {
  it.each([
    ['1.299,00 TRY', 1299],
    ['1299.00 TRY', 1299],
    ['1,299.50 TRY', 1299.5],
    ['299,90 TRY', 299.9],
    ['249.90 TRY', 249.9],
    ['1299 TRY', 1299],
    ['1.299 TRY', 1299],
    ['899,90 TL', 899.9],
    ['  1 299,00 TRY ', 1299],
  ])('parses %s', (raw, amount) => {
    expect(parseFeedPrice(raw)).toEqual({ amount, currency: 'TRY' });
  });

  it('keeps non-TRY currencies visible and rejects garbage', () => {
    expect(parseFeedPrice('19.99 USD')).toEqual({ amount: 19.99, currency: 'USD' });
    expect(parseFeedPrice('299,90')).toEqual({ amount: 299.9, currency: '' });
    expect(parseFeedPrice('')).toBeNull();
    expect(parseFeedPrice('ücretsiz TRY')).toBeNull();
    expect(parseFeedPrice('-5 TRY')).toBeNull();
  });
});

describe('isValidProviderSlug', () => {
  it('accepts lowercase alphanumeric slugs only', () => {
    expect(isValidProviderSlug('koton')).toBe(true);
    expect(isValidProviderSlug('ornekmarka')).toBe(true);
    expect(isValidProviderSlug('Koton')).toBe(false);
    expect(isValidProviderSlug('')).toBe(false);
    expect(isValidProviderSlug('a')).toBe(false);
    expect(isValidProviderSlug('mar ka')).toBe(false);
    expect(isValidProviderSlug('marka-1')).toBe(false);
    expect(isValidProviderSlug('çanta')).toBe(false);
  });
});

describe('mapFeedColors', () => {
  it('maps Turkish and English names to existing slugs', () => {
    expect(mapFeedColors('Siyah')).toEqual({ slugs: ['siyah'], unmapped: [] });
    expect(mapFeedColors('Kırmızı')).toEqual({ slugs: ['kirmizi'], unmapped: [] });
    expect(mapFeedColors('WHITE')).toEqual({ slugs: ['beyaz'], unmapped: [] });
    expect(mapFeedColors('Navy Blue')).toEqual({ slugs: ['navy'], unmapped: [] });
    expect(mapFeedColors('Haki')).toEqual({ slugs: ['yesil'], unmapped: [] });
  });

  it('splits multi-color values and dedupes', () => {
    expect(mapFeedColors('Siyah/Beyaz').slugs).toEqual(['siyah', 'beyaz']);
    expect(mapFeedColors('Black, White; Black').slugs).toEqual(['siyah', 'beyaz']);
    expect(mapFeedColors('Mavi & Kırmızı').slugs).toEqual(['mavi', 'kirmizi']);
    expect(mapFeedColors('Siyah ve Beyaz').slugs).toEqual(['siyah', 'beyaz']);
  });

  it('drops pure shade modifiers but never guesses unknown names', () => {
    expect(mapFeedColors('Açık Mavi').slugs).toEqual(['mavi']);
    expect(mapFeedColors('Dark Grey').slugs).toEqual(['gri']);
    expect(mapFeedColors('Pudra')).toEqual({ slugs: [], unmapped: ['pudra'] });
    expect(mapFeedColors('Siyah/Pudra')).toEqual({ slugs: ['siyah'], unmapped: ['pudra'] });
    expect(mapFeedColors('Çok Renkli')).toEqual({ slugs: [], unmapped: ['çok renkli'] });
    expect(mapFeedColors('')).toEqual({ slugs: [], unmapped: [] });
  });
});

describe('mapFeedCategory', () => {
  const ok = (r: ReturnType<typeof mapFeedCategory>) => (r.ok ? [r.category, r.subcategory, r.outfitRole] : r);

  it('maps Turkish product_type paths by leaf', () => {
    expect(ok(mapFeedCategory({ googleCategory: '', productTypes: ['Giyim > Üst Giyim > Tişört'] })))
      .toEqual(['upper_body', 'tisort', 'top']);
    expect(ok(mapFeedCategory({ googleCategory: '', productTypes: ['Kadın > Elbiseler'] })))
      .toEqual(['dresses', 'elbise', 'one_piece']);
    expect(ok(mapFeedCategory({ googleCategory: '', productTypes: ['Dış Giyim > Ceket'] })))
      .toEqual(['upper_body', 'ceket', 'outerwear']);
    expect(ok(mapFeedCategory({ googleCategory: '', productTypes: ['Ayakkabı > Sneaker'] })))
      .toEqual(['shoes', 'ayakkabi', 'shoes']);
    expect(ok(mapFeedCategory({ googleCategory: '', productTypes: ['Aksesuar > Çantalar'] })))
      .toEqual(['bags', 'canta', 'bag']);
  });

  it('maps English product_type and Google text paths', () => {
    expect(ok(mapFeedCategory({ googleCategory: '', productTypes: ['Men > Clothing > Jeans'] })))
      .toEqual(['lower_body', 'jean', 'bottom']);
    expect(ok(mapFeedCategory({ googleCategory: 'Apparel & Accessories > Clothing > Dresses', productTypes: [] })))
      .toEqual(['dresses', 'elbise', 'one_piece']);
    expect(ok(mapFeedCategory({ googleCategory: 'Apparel & Accessories > Clothing > Shirts & Tops', productTypes: [] })))
      .toEqual(['upper_body', null, 'top']);
    expect(ok(mapFeedCategory({
      googleCategory: 'Apparel & Accessories > Handbags, Wallets & Cases > Handbags', productTypes: [],
    }))).toEqual(['bags', 'canta', 'bag']);
    expect(ok(mapFeedCategory({ googleCategory: '', productTypes: ['Women > Skirts'] })))
      .toEqual(['lower_body', 'etek', 'bottom']);
  });

  it('maps known Google category ids', () => {
    expect(ok(mapFeedCategory({ googleCategory: '2271', productTypes: [] }))).toEqual(['dresses', 'elbise', 'one_piece']);
    expect(ok(mapFeedCategory({ googleCategory: '212', productTypes: [] }))).toEqual(['upper_body', null, 'top']);
  });

  it('refines a generic google category with a specific product_type', () => {
    expect(ok(mapFeedCategory({
      googleCategory: 'Apparel & Accessories > Clothing > Shirts & Tops',
      productTypes: ['Giyim > Üst Giyim > Tişört'],
    }))).toEqual(['upper_body', 'tisort', 'top']);
  });

  it('does not match short keys inside longer words', () => {
    expect(mapFeedCategory({ googleCategory: '', productTypes: ['Short Sleeve Shirts'] }))
      .toMatchObject({ ok: true, category: 'upper_body', subcategory: 'gomlek' });
    expect(mapFeedCategory({ googleCategory: '', productTypes: ['Bikini Top'] }))
      .toMatchObject({ ok: false, reason: 'unsupported_category' });
  });

  it('rejects instead of guessing', () => {
    expect(mapFeedCategory({ googleCategory: '', productTypes: ['Ev Tekstili > Havlu'] }))
      .toEqual({ ok: false, reason: 'unmapped_category', key: 'havlu' });
    expect(mapFeedCategory({ googleCategory: 'Apparel & Accessories > Clothing > Swimwear', productTypes: [] }))
      .toMatchObject({ ok: false, reason: 'unsupported_category' });
    expect(mapFeedCategory({ googleCategory: '999999', productTypes: [] }))
      .toEqual({ ok: false, reason: 'unmapped_category', key: '999999' });
    expect(mapFeedCategory({ googleCategory: '', productTypes: [] }))
      .toEqual({ ok: false, reason: 'unmapped_category', key: '' });
  });

  it('rejects contradicting product_type and google category', () => {
    expect(mapFeedCategory({
      googleCategory: 'Apparel & Accessories > Clothing > Dresses',
      productTypes: ['Ayakkabı > Sneaker'],
    })).toMatchObject({ ok: false, reason: 'category_conflict' });
  });
});

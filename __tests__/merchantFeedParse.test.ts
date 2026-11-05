import { readFileSync } from 'node:fs';
import path from 'node:path';
import { field, fieldAll, parseMerchantFeed } from '../scripts/lib/merchantFeed/parse';

const fixture = (name: string): string =>
  readFileSync(path.join(__dirname, '..', 'tests', 'fixtures', 'merchantFeed', name), 'utf8');

describe('parseMerchantFeed', () => {
  it('reads RSS 2.0 g: namespace items', () => {
    const feed = parseMerchantFeed(fixture('rss-full.xml'));
    expect(feed.format).toBe('rss');
    expect(feed.items).toHaveLength(24);
    const dress = feed.items.find((item) => field(item, 'id') === 'D2001')!;
    expect(field(dress, 'title')).toBe('Çiçek Desenli Midi Elbise');
    expect(field(dress, 'link')).toBe('https://www.ornekmarka.example/urun/cicek-desenli-midi-elbise');
    expect(fieldAll(dress, 'additional_image_link')).toHaveLength(2);
    expect(field(dress, 'price')).toBe('1.299,00 TRY');
    expect(field(dress, 'google_product_category')).toBe('2271');
  });

  it('keeps ids as strings and repeated size tags as lists', () => {
    const feed = parseMerchantFeed(fixture('rss-full.xml'));
    const shoe = feed.items.find((item) => field(item, 'id') === 'S9001')!;
    expect(fieldAll(shoe, 'size')).toEqual(['40', '41', '42']);
  });

  it('decodes entities in category paths', () => {
    const feed = parseMerchantFeed(fixture('rss-full.xml'));
    const tee = feed.items.find((item) => field(item, 'id') === 'TS1-SYH-S')!;
    expect(field(tee, 'google_product_category')).toBe('Apparel & Accessories > Clothing > Shirts & Tops');
  });

  it('reads Atom entries including link href attributes', () => {
    const feed = parseMerchantFeed(fixture('atom-basic.xml'));
    expect(feed.format).toBe('atom');
    expect(feed.items).toHaveLength(2);
    expect(field(feed.items[0], 'link')).toBe('https://www.ornekmarka.example/urun/kruvaze-blazer-ceket?utm=x');
    expect(field(feed.items[1], 'link')).toBe('https://www.ornekmarka.example/urun/deri-omuz-cantasi');
    expect(field(feed.items[0], 'sale_price')).toBe('1.999,00 TRY');
  });

  it('handles a single item and rejects non-feed XML', () => {
    const one = '<rss xmlns:g="http://base.google.com/ns/1.0"><channel><item><g:id>1</g:id></item></channel></rss>';
    expect(parseMerchantFeed(one).items).toHaveLength(1);
    expect(() => parseMerchantFeed('<html><body/></html>')).toThrow('invalid_feed');
    expect(() => parseMerchantFeed('not xml at all')).toThrow('invalid_feed');
  });
});

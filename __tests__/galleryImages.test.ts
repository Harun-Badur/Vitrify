import {
  extractFloImages,
  extractLcwImages,
  imageKey,
  isRejectedImage,
  matchMainFormat,
  planProductImages,
} from '../scripts/variants/galleryImages';

const FLO_MAIN = 'https://floimages.mncdn.com/media/catalog/product/26-06/29/102695491_f2.jpg';
const floCand = (n: number) =>
  `https://floimages.mncdn.com/mnresize/600/-/media/catalog/product/26-06/29/102695491_d${n}-17.jpg?w=600`;

describe('galleryImages', () => {
  it('normalizes FLO mnresize URLs to the plain DB main-image format', () => {
    expect(matchMainFormat(floCand(1), FLO_MAIN)).toBe(
      'https://floimages.mncdn.com/media/catalog/product/26-06/29/102695491_d1-17.jpg',
    );
    // main already mnresize -> keep candidate untouched
    const resized = 'https://floimages.mncdn.com/mnresize/600/-/media/catalog/product/a/102695491_f2.jpg?w=600';
    expect(matchMainFormat(floCand(1), resized)).toBe(floCand(1));
    // LCW main is mnpadding: candidate is already the same format
    const lcw = 'https://img-lcwaikiki.mncdn.com/mnpadding/1020/1360/ffffff/pim/productimages/1/2/v4/l_a.jpg';
    expect(matchMainFormat(lcw.replace('v4/l_a', 'v5/l_b'), lcw)).toBe(lcw.replace('v4/l_a', 'v5/l_b'));
  });

  it('dedupes by file name and keeps the DB main image first', () => {
    const plan = planProductImages({
      id: 'flo-102695491',
      mainImage: FLO_MAIN,
      dbImages: [FLO_MAIN],
      found: [floCand(1), floCand(1), FLO_MAIN + '?w=600', floCand(2)],
    });
    expect(plan.skipped).toBeNull();
    expect(plan.images).toEqual([FLO_MAIN, matchMainFormat(floCand(1), FLO_MAIN), matchMainFormat(floCand(2), FLO_MAIN)]);
    expect(plan.added).toBe(2);
  });

  it('skips a product with more than 12 candidates as noise', () => {
    const found = Array.from({ length: 13 }, (_, i) => floCand(i + 1));
    const plan = planProductImages({ id: 'x', mainImage: FLO_MAIN, dbImages: [FLO_MAIN], found });
    expect(plan.skipped).toBe('noise');
    expect(plan.images).toBeNull();
    expect(planProductImages({ id: 'x', mainImage: FLO_MAIN, dbImages: [FLO_MAIN], found: found.slice(0, 12) }).skipped).toBeNull();
  });

  it('caps at 8 images including the main one and rejects junk', () => {
    const found = Array.from({ length: 12 }, (_, i) => floCand(i + 1));
    const plan = planProductImages({ id: 'x', mainImage: FLO_MAIN, dbImages: [FLO_MAIN], found });
    expect(plan.images).toHaveLength(8);
    expect(plan.images?.[0]).toBe(FLO_MAIN);
    for (const u of ['https://a.com/logo.png', 'https://a.com/x.svg', 'https://a.com/banner-1.jpg', 'https://a.com/icon.jpg', 'https://a.com/visa-odeme.png', 'https://a.com/swatch_1.jpg']) {
      expect(isRejectedImage(u)).toBe(true);
    }
    expect(isRejectedImage(floCand(1))).toBe(false);
    expect(imageKey('https://a.com/p/X_1.JPG?w=600')).toBe('x_1.jpg');
  });

  it('returns no change when nothing new is found', () => {
    const plan = planProductImages({ id: 'x', mainImage: FLO_MAIN, dbImages: [FLO_MAIN], found: [FLO_MAIN] });
    expect(plan.images).toBeNull();
    expect(plan.added).toBe(0);
  });

  it('extracts only JSON-LD Product.image for LCW and code-matching data-src for FLO', () => {
    const lcw = `<html><head><script type="application/ld+json">{"@type":"Product","image":["https://i/a.jpg","https://i/b.jpg"]}</script></head><body><img src="https://i/noise.jpg"></body></html>`;
    expect(extractLcwImages(lcw)).toEqual(['https://i/a.jpg', 'https://i/b.jpg']);
    const flo = `<img data-type="d1" data-src="https://floimages.mncdn.com/mnresize/600/-/media/p/102695491_d1-1.jpg">
      <img data-type="d2" data-src="https://floimages.mncdn.com/mnresize/600/-/media/p/999999999_d2-1.jpg">
      <img data-type="x" data-src="https://floimages.mncdn.com/media/p/102695491_x.jpg"><img src="https://floimages.mncdn.com/media/p/102695491_z.jpg">`;
    expect(extractFloImages(flo, '102695491')).toEqual(['https://floimages.mncdn.com/mnresize/600/-/media/p/102695491_d1-1.jpg']);
  });
});

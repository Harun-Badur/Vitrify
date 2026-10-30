import { parseFlo } from '../scripts/variants/parsers/flo';
import { parseLcw } from '../scripts/variants/parsers/lcw';

const LCW_URL = 'https://www.lcw.com/chino-siyah-o-4275208';
const FLO_URL = 'https://www.flo.com.tr/urun/sneaker-101909425';

const LCW_HTML = `<html><head><script type="application/ld+json">
{"@type":"Product","color":"Siyah","size":["30","32"]}</script></head><body>
<a href="/chino-siyah-o-4275208" class="product-detail-colors__option product-detail-colors__option--active" aria-label="Yeni Siyah (Selected)"><img src="https://img.test/a.jpg"></a>
<a href="/chino-lacivert-o-5261159" class="product-detail-colors__option" aria-label="Lacivert"><img src="https://img.test/b.jpg"></a>
<button data-label="30" class="option-size-box"> 30 </button>
<button data-label="32" class="option-size-box option-size-box__out-of-stock" disabled> 32 </button>
</body></html>`;

const flo = (cls: string, v: string, id: string): string =>
  `<div class="detail__sizes-item"><input id="${id}" type="radio" class="js-product-size-input ${cls} hidden" value="${v}"></div>`;

const FLO_HTML = `<html><body>
<div class="detail__section--color"><strong class="detail__section-title--value">Beyaz</strong></div>
<div class="detail__colors">
<a href="/urun/sneaker-101909426" class="detail__colors-item "><img class="detail__colors-image" src="https://img.test/c.jpg" alt="Color 101909426"></a>
<a href="/urun/sneaker-101909425" class="detail__colors-item active"><img class="detail__colors-image" src="https://img.test/d.jpg" alt="Color 101909425"></a>
</div>
<div class="detail__sizes">
${flo('js-product-size-input-not-sticky not-stock', '36', 'sizeSelection0')}
${flo('js-product-size-input-not-sticky', '37', 'sizeSelection1')}
${flo('not-stock', '36', 'sizeSelection-sticky0')}
${flo('', '37', 'sizeSelection-sticky1')}
</div>
<div class="other-card">${flo('', '101972231001', 'card0')}</div>
<input type="radio" name="in-stock" data-value="36" class="js-select-product-size">
</body></html>`;

describe('parseLcw', () => {
  it('reads colors, sizes and stock from the DOM', () => {
    const r = parseLcw(LCW_HTML, LCW_URL);
    expect(r.colors).toEqual([
      { name: 'Yeni Siyah', url: 'https://www.lcw.com/chino-siyah-o-4275208', imageUrl: 'https://img.test/a.jpg' },
      { name: 'Lacivert', url: 'https://www.lcw.com/chino-lacivert-o-5261159', imageUrl: 'https://img.test/b.jpg' },
    ]);
    expect(r.sizes).toEqual([
      { label: '30', inStock: true },
      { label: '32', inStock: false },
    ]);
  });

  it('falls back to JSON-LD without stock info', () => {
    const html = '<script type="application/ld+json">{"@type":"Product","color":"Beyaz","size":["38","39"]}</script>';
    const r = parseLcw(html, LCW_URL);
    expect(r.sizes).toEqual([{ label: '38' }, { label: '39' }]);
    expect(r.colors).toEqual([{ name: 'Beyaz', url: LCW_URL }]);
  });

  it('returns empty for unrelated pages', () => {
    expect(parseLcw('<html></html>', LCW_URL)).toEqual({ colors: [], sizes: [] });
  });
});

describe('parseFlo', () => {
  it('dedupes sizes (main vs sticky copy) and maps not-stock', () => {
    const r = parseFlo(FLO_HTML, FLO_URL);
    expect(r.sizes).toEqual([
      { label: '36', inStock: false },
      { label: '37', inStock: true },
    ]);
  });

  it('names only the active color; others keep an empty name', () => {
    const r = parseFlo(FLO_HTML, FLO_URL);
    expect(r.colors).toEqual([
      { name: '', url: 'https://www.flo.com.tr/urun/sneaker-101909426', imageUrl: 'https://img.test/c.jpg' },
      { name: 'Beyaz', url: 'https://www.flo.com.tr/urun/sneaker-101909425', imageUrl: 'https://img.test/d.jpg' },
    ]);
  });

  it('returns empty for unrelated pages', () => {
    expect(parseFlo('<html></html>', FLO_URL)).toEqual({ colors: [], sizes: [] });
  });
});

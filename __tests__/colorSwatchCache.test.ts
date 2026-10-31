import { resolveSwatch } from '../lib/colorSwatch';

describe('resolveSwatch cache', () => {
  it('returns the same swatch on repeated lookups and keeps unknown names on the image path', () => {
    for (const name of ['Beyaz', 'SİYAH', ' Lacivert ', 'bej', 'Çok Renkli', '', 'Bilinmeyen']) {
      const first = resolveSwatch(name);
      expect(resolveSwatch(name)).toEqual(first);
    }
    expect(resolveSwatch(null)).toEqual({ kind: 'image' });
    expect(resolveSwatch(undefined)).toEqual({ kind: 'image' });
    expect(resolveSwatch('Beyaz')).toMatchObject({ kind: 'hex', light: true });
    expect(resolveSwatch('Siyah')).toMatchObject({ kind: 'hex', light: false });
    expect(resolveSwatch('Çok Renkli')).toEqual({ kind: 'image' });
  });
});

import { stripBrandPrefix } from '../lib/productTitle';

describe('stripBrandPrefix', () => {
  it('cuts the brand and leading separators', () => {
    expect(stripBrandPrefix('Butigo FOLDAWAY BAG 5PR Siyah', 'Butigo')).toBe('FOLDAWAY BAG 5PR Siyah');
    expect(stripBrandPrefix('Butigo - Omuz Çantası', 'Butigo')).toBe('Omuz Çantası');
    expect(stripBrandPrefix('Butigo: Omuz Çantası', 'Butigo')).toBe('Omuz Çantası');
  });

  it('ignores case differences', () => {
    expect(stripBrandPrefix('BUTIGO foldaway bag', 'Butigo')).toBe('foldaway bag');
    expect(stripBrandPrefix('butigo foldaway bag', 'BUTİGO')).toBe('foldaway bag');
  });

  it('ignores the Turkish dotted/dotless i difference', () => {
    expect(stripBrandPrefix('BUTİGO Omuz Çantası', 'Butigo')).toBe('Omuz Çantası');
    expect(stripBrandPrefix('Butigo Omuz Çantası', 'BUTİGO')).toBe('Omuz Çantası');
    expect(stripBrandPrefix('Iıİi Kadın Elbise', 'iiii')).toBe('Kadın Elbise');
  });

  it('leaves titles alone when they do not start with the brand', () => {
    expect(stripBrandPrefix('Omuz Çantası Butigo', 'Butigo')).toBe('Omuz Çantası Butigo');
    expect(stripBrandPrefix('Butigoz Çanta', 'Butigo')).toBe('Butigoz Çanta');
  });

  it('keeps the title when the brand is missing', () => {
    expect(stripBrandPrefix('Omuz Çantası', '')).toBe('Omuz Çantası');
    expect(stripBrandPrefix('Omuz Çantası', '   ')).toBe('Omuz Çantası');
    expect(stripBrandPrefix('Omuz Çantası', null)).toBe('Omuz Çantası');
    expect(stripBrandPrefix('Omuz Çantası', undefined)).toBe('Omuz Çantası');
  });

  it('keeps the original when the title is only the brand', () => {
    expect(stripBrandPrefix('Butigo', 'Butigo')).toBe('Butigo');
    expect(stripBrandPrefix('BUTİGO - ', 'Butigo')).toBe('BUTİGO - ');
  });
});

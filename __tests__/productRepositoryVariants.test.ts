import { productsById } from '../services/productRepository';
import { getSupabaseClient } from '../lib/supabase';

jest.mock('../lib/supabase', () => ({ getSupabaseClient: jest.fn() }));

describe('productRepository variant columns', () => {
  it('selects and maps color_variants/size_options for recs-feed resolved products', async () => {
    const selects: string[] = [];
    const row = {
      id: 'variant-1', provider: 'lcw', external_id: 'e1', title: 'Tüvit Ceket', brand: 'LCW', price: 100,
      currency: 'TRY', affiliate_url: null, image_url: 'https://c/a.jpg', product_url: 'https://s/a', category: 'upper_body',
      color_variants: [{ name: 'Siyah', url: 'https://s/b', imageUrl: 'https://c/b.jpg' }],
      size_options: [{ label: 'M', inStock: false }],
      variants_fetched_at: '2026-10-30T00:00:00Z',
    };
    const client = {
      from: (table: string) => ({
        select: (columns: string) => {
          if (table === 'products') selects.push(columns);
          return { in: async () => ({ data: table === 'products' ? [row] : [], error: null }) };
        },
      }),
    };
    jest.mocked(getSupabaseClient).mockReturnValue(client as never);
    const product = (await productsById(['variant-1'])).get('variant-1');
    expect(selects[0]).toEqual(expect.stringContaining('color_variants, size_options, variants_fetched_at'));
    expect(product?.colorVariants).toEqual(row.color_variants);
    expect(product?.sizeOptions).toEqual(row.size_options);
  });
});

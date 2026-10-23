import { logger } from '../lib/logger';
import { getSupabaseClient } from '../lib/supabase';
import { mapFeedRow } from '../services/catalogProductAdapter';
import { getProductRepository, ProductRepository, productsById } from '../services/productRepository';
import {
  buildProductIntelligence,
  productIntelligenceInputFromContext,
  type ProductSemanticAttributeRow,
} from '../src/intelligence/product/productIntelligence';
import { enrichProduct } from '../src/intelligence/style/productStyle';
import type { FeedProductRow, Product } from '../types/product';

jest.mock('../lib/supabase', () => ({ getSupabaseClient: jest.fn() }));

const BASE_COLUMNS = 'product_id, gender, colors, fit, subcategory, brand_slug, price_band';
const UNKNOWN = { value: null, origin: 'unknown', source: 'unknown', confidence: 'unknown' } as const;

interface QueryResponse {
  data: unknown[] | null;
  error: { message: string } | null;
}

const productRow: FeedProductRow = {
  id: 'p1', provider: 'defacto', external_id: '1', title: 'Kadın Siyah Oversize Gömlek', brand: 'Brand',
  price: 100, currency: 'TRY', image_url: 'p1.jpg', product_url: 'https://example.com/p1',
  category: 'upper_body', affiliate_url: null,
};

const semanticRow = (): ProductSemanticAttributeRow => ({
  product_id: 'p1', gender: 'men', colors: ['beyaz'], fit: null, subcategory: null, brand_slug: null,
  price_band: null, outfit_role: 'top', material: 'keten', season: 'yaz', occasion: 'ofis', style_tags: ['minimal'],
});

type OptionalAttributeColumn = 'outfit_role' | 'material' | 'season' | 'occasion' | 'style_tags';

const withoutColumns = (
  row: ProductSemanticAttributeRow,
  columns: readonly OptionalAttributeColumn[],
): ProductSemanticAttributeRow => {
  const copy: ProductSemanticAttributeRow = { ...row };
  for (const column of columns) delete copy[column];
  return copy;
};

const SEMANTIC_KEYS: readonly OptionalAttributeColumn[] = ['material', 'season', 'occasion', 'style_tags'];

/** Each attribute query receives the selected column list, mirroring PostgREST column errors. */
const installClient = (respond: (columns: string) => QueryResponse): string[] => {
  const attributeSelects: string[] = [];
  const client = {
    from: (table: string) => ({
      select: (columns: string) => ({
        in: async (): Promise<QueryResponse> => {
          if (table === 'products') return { data: [productRow], error: null };
          attributeSelects.push(columns);
          return respond(columns);
        },
      }),
    }),
  };
  jest.mocked(getSupabaseClient).mockReturnValue(client as never);
  return attributeSelects;
};

const baseProduct = (): Product => {
  const product = mapFeedRow(productRow);
  if (!product) throw new Error('fixture row must map');
  return product;
};

const load = async (): Promise<Product> => {
  const product = (await productsById(['p1'])).get('p1');
  if (!product) throw new Error('product was not resolved');
  return product;
};

const intelligenceFor = (product: Product) =>
  buildProductIntelligence(productIntelligenceInputFromContext(product, getProductRepository().attributeContext(product.id)));

afterEach(() => jest.restoreAllMocks());

describe('ProductRepository attribute context', () => {
  it('loads semantic columns into the context without changing the Product shape', async () => {
    const raw = semanticRow();
    const selects = installClient(() => ({ data: [raw], error: null }));
    const product = await load();

    expect(selects).toEqual([`${BASE_COLUMNS}, outfit_role, material, season, occasion, style_tags`]);
    const legacy = enrichProduct(baseProduct(), withoutColumns(raw, SEMANTIC_KEYS));
    expect(product).toEqual(legacy);
    expect(Object.keys(product).sort()).toEqual(Object.keys(legacy).sort());
    for (const key of [...SEMANTIC_KEYS, 'styleTags', 'attributes']) expect(product).not.toHaveProperty(key);

    expect(getProductRepository().attributeContext('p1')).toEqual({
      productId: 'p1', status: 'loaded', attributes: raw, semanticColumns: 'loaded',
    });
  });

  it('hands raw evidence to buildProductIntelligence with provenance and conflicts intact', async () => {
    const raw = semanticRow();
    installClient(() => ({ data: [raw], error: null }));
    const product = await load();
    const bridged = intelligenceFor(product);

    expect(bridged).toEqual(buildProductIntelligence({ product: baseProduct(), attributes: raw }));
    const declared = { origin: 'declared', source: 'catalog_attribute', confidence: 'unknown' };
    expect(bridged.season).toEqual({ value: 'yaz', ...declared });
    expect(bridged.occasion).toEqual({ value: 'ofis', ...declared });
    expect(bridged.material).toEqual({ value: 'keten', ...declared });
    expect(bridged.styleTags).toEqual([{ value: 'minimal', ...declared }]);
    expect(bridged.role).toEqual({ value: 'top', ...declared });
    expect(bridged.gender.value).toBe('men');
    expect(bridged.conflicts).toEqual(expect.arrayContaining([
      { field: 'gender', code: 'declared_inferred_mismatch', values: ['men', 'women'] },
      { field: 'colors', code: 'declared_inferred_mismatch', values: ['beyaz', 'siyah'] },
    ]));
  });

  it('falls back when semantic columns are missing and keeps them unknown', async () => {
    const raw = withoutColumns(semanticRow(), SEMANTIC_KEYS);
    const selects = installClient(columns => columns.includes('season')
      ? { data: null, error: { message: 'column product_attributes.season does not exist' } }
      : { data: [raw], error: null });
    const product = await load();

    expect(selects).toEqual([`${BASE_COLUMNS}, outfit_role, material, season, occasion, style_tags`, `${BASE_COLUMNS}, outfit_role`]);
    expect(getProductRepository().attributeContext('p1')).toMatchObject({ status: 'loaded', semanticColumns: 'unavailable' });
    expect(product).toEqual(enrichProduct(baseProduct(), raw));
    expect(intelligenceFor(product)).toMatchObject({
      season: UNKNOWN, occasion: UNKNOWN, material: UNKNOWN, styleTags: [],
      role: { value: 'top', source: 'catalog_attribute' },
    });
  });

  it.each([
    ['semantic first', /season/, 'column product_attributes.season does not exist', 'column product_attributes.outfit_role does not exist'],
    ['outfit_role first', /outfit_role/, 'column product_attributes.outfit_role does not exist', 'column product_attributes.material does not exist'],
  ])('drops both optional column groups when each is reported missing (%s)', async (_label, firstPattern, first, second) => {
    const raw = withoutColumns(semanticRow(), [...SEMANTIC_KEYS, 'outfit_role']);
    const selects = installClient(columns => {
      if (firstPattern.test(columns)) return { data: null, error: { message: first } };
      if (columns !== BASE_COLUMNS) return { data: null, error: { message: second } };
      return { data: [raw], error: null };
    });
    const product = await load();

    expect(selects).toHaveLength(3);
    expect(selects.at(-1)).toBe(BASE_COLUMNS);
    expect(getProductRepository().attributeContext('p1')).toMatchObject({ status: 'loaded', semanticColumns: 'unavailable' });
    expect(product.outfitRole).toBe('top');
    expect(intelligenceFor(product).role).toMatchObject({ value: 'top', source: 'category_rule', confidence: 'low' });
  });

  it('logs other attribute errors, records them and does not retry or guess', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const selects = installClient(() => ({ data: null, error: { message: 'permission denied for table product_attributes' } }));
    const product = await load();

    expect(selects).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('product_attributes'), {
      error: 'permission denied for table product_attributes', count: 1,
    });
    expect(product).toEqual(enrichProduct(baseProduct(), undefined));
    expect(getProductRepository().attributeContext('p1')).toEqual({
      productId: 'p1', status: 'error', attributes: null, semanticColumns: 'loaded',
    });
    const intelligence = intelligenceFor(product);
    expect(intelligence).toMatchObject({ season: UNKNOWN, occasion: UNKNOWN, material: UNKNOWN, styleTags: [] });
    expect(intelligence.gender).toMatchObject({ value: 'women', source: 'title_inferred', confidence: 'low' });
  });

  it('records absent rows and keeps role provenance from the category, not the enriched snapshot', async () => {
    installClient(() => ({ data: [], error: null }));
    const product = await load();

    expect(product.outfitRole).toBe('top');
    expect(getProductRepository().attributeContext('p1')).toEqual({
      productId: 'p1', status: 'absent', attributes: null, semanticColumns: 'loaded',
    });
    const intelligence = intelligenceFor(product);
    expect(intelligence.role).toEqual({ value: 'top', origin: 'derived', source: 'category_rule', confidence: 'low' });
    expect(intelligence).toMatchObject({ season: UNKNOWN, occasion: UNKNOWN, material: UNKNOWN, styleTags: [] });
  });

  it('stores an immutable copy of the raw row', async () => {
    const raw = semanticRow();
    installClient(() => ({ data: [raw], error: null }));
    await load();
    raw.season = 'kış';
    const context = getProductRepository().attributeContext('p1');
    expect(context?.attributes?.season).toBe('yaz');
    expect(Object.isFrozen(context?.attributes)).toBe(true);
  });
});

describe('ProductRepository attribute context lifecycle', () => {
  it('has no context for products registered without a load and is reset with the client', async () => {
    installClient(() => ({ data: [semanticRow()], error: null }));
    await load();
    expect(getProductRepository().attributeContext('p1')?.status).toBe('loaded');

    installClient(() => ({ data: [semanticRow()], error: null }));
    const repository = getProductRepository();
    expect(repository.attributeContext('p1')).toBeUndefined();
    repository.register([baseProduct()]);
    await repository.productsById(['p1']);
    expect(repository.attributeContext('p1')).toBeUndefined();
    expect(intelligenceFor(baseProduct())).toMatchObject({ season: UNKNOWN, styleTags: [] });
  });

  it('keeps array-returning loaders working without attribute context', async () => {
    const product = baseProduct();
    const repository = new ProductRepository(async () => [product]);
    expect((await repository.productsById(['p1'])).get('p1')).toBe(product);
    expect(repository.attributeContext('p1')).toBeUndefined();
  });

  it('records contexts from loaders that return them, alongside canonical identity', async () => {
    const product = baseProduct();
    const context = { productId: 'p1', status: 'absent', attributes: null, semanticColumns: 'loaded' } as const;
    const repository = new ProductRepository(async () => ({ products: [product], attributeContexts: [context] }));
    const first = await repository.productsById(['p1']);
    expect(first.get('p1')).toBe(product);
    expect(repository.attributeContext('p1')).toBe(context);
  });
});

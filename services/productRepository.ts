import type { Product } from '../types/product';
import { logger } from '../lib/logger';
import { getSupabaseClient } from '../lib/supabase';
import type { ProductAttributeContext, ProductSemanticAttributeRow } from '../src/intelligence/product/productIntelligence';
import { enrichProduct } from '../src/intelligence/style/productStyle';
import { isAttributeRow, isFeedProductRow, mapFeedRow } from './catalogProductAdapter';

export interface ProductRepositoryLoad {
  products: readonly Product[];
  attributeContexts: readonly ProductAttributeContext[];
}

type ProductLoader = (ids: readonly string[]) => Promise<readonly Product[] | ProductRepositoryLoad>;

/** Identity map for products-table records. Recommendation metadata lives outside it. */
export class ProductRepository {
  private readonly products = new Map<string, Product>();
  private readonly attributeContexts = new Map<string, ProductAttributeContext>();
  private readonly pending = new Map<string, Promise<void>>();

  constructor(private readonly load: ProductLoader) {}

  /** Raw attribute evidence for products this repository loaded; reading never fetches. */
  attributeContext(id: string): ProductAttributeContext | undefined {
    return this.attributeContexts.get(id);
  }

  /** Register only authoritative catalog records; refresh data without replacing identity. */
  register(products: readonly Product[]): Product[] {
    return products.map(product => {
      const canonical = this.products.get(product.id);
      if (!canonical) {
        this.products.set(product.id, product);
        return product;
      }
      if (canonical !== product) {
        for (const key of Object.keys(canonical) as (keyof Product)[]) {
          if (!Object.hasOwn(product, key)) delete canonical[key];
        }
        Object.assign(canonical, product);
      }
      return canonical;
    });
  }

  /** One batched fetch for misses, including coalescing overlapping concurrent requests. */
  async productsById(ids: readonly string[]): Promise<ReadonlyMap<string, Product>> {
    const unique = [...new Set(ids)];
    const missing = unique.filter(id => !this.products.has(id) && !this.pending.has(id));
    if (missing.length > 0) {
      const request = Promise.resolve().then(() => this.load(missing)).then(result => {
        if ('products' in result) {
          this.register(result.products);
          for (const context of result.attributeContexts) this.attributeContexts.set(context.productId, context);
        } else this.register(result);
      }).finally(() => {
        for (const id of missing) if (this.pending.get(id) === request) this.pending.delete(id);
      });
      for (const id of missing) this.pending.set(id, request);
    }
    await Promise.all(unique.flatMap(id => this.pending.has(id) ? [this.pending.get(id)!] : []));
    return new Map(unique.flatMap(id => {
      const product = this.products.get(id);
      return product ? [[id, product] as const] : [];
    }));
  }
}

type Client = ReturnType<typeof getSupabaseClient>;
type QueryResult = { data: unknown[] | null; error: { message: string } | null };
let repositoryClient: Client;
let repository: ProductRepository | undefined;

export function getProductRepository(): ProductRepository {
  const client = getSupabaseClient();
  if (!repository || repositoryClient !== client) {
    repositoryClient = client;
    repository = new ProductRepository(ids => loadProductsById(client, ids));
  }
  return repository;
}

/** Shared bulk resolver; never reads product snapshots from recommendation payloads. */
export const productsById = (ids: readonly string[]): Promise<ReadonlyMap<string, Product>> =>
  getProductRepository().productsById(ids);

const ATTRIBUTE_COLUMNS = 'product_id, gender, colors, fit, subcategory, brand_slug, price_band';
const SEMANTIC_ATTRIBUTE_COLUMNS = ', material, season, occasion, style_tags';
const MISSING_SEMANTIC_COLUMN = /column .*(material|season|occasion|style_tags).* does not exist/i;
const MISSING_OUTFIT_ROLE_COLUMN = /column .*outfit_role.* does not exist/i;

interface AttributeRowsResult {
  result: QueryResult;
  semanticColumns: ProductAttributeContext['semanticColumns'];
}

/** Drops only a reported-missing optional column group; any other error is returned. */
async function loadAttributeRows(client: NonNullable<Client>, ids: readonly string[]): Promise<AttributeRowsResult> {
  let withOutfitRole = true;
  let withSemantic = true;
  const query = async (): Promise<QueryResult> => client.from('product_attributes')
    .select(`${ATTRIBUTE_COLUMNS}${withOutfitRole ? ', outfit_role' : ''}${withSemantic ? SEMANTIC_ATTRIBUTE_COLUMNS : ''}`)
    .in('product_id', ids);
  let result = await query();
  while (result.error) {
    if (withSemantic && MISSING_SEMANTIC_COLUMN.test(result.error.message)) withSemantic = false;
    else if (withOutfitRole && MISSING_OUTFIT_ROLE_COLUMN.test(result.error.message)) withOutfitRole = false;
    else break;
    result = await query();
  }
  return { result, semanticColumns: withSemantic ? 'loaded' : 'unavailable' };
}

async function loadProductsById(client: Client, ids: readonly string[]): Promise<ProductRepositoryLoad> {
  if (!client) throw new Error('Supabase bağlantısı yok');
  const products: Product[] = [];
  const attributeContexts: ProductAttributeContext[] = [];
  // Bound query URLs without changing the Discover candidate pool or pagination.
  for (let offset = 0; offset < ids.length; offset += 80) {
    const batch = ids.slice(offset, offset + 80);
    const columns = 'id, provider, external_id, title, brand, price, current_price, previous_price, last_price_checked_at, currency, image_url, images, product_url, category, affiliate_url, colors, sizes, created_at, feed_eligible';
    let result: QueryResult = await client.from('products').select(columns).in('id', batch);
    if (result.error && /column .*images.* does not exist/i.test(result.error.message)) {
      result = await client.from('products').select(columns.replace(', images', '')).in('id', batch);
    }
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data ?? []).filter(isFeedProductRow);
    if (rows.length === 0) continue;
    const { result: attributes, semanticColumns } = await loadAttributeRows(client, rows.map(row => row.id));
    if (attributes.error) {
      // Product resolution keeps its title-only fallback; the context records the failure.
      logger.warn('product_attributes okunamadı; ürünler attribute olmadan hazırlanıyor', {
        error: attributes.error.message, count: rows.length,
      });
    }
    const attributesById = new Map<string, ProductSemanticAttributeRow>(
      (attributes.data ?? []).filter(isAttributeRow).map(row => [row.product_id, row]),
    );
    for (const row of rows) {
      const product = mapFeedRow(row);
      if (!product) continue;
      const attribute = attributesById.get(product.id);
      products.push(enrichProduct(product, attribute));
      attributeContexts.push({
        productId: product.id,
        status: attributes.error ? 'error' : attribute ? 'loaded' : 'absent',
        attributes: attribute ? Object.freeze({ ...attribute }) : null,
        semanticColumns,
      });
    }
  }
  return { products, attributeContexts };
}

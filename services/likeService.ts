import { logger } from '../lib/logger';
import { getRequiredSupabaseClient } from '../lib/supabase';
import { isPreferenceV2Enabled } from '../lib/preferenceFeatureFlags';
import { createAnalyticsAction } from '../lib/analyticsAction';
import { applyPreferenceTransaction } from './preferenceTransactionAdapter';
import {listPreferenceRequests} from '../lib/preferenceRequestJournal';
import type { AnalyticsActionContext } from '../types/analytics';
import type { PreferenceWriteReceipt } from '../types/preferenceTransaction';
import { isFeedProductRow, mapFeedRow } from './catalogProductAdapter';
import type { AuthUser } from '../types/auth';
import {
  isProductSnapshot,
  isFeedProvider,
  type LikedProduct,
  type Product,
} from '../types/product';

interface LikedProductRow {
  product_id: string;
  product_snapshot: unknown;
  liked_at: string;
  notify_on_price_drop?: boolean | null;
}

interface PassedProductRow {
  product_id: string;
}

// Order pass/undo/like for the same owner's product. Different owners never share a queue.
const productWrites = new Map<string, Promise<unknown>>();
const ownerWriteVersions = new Map<string, number>();
const pendingOwnerWrites = (owner: string) => [...productWrites]
  .filter(([key]) => JSON.parse(key)[0] === owner).map(([,promise]) => promise);
function orderedProductWrite<T>(userId: string, productId: string,
  write: (client: ReturnType<typeof getRequiredSupabaseClient>) => Promise<T>): Promise<T> {
  const key = JSON.stringify([userId, productId]);
  const client = getRequiredSupabaseClient();
  ownerWriteVersions.set(userId,(ownerWriteVersions.get(userId) ?? 0) + 1);
  const request = (productWrites.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const auth = await client.auth.getUser();
    if (auth.error || auth.data.user?.id !== userId) throw new Error('Ürün işlemi için oturum değişti.');
    return write(client);
  });
  productWrites.set(key, request);
  void request.then(() => { if (productWrites.get(key) === request) productWrites.delete(key); },
    () => { if (productWrites.get(key) === request) productWrites.delete(key); });
  return request;
}

export type LikedProductsResult = LikedProduct[] & { warning?: 'METADATA_SNAPSHOT_ONLY' };
export class LikeWriteError extends Error {
  constructor(public readonly likeCommitted: boolean) {
    super('Beğeni kaydedildi ancak geçme kaydı temizlenemedi. Tekrar dene.');
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toSnapshot = (product: Product): Product => ({
  id: product.id,
  imageUrl: product.imageUrl,
  title: product.title,
  price: product.price,
  currentPrice: product.currentPrice,
  previousPrice: product.previousPrice,
  lastPriceCheckedAt: product.lastPriceCheckedAt,
  brand: product.brand,
  category: product.category,
  outfitRole: product.outfitRole,
  garmentDescription: product.garmentDescription,
  provider: isFeedProvider(product.provider) ? product.provider : undefined,
  productUrl: product.productUrl,
  affiliateUrl: product.affiliateUrl,
  externalId: product.externalId,
  images: product.images,
  colors: product.colors,
  sizes: product.sizes,
  createdAt: product.createdAt,
  gender: product.gender,
  colorSlugs: product.colorSlugs,
  fit: product.fit,
  subcategory: product.subcategory,
  brandSlug: product.brandSlug,
  priceBand: product.priceBand,
});

const isLikedProductRow = (value: unknown): value is LikedProductRow => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.product_id === 'string' && typeof value.liked_at === 'string'
  );
};

const isPassedProductRow = (value: unknown): value is PassedProductRow => {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.product_id === 'string';
};

export const ensureUserProfile = async (user: AuthUser): Promise<void> => {
  const client = getRequiredSupabaseClient();
  const { error } = await client.from('users').upsert(
    {
      id: user.id,
      email: user.email ?? '',
    },
    { onConflict: 'id' },
  );

  if (error) {
    throw new Error(`Profil kaydedilemedi: ${error.message}`);
  }
};

const fetchFavoriteCatalog = async (
  productIds: string[],
): Promise<Map<string, Product>> => {
  if (productIds.length === 0) {
    return new Map();
  }

  const client = getRequiredSupabaseClient();
  const columns = 'id, provider, external_id, title, brand, price, current_price, previous_price, last_price_checked_at, currency, image_url, images, product_url, category, affiliate_url, colors, sizes, created_at';
  const query = (selected: string) => client.from('products').select(selected).in('id',productIds);
  let { data, error } = await query(columns);
  if (error && /column .*images.* does not exist/i.test(error.message)) {
    ({ data, error } = await query(columns.replace(', images','')));
  }

  if (error) {
    throw new Error('Favori katalog bilgileri alınamadı.');
  }

  const map = new Map<string, Product>();
  for (const row of data ?? []) {
    if (!isFeedProductRow(row)) continue;
    const product = mapFeedRow(row);
    if (product) map.set(product.id, product);
  }
  return map;
};

export const fetchLikedProducts = async (
  userId: string,
): Promise<LikedProductsResult> => {
  await Promise.allSettled(pendingOwnerWrites(userId));
  if (pendingOwnerWrites(userId).length) throw new Error('Favori işlemleri tamamlanmadı. Tekrar dene.');
  const client = getRequiredSupabaseClient();
  const auth = await client.auth.getUser();
  if (auth.error || auth.data.user?.id !== userId) throw new Error('Favoriler için oturum değişti.');
  if(isPreferenceV2Enabled()) {
    for(const request of await listPreferenceRequests(userId)) {
      const action:AnalyticsActionContext={actionId:request.p_action,userId,
        origin:['favorite','unlike'].includes(request.p_operation)?'favorite':'pass',occurredAt:new Date().toISOString()};
      await orderedProductWrite(userId,request.p_product,writer=>applyPreferenceTransaction(writer,userId,request.p_product,request.p_operation,action,request.p_snapshot));
    }
  }
  const readVersion = ownerWriteVersions.get(userId);
  const { data, error } = await client
    .from('liked_products')
    .select('product_id, product_snapshot, liked_at, notify_on_price_drop')
    .eq('user_id', userId)
    .order('liked_at', { ascending: false });

  if (error) {
    throw new Error('Beğeniler yüklenemedi.');
  }

  const rows = (data ?? []).filter(isLikedProductRow);
  if (rows.length !== (data ?? []).length) throw new Error('Favori kayıt bilgisi eksik.');
  const catalog = await fetchFavoriteCatalog(rows.map((row) => row.product_id));

  const result: LikedProductsResult = [];
  for (const row of rows) {
    const authoritative = catalog.get(row.product_id);
    const snapshot = isProductSnapshot(row.product_snapshot) && row.product_snapshot.id === row.product_id ? row.product_snapshot : null;
    if (!authoritative && !snapshot) throw new Error('Favori ürün bilgisi katalogdan veya kayıttan doğrulanamadı.');
    if (!authoritative) result.warning = 'METADATA_SNAPSHOT_ONLY';
    result.push({
        product: authoritative ? { ...snapshot, ...authoritative } : snapshot!,
        notifyOnPriceDrop: row.notify_on_price_drop !== false,
        likedAt: row.liked_at,
      });
  }
  if (ownerWriteVersions.get(userId) !== readVersion || pendingOwnerWrites(userId).length) {
    throw new Error('Favoriler okuma sırasında değişti. Tekrar dene.');
  }
  return result;
};

export const fetchPassedProductIds = async (
  userId: string,
): Promise<string[]> => {
  const client = getRequiredSupabaseClient();
  const { data, error } = await client
    .from('passed_products')
    .select('product_id')
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Geçilen ürünler yüklenemedi: ${error.message}`);
  }

  return (data ?? [])
    .filter(isPassedProductRow)
    .map((row) => row.product_id);
};

export const insertLikedProduct = async (
  userId: string,
  product: Product,
  action?: AnalyticsActionContext,
): Promise<PreferenceWriteReceipt | void> => {
  if(isPreferenceV2Enabled()) {
    const context=action??createAnalyticsAction(userId,'favorite');
    return orderedProductWrite(userId,product.id,client=>applyPreferenceTransaction(client,userId,product.id,'favorite',context,toSnapshot(product)));
  }
  return orderedProductWrite(userId, product.id, async client => {
  const { error: likeError } = await client.from('liked_products').upsert(
    {
      user_id: userId,
      product_id: product.id,
      product_snapshot: toSnapshot(product),
      // Fiyat alarmı kullanıcı ayarı değil sistem davranışı: her beğeni
      // takibe girer, arayüzde anahtar yoktur.
      notify_on_price_drop: true,
    },
    { onConflict: 'user_id,product_id', ignoreDuplicates: true },
  );

  if (likeError) {
    throw new Error('Beğeni kaydedilemedi.');
  }

  const { error: passError } = await client
    .from('passed_products')
    .delete()
    .eq('user_id', userId)
    .eq('product_id', product.id);

  if (passError) {
    throw new LikeWriteError(true);
  }

  logger.debug('Beğeni Supabase\'e yazıldı');
  });
};

export const insertPassedProduct = async (
  userId: string,
  product: Product,
  action?: AnalyticsActionContext,
): Promise<PreferenceWriteReceipt | void> => {
  if(isPreferenceV2Enabled()) {
    const context=action??createAnalyticsAction(userId,'pass');
    return orderedProductWrite(userId,product.id,client=>applyPreferenceTransaction(client,userId,product.id,'pass',context,null));
  }
  return orderedProductWrite(userId, product.id, async client => {
  const { error } = await client.from('passed_products').upsert(
    {
      user_id: userId,
      product_id: product.id,
    },
    { onConflict: 'user_id,product_id' },
  );

  if (error) {
    throw new Error('Geçme kaydedilemedi.');
  }
  });
};

export const deletePassedProduct = async (
  userId: string,
  productId: string,
  action?: AnalyticsActionContext,
): Promise<PreferenceWriteReceipt | void> => {
  if(isPreferenceV2Enabled()) {
    const context=action??createAnalyticsAction(userId,'pass');
    return orderedProductWrite(userId,productId,client=>applyPreferenceTransaction(client,userId,productId,'undo_pass',context,null));
  }
  return orderedProductWrite(userId, productId, async client => {
  const { error } = await client
    .from('passed_products')
    .delete()
    .eq('user_id', userId)
    .eq('product_id', productId);

  if (error) {
    throw new Error('Geçme geri alınamadı.');
  }
  });
};

export const deleteLikedProduct = async (
  userId: string,
  productId: string,
  action?: AnalyticsActionContext,
): Promise<PreferenceWriteReceipt | void> => {
  if(isPreferenceV2Enabled()) {
    const context=action??createAnalyticsAction(userId,'favorite');
    return orderedProductWrite(userId,productId,client=>applyPreferenceTransaction(client,userId,productId,'unlike',context,null));
  }
  return orderedProductWrite(userId, productId, async client => {
  const { error } = await client
    .from('liked_products')
    .delete()
    .eq('user_id', userId)
    .eq('product_id', productId);

  if (error) {
    throw new Error('Beğeni silinemedi.');
  }
  });
};

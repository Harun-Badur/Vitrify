import { captureOwnerPublication, trackOwnerWork } from '../lib/accountDeviceWork';
import type { StateCreator } from 'zustand';
import { track } from '../lib/analytics';
import { createAnalyticsAction } from '../lib/analyticsAction';
import {isPreferenceOutcomeUnknown} from '../services/preferenceTransactionAdapter';
import { logger } from '../lib/logger';
import { recordSessionProductAction } from '../lib/sessionIntent';
import {
  deleteLikedProduct,
  fetchLikedProducts,
  insertLikedProduct,
  type LikedProductsResult,
} from '../services/likeService';
import type { LikeInputSource } from '../types/analytics';
import type { LikedProduct, Product } from '../types/product';
import type { AppState } from './useAppStore';
import { removeProduct, restoreProduct } from './productState';

export interface FavoritesSlice {
  favoritesStatus: 'idle' | 'loading' | 'success' | 'error';
  favoritesError: string | null;
  favoritesOwner: string | null;
  likedProducts: LikedProduct[];
  addLikedProductLocally: (product: Product) => void;
  swipeRight: (product: Product, input?: LikeInputSource) => void;
  unlikeProduct: (productId: string) => Promise<void>;
  refreshLikedProducts: () => Promise<void>;
}

const removeLiked = (
  products: LikedProduct[],
  productId: string,
): LikedProduct[] =>
  products.filter((item) => item.product.id !== productId);

const prependLikedUnique = (
  products: LikedProduct[],
  product: Product,
): LikedProduct[] => {
  if (products.some((item) => item.product.id === product.id)) {
    return products;
  }
  // Server results are ordered by liked_at descending.
  return [
    {
      product,
      notifyOnPriceDrop: true,
      likedAt: new Date().toISOString(),
    },
    ...products,
  ];
};

export const createFavoritesSlice: StateCreator<AppState, [], [], FavoritesSlice> =
  (set, get) => {
    let refreshGeneration = 0;
    const versions = new Map<string, number>();
    const pending = new Set<{ owner: string; promise: Promise<unknown> }>();
    const nextVersion = (owner: string | null, id: string) => {
      refreshGeneration++;
      const key = JSON.stringify([owner,id]); const version = (versions.get(key) ?? 0) + 1;
      versions.set(key,version); return () => versions.get(key) === version;
    };
    const hold = <T,>(owner: string, promise: Promise<T>): Promise<T> => {
      const entry = { owner, promise }; pending.add(entry);
      void promise.then(() => pending.delete(entry), () => pending.delete(entry));return promise;
    };
    const status = (owner: string | null, value: 'loading' | 'success' | 'error', error: string | null = null) => {
      // An unrelated successful write must not hide another concurrent operation's error.
      if (value === 'success' && get().favoritesOwner === owner && get().favoritesStatus === 'error') return;
      set({favoritesOwner:owner,favoritesStatus:value,favoritesError:error});
    };
    return ({
    favoritesStatus: 'idle', favoritesError: null, favoritesOwner: null,
    likedProducts: [],
    addLikedProductLocally: (product): void => {
      if (!captureOwnerPublication(get().sessionUserId)()) return;
      nextVersion(get().sessionUserId,product.id);
      set((state) => {
        if (state.likedProducts.some((item) => item.product.id === product.id)) {
          return state;
        }
        return {
          likedProducts: prependLikedUnique(state.likedProducts, product),
        };
      });
    },
    swipeRight: (product, input): void => {
      const userId = get().sessionUserId;
      const current = captureOwnerPublication(userId);
      if (!current()) return;
      const latest = nextVersion(userId,product.id);
      const previous = get().likedProducts.find(item => item.product.id === product.id);
      const priorPass = get().passedProductIds.includes(product.id);
      const priorStack = get().passedStack.find(item => item.id === product.id);
      const valid = () => current() && get().sessionUserId === userId && latest();
      status(userId,'loading');

      set((state) => ({
        currentProducts: removeProduct(state.currentProducts, product.id),
        likedProducts: prependLikedUnique(state.likedProducts, product),
        passedProductIds: state.passedProductIds.filter(
          (id) => id !== product.id,
        ),
        passedStack: state.passedStack.filter((item) => item.id !== product.id),
      }));

      if (!userId) {
        status(userId,'success');
        return;
      }

      const action = createAnalyticsAction(userId, 'favorite');
      const committed = () => {
        track('like', product.id, input ? { source: 'feed', like_input: input } : { source: 'feed' }, action);
        track('dolap_add', product.id, { source: 'feed' }, action);
      };
      recordSessionProductAction('like', product);
      recordSessionProductAction('dolap_add', product);

      void hold(userId,trackOwnerWork(userId, insertLikedProduct(userId, product))).then((receipt) => {
        if(!receipt?.serverEvents) committed();
        if (valid()) status(userId,'success');
      }).catch((error: unknown) => {
        const likeCommitted = typeof error === 'object' && error !== null && 'likeCommitted' in error && error.likeCommitted === true;
        if (likeCommitted) committed();
        if (!valid()) return;
        logger.error('Beğeni işlemi tamamlanamadı', {code:'FAVORITE_WRITE_FAILED'});
        set((state) => ({
          currentProducts: !likeCommitted && !previous && !priorPass ? restoreProduct(state.currentProducts, product) : state.currentProducts,
          likedProducts: likeCommitted || previous ? state.likedProducts : removeLiked(state.likedProducts, product.id),
          passedProductIds: priorPass && !state.passedProductIds.includes(product.id) ? [...state.passedProductIds,product.id] : state.passedProductIds,
          passedStack: priorStack && !state.passedStack.some(item => item.id === product.id) ? [...state.passedStack,priorStack] : state.passedStack,
        }));
        status(userId,'error',isPreferenceOutcomeUnknown(error) ? 'İşlem sonucu henüz doğrulanamadı. Aynı işlem yeniden doğrulanacak.' : likeCommitted ? 'Beğeni kaydedildi; geçme temizliği tamamlanamadı. Tekrar dene.' : 'Beğeni kaydedilemedi. Mevcut veriler korundu; tekrar dene.');
      });
    },
    unlikeProduct: async (productId): Promise<void> => {
      const { likedProducts, sessionUserId: userId } = get();
      const current = captureOwnerPublication(userId);
      if (!current()) return;
      const removed = likedProducts.find(item => item.product.id === productId);

      if (!removed) return;
      const latest = nextVersion(userId,productId);
      const valid = () => current() && get().sessionUserId === userId && latest();
      if (!userId) {
        set(state=>({likedProducts:removeLiked(state.likedProducts,productId)}));
        return;
      }
      status(userId,'loading');
      try {
        await hold(userId,trackOwnerWork(userId, deleteLikedProduct(userId, productId)));
        if (!valid()) return;
        set(state=>({likedProducts:removeLiked(state.likedProducts,productId)}));
        status(userId,'success');
      } catch (error) {
        if (!valid()) return;
        const message=isPreferenceOutcomeUnknown(error) ? 'İşlem sonucu henüz doğrulanamadı. Aynı işlem yeniden doğrulanacak.' : 'Favori kaldırılamadı. Kayıt korundu; tekrar dene.';
        status(userId,'error',message);
        throw new Error(message);
      }
    },
    refreshLikedProducts: async (): Promise<void> => {
      const userId = get().sessionUserId;
      const current = captureOwnerPublication(userId);
      if (!current()) return;
      if (!userId) {
        return;
      }
      const request = ++refreshGeneration;
      const valid = () => current() && get().sessionUserId === userId && request === refreshGeneration;
      status(userId,'loading');
      try {
        await Promise.allSettled([...pending].filter(entry=>entry.owner===userId).map(entry=>entry.promise));
        if (!valid()) return;
        const likedProducts: LikedProductsResult = await trackOwnerWork(userId, fetchLikedProducts(userId));
        if (!valid()) return;
        set({ likedProducts, sessionSyncStatus: 'success' });
        status(userId,'success',likedProducts.warning ? 'Bazı ürünlerin katalog bilgisi yok; kayıtlı bilgiler korunuyor.' : null);
      } catch (error) {
        if (!valid()) return;
        status(userId,'error','Favoriler yenilenemedi. Mevcut kayıtlar korundu; tekrar dene.');
        throw new Error('Favoriler yenilenemedi.');
      }
    },
  });
  };

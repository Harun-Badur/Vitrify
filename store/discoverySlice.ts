import { captureOwnerPublication, trackOwnerWork } from '../lib/accountDeviceWork';
import type { StateCreator } from 'zustand';
import { track } from '../lib/analytics';
import { createAnalyticsAction } from '../lib/analyticsAction';
import {isPreferenceOutcomeUnknown} from '../services/preferenceTransactionAdapter';
import { hasAnyFilter, type FeedQueryFilters } from '../lib/feedQuery';
import { logger } from '../lib/logger';
import { setLastFeedMode } from '../lib/recsFeedState';
import { recordSessionProductAction } from '../lib/sessionIntent';
import { deletePassedProduct, insertPassedProduct } from '../services/likeService';
import { fetchFeedProducts, FeedServiceError, type FeedSource } from '../services/productService';
import type { Product } from '../types/product';
import { DEFAULT_FEED_MODE, type FeedMode } from '../types/recommendation';
import type { AppState } from './useAppStore';
import { excludeSeen, removeProduct, restoreProduct } from './productState';

export type FeedStatus = 'idle' | 'loading' | 'error' | 'success';

export interface DiscoverySlice {
  preferenceWriteError: string | null;
  invalidateDiscoveryWork: () => void;
  currentProducts: Product[];
  passedProductIds: string[];
  passedStack: Product[];
  feedStatus: FeedStatus;
  feedWarning: 'LOCAL_RANK_FAILED' | null;
  feedSource: FeedSource | null;
  feedIsPersonalized: boolean;
  feedMode: FeedMode;
  feedFallback: boolean;
  feedRelaxed: string[];
  hasMore: boolean;
  isFetchingNext: boolean;
  /** Advances only when a fetched batch is accepted, never on swipe/undo. */
  feedPreparationRevision: number;
  loadMoreFeed: () => Promise<void>;
  loadFeed: (
    userId: string | null,
    options?: { filters?: FeedQueryFilters; searchMode?: boolean },
  ) => Promise<void>;
  setFeedMode: (mode: FeedMode) => void;
  swipeLeft: (product: Product) => void;
  undoPass: () => boolean | Promise<boolean>;
}

const FEED_LIMIT = 20;

const appendUniqueId = (ids: string[], productId: string): string[] =>
  ids.includes(productId) ? ids : [...ids, productId];

const pushPassedProduct = (stack: Product[], product: Product): Product[] => {
  const without = stack.filter((item) => item.id !== product.id);
  return [...without, product];
};

const popPassedProduct = (
  stack: Product[],
): { stack: Product[]; product: Product | null } => {
  if (stack.length === 0) {
    return { stack, product: null };
  }
  const product = stack[stack.length - 1];
  if (product === undefined) {
    return { stack: [], product: null };
  }
  return { stack: stack.slice(0, -1), product };
};

export const createDiscoverySlice: StateCreator<AppState, [], [], DiscoverySlice> =
  (set, get) => {
    let generation = 0;
    let context: { userId: string | null; filters: FeedQueryFilters; searchMode: boolean } | null = null;
    let deliveredIds = new Set<string>();
    let mutationGeneration = 0;
    const passVersions = new Map<string, number>();
    const passWrites = new Map<string, Promise<void>>();
    let pendingUndo: { owner: string; promise: Promise<boolean>; token: symbol } | null = null;
    const excludedIds = (): string[] => [...new Set([
      ...deliveredIds,
      ...get().currentProducts.map(product => product.id),
      ...get().likedProducts.map(item => item.product.id),
      ...get().passedProductIds,
    ])];
    return ({
    invalidateDiscoveryWork: () => { generation++; mutationGeneration++; context = null; deliveredIds.clear(); passVersions.clear(); passWrites.clear(); pendingUndo = null; set({ feedWarning: null,preferenceWriteError:null }); },
    currentProducts: [],
    passedProductIds: [],
    preferenceWriteError: null,
    passedStack: [],
    feedStatus: 'idle',
    feedWarning: null,
    feedSource: null,
    feedIsPersonalized: false,
    feedMode: DEFAULT_FEED_MODE,
    feedFallback: false,
    feedRelaxed: [],
    hasMore: true,
    isFetchingNext: false,
    feedPreparationRevision: 0,
    // The caller passes userId because the feed effect can run before session hydration.
    loadFeed: async (userId, options): Promise<void> => {
      const current = captureOwnerPublication(userId);
      if (!current()) return;
      const requestGeneration = ++generation;
      deliveredIds = new Set();
      const filters = options?.filters ?? {};
      const searchMode = options?.searchMode === true || hasAnyFilter(filters);
      context = { userId, filters, searchMode };
      set({ feedStatus: 'loading', hasMore: true, isFetchingNext: false });
      try {
        const request = fetchFeedProducts(
          FEED_LIMIT,
          userId,
          get().feedMode,
          filters,
          searchMode ? 'search' : get().feedMode,
          [...new Set([...get().likedProducts.map(item => item.product.id), ...get().passedProductIds])],
        );
        const result = await (userId ? trackOwnerWork(userId, request) : request);
        if (!current() || requestGeneration !== generation) return;
        deliveredIds = new Set(result.products.map(product => product.id));
        logger.debug('Feed yüklendi', {
          source: result.source,
          isPersonalized: result.isPersonalized,
          fallback: result.fallback === true,
          relaxed: result.relaxed ?? [],
          searchMode,
        });
        set((state) => ({
          currentProducts: excludeSeen(
            [...new Map(result.products.map(product => [product.id, product])).values()],
            state.likedProducts,
            state.passedProductIds,
          ),
          feedStatus: 'success',
          feedWarning: result.warning ?? null,
          feedPreparationRevision: state.feedPreparationRevision + 1,
          feedSource: result.source,
          feedIsPersonalized: result.isPersonalized,
          feedFallback: result.fallback === true,
          feedRelaxed: result.relaxed ?? [],
          hasMore: result.hasMore ?? true,
        }));
      } catch (error) {
        if (!current() || requestGeneration !== generation) return;
        logger.error('Feed yüklenemedi.', { code: 'FEED_FAILED', reason: error instanceof FeedServiceError ? error.code : 'FEED_UNKNOWN' });
        set({
          feedStatus: 'error',
          feedIsPersonalized: false,
          feedFallback: false,
          feedRelaxed: [],
        });
      }
    },
    loadMoreFeed: async (): Promise<void> => {
      if (!context || !get().hasMore || get().isFetchingNext || !['success', 'error'].includes(get().feedStatus)) return;
      const requestGeneration = generation;
      const { userId, filters, searchMode } = context;
      const current = captureOwnerPublication(userId);
      if (!current()) return;
      const excluded = excludedIds();
      set({ isFetchingNext: true });
      try {
        const request = fetchFeedProducts(FEED_LIMIT, userId, get().feedMode, filters,
          searchMode ? 'search' : get().feedMode, excluded);
        const result = await (userId ? trackOwnerWork(userId, request) : request);
        if (!current() || requestGeneration !== generation) return;
        const alreadyDelivered = new Set(excluded);
        const incoming = result.products.filter(product => {
          if (alreadyDelivered.has(product.id)) return false;
          alreadyDelivered.add(product.id);
          deliveredIds.add(product.id);
          return true;
        });
        set(state => ({
          currentProducts: [...state.currentProducts, ...excludeSeen(incoming, state.likedProducts, state.passedProductIds)],
          feedPreparationRevision: state.feedPreparationRevision + 1,
          hasMore: result.hasMore ?? incoming.length > 0,
          isFetchingNext: false,
          feedStatus: 'success',
          feedWarning: result.warning ?? null,
        }));
      } catch (error) {
        if (!current() || requestGeneration !== generation) return;
        logger.warn('Feed sonraki batch yüklenemedi', { code: 'FEED_PAGE_FAILED' });
        // Preserve both the existing deck and continuation; a network error is not exhaustion.
        set({ isFetchingNext: false, feedStatus: 'error' });
      }
    },
    setFeedMode: (mode): void => {
      setLastFeedMode(mode);
      set({ feedMode: mode });
    },
    swipeLeft: (product): void => {
      const userId = get().sessionUserId;
      const current = captureOwnerPublication(userId);
      if (!current()) return;
      if (get().likedProducts.some(item => item.product.id === product.id)) return;
      const version = (passVersions.get(product.id) ?? 0) + 1;
      passVersions.set(product.id, version);
      const capturedGeneration = mutationGeneration;

      set((state) => ({
        currentProducts: removeProduct(state.currentProducts, product.id),
        passedProductIds: appendUniqueId(state.passedProductIds, product.id),
        passedStack: pushPassedProduct(state.passedStack, product),
      }));

      if (!userId) {
        return;
      }

      const action = createAnalyticsAction(userId, 'pass');
      recordSessionProductAction('pass', product);

      const writing = trackOwnerWork(userId, insertPassedProduct(userId, product));
      const settled = writing.then((receipt) => {
        if(!receipt?.serverEvents) track('pass', product.id, { source: 'feed' }, action);
        if(current()&&get().sessionUserId===userId&&capturedGeneration===mutationGeneration&&passVersions.get(product.id)===version)set({preferenceWriteError:null});
      }).catch((error:unknown) => {
        if (!current() || get().sessionUserId !== userId || capturedGeneration !== mutationGeneration || passVersions.get(product.id) !== version || get().likedProducts.some(item => item.product.id === product.id)) return;
        const uncertain=isPreferenceOutcomeUnknown(error);
        logger.error('Geçme işlemi doğrulanamadı', { code: uncertain?'PASS_RESULT_UNVERIFIED':'PASS_WRITE_FAILED' });
        set((state) => ({
          preferenceWriteError:uncertain?'İşlem sonucu henüz doğrulanamadı. Aynı işlem yeniden doğrulanacak.':'Geçme kaydedilemedi. Tekrar dene.',
          currentProducts: restoreProduct(state.currentProducts, product),
          passedProductIds: state.passedProductIds.filter(
            (id) => id !== product.id,
          ),
          passedStack: state.passedStack.filter((item) => item.id !== product.id),
        }));
      });
      passWrites.set(product.id, settled);
    },
    undoPass: (): boolean | Promise<boolean> => {
      const userId = get().sessionUserId;
      const current = captureOwnerPublication(userId);
      if (!current()) return false;
      if (userId && pendingUndo?.owner === userId) return pendingUndo.promise;
      const { product } = popPassedProduct(get().passedStack);
      if (product === null) {
        return false;
      }

      const restore = () => set((state) => ({
        currentProducts: state.likedProducts.some(item => item.product.id === product.id) ? state.currentProducts : restoreProduct(state.currentProducts, product),
        passedProductIds: state.passedProductIds.filter((id) => id !== product.id),
        passedStack: state.passedStack.filter(item => item.id !== product.id),
      }));
      if (!userId) { restore(); return true; }
      const capturedGeneration = mutationGeneration;
      const version = passVersions.get(product.id);
      const token = Symbol('undo');
      const isCurrent = () => current() && get().sessionUserId === userId && capturedGeneration === mutationGeneration;
      const promise = (async () => {
        // Wait for a pass already sent before deleting it; failure still allows idempotent delete.
        await passWrites.get(product.id);
        if (!isCurrent() || passVersions.get(product.id) !== version) return false;
        try {
          await trackOwnerWork(userId, deletePassedProduct(userId, product.id));
          if (!isCurrent() || passVersions.get(product.id) !== version) return false;
          restore(); return true;
        } catch (error) {
          if (!isCurrent()) return false;
          // No optimistic success: keep the pass/stack so the same action can be retried.
          throw new Error(isPreferenceOutcomeUnknown(error)?'İşlem sonucu henüz doğrulanamadı. Aynı işlem yeniden doğrulanacak.':'Geçme geri alınamadı. Bağlantını kontrol edip tekrar dene.');
        } finally {
          if (pendingUndo?.token === token) pendingUndo = null;
        }
      })();
      pendingUndo = { owner: userId, promise, token };
      return promise;
    },
    });
  };

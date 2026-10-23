import { captureOwnerPublication, deviceSessionOwner, registerOwnerResource, setDeviceSessionOwner, trackOwnerWork } from '../lib/accountDeviceWork';
import { isAccountWriteFenced } from '../lib/accountWriteFence';
import type { StateCreator } from 'zustand';
import { logger } from '../lib/logger';
import { setLastFeedMode } from '../lib/recsFeedState';
import { resetSessionIntent } from '../lib/sessionIntent';
import {
  fetchLikedProducts,
  fetchPassedProductIds,
} from '../services/likeService';
import { DEFAULT_FEED_MODE } from '../types/recommendation';
import type { AppState } from './useAppStore';
import { excludeSeen } from './productState';

export type SessionSyncStatus = 'idle' | 'loading' | 'error' | 'success';

export interface ProfileSlice {
  sessionUserId: string | null;
  sessionSyncStatus: SessionSyncStatus;
  hydrateSession: (userId: string) => Promise<void>;
  resetSession: () => void;
}

export const createProfileSlice: StateCreator<
  AppState,
  [],
  [],
  ProfileSlice
> = (set, get) => ({
  sessionUserId: null,
  sessionSyncStatus: 'idle',
  hydrateSession: async (userId): Promise<void> => {
    if (await isAccountWriteFenced(userId)) return;
    setDeviceSessionOwner(userId);
    const current = captureOwnerPublication(userId);
    if (!current()) return;
    registerOwnerResource(userId, { stop: () => { if (get().sessionUserId === userId) get().resetSession(); }, empty: () => get().sessionUserId !== userId });
    set({ sessionUserId: userId, sessionSyncStatus: 'loading' });
    const wardrobeLoad = get().hydrateWardrobe(userId);
    try {
      const [likedProducts, passedIds] = await trackOwnerWork(userId, Promise.all([
        fetchLikedProducts(userId),
        fetchPassedProductIds(userId),
      ]));
      if (!current() || get().sessionUserId !== userId) return;
      set((state) => ({
        likedProducts,
        passedProductIds: passedIds,
        sessionSyncStatus: 'success',
        currentProducts: excludeSeen(
          state.currentProducts,
          likedProducts,
          passedIds,
        ),
      }));
    } catch (error) {
      logger.error('Oturum verisi yüklenemedi', { error });
      if (current() && get().sessionUserId === userId) set({ sessionSyncStatus: 'error' });
    }
    await wardrobeLoad;
  },
  resetSession: (): void => {
    const previousOwner = get().sessionUserId;
    get().invalidateDiscoveryWork();
    get().invalidateWardrobeWork();
    setLastFeedMode(DEFAULT_FEED_MODE);
    set({
      sessionUserId: null,
      sessionSyncStatus: 'idle',
      currentProducts: [], feedStatus: 'idle', feedSource: null, hasMore: false, isFetchingNext: false,
      wardrobeItems: [],
      savedOutfits: [],
      wardrobeStatus: 'idle',
      likedProducts: [],
      passedProductIds: [],
      passedStack: [],
      feedIsPersonalized: false,
      feedMode: DEFAULT_FEED_MODE,
      feedFallback: false,
      feedRelaxed: [],
    });
    if (deviceSessionOwner() === previousOwner) setDeviceSessionOwner(null);
    resetSessionIntent();
  },
});

import { create } from 'zustand';
import { createDiscoverySlice, type DiscoverySlice } from './discoverySlice';
import { createFavoritesSlice, type FavoritesSlice } from './favoritesSlice';
import { createProductPrefSlice, type ProductPrefSlice } from './productPrefSlice';
import { createProfileSlice, type ProfileSlice } from './profileSlice';
import { createWardrobeSlice, type WardrobeSlice } from './wardrobeSlice';

// Keep the existing flat selector/action API for screens and components.
export type AppState = DiscoverySlice &
  FavoritesSlice &
  ProductPrefSlice &
  ProfileSlice &
  WardrobeSlice;
export type { FeedStatus } from './discoverySlice';
export type { SessionSyncStatus } from './profileSlice';

export const useAppStore = create<AppState>((...args) => ({
  ...createDiscoverySlice(...args),
  ...createFavoritesSlice(...args),
  ...createProductPrefSlice(...args),
  ...createProfileSlice(...args),
  ...createWardrobeSlice(...args),
}));

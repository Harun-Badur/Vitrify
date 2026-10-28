import type { StateCreator } from 'zustand';
import { nextPromptCount, type ProductPref } from '../lib/productPreference';
import type { AppState } from './useAppStore';

export interface ProductPrefSlice {
  /** NULL = not chosen; read through effectiveProductPref for filtering. */
  productPref: ProductPref | null;
  /** How many times the choice screen was shown, capped at PRODUCT_PREF_PROMPT_MAX. */
  productPrefPromptCount: number;
  setProductPref: (pref: ProductPref | null) => void;
  markProductPrefPromptShown: () => void;
}

export const createProductPrefSlice: StateCreator<AppState, [], [], ProductPrefSlice> = (set) => ({
  productPref: null,
  productPrefPromptCount: 0,
  setProductPref: (pref) => set({ productPref: pref }),
  markProductPrefPromptShown: () => set((state) => ({ productPrefPromptCount: nextPromptCount(state.productPrefPromptCount) })),
});

import type { StateCreator } from 'zustand';
import { nextPromptCount, readProductPrefPromptCount, writeProductPrefPromptCount, type ProductPref } from '../lib/productPreference';
import type { AppState } from './useAppStore';

export interface ProductPrefSlice {
  /** NULL = not chosen; read through effectiveProductPref for filtering. */
  productPref: ProductPref | null;
  /** How many times the choice screen was shown on this device, capped at PRODUCT_PREF_PROMPT_MAX. */
  productPrefPromptCount: number;
  setProductPref: (pref: ProductPref | null) => void;
  hydrateProductPrefPromptCount: () => Promise<void>;
  markProductPrefPromptShown: () => Promise<void>;
}

export const createProductPrefSlice: StateCreator<AppState, [], [], ProductPrefSlice> = (set, get) => ({
  productPref: null,
  productPrefPromptCount: 0,
  setProductPref: (pref) => set({ productPref: pref }),
  hydrateProductPrefPromptCount: async () => {
    const stored = await readProductPrefPromptCount();
    set((state) => ({ productPrefPromptCount: Math.max(state.productPrefPromptCount, stored) }));
  },
  markProductPrefPromptShown: async () => {
    set((state) => ({ productPrefPromptCount: nextPromptCount(state.productPrefPromptCount) }));
    await writeProductPrefPromptCount(get().productPrefPromptCount);
  },
});

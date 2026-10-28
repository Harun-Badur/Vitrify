import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FEED_GENDERS } from './catalogEnrichment';

/** Product preference picked by the user; NULL means "not chosen yet" and behaves as 'hepsi'. */
export type ProductPref = 'kadin' | 'erkek' | 'hepsi';
export type ProductPrefGender = (typeof FEED_GENDERS)[number];

const PRODUCT_PREFS: readonly string[] = ['kadin', 'erkek', 'hepsi'];
const ALLOWED: Readonly<Record<ProductPref, readonly ProductPrefGender[]>> = {
  kadin: ['kadin', 'unisex'],
  erkek: ['erkek', 'unisex'],
  hepsi: ['kadin', 'erkek', 'unisex'],
};
/** The choice screen is shown at most this many times. */
export const PRODUCT_PREF_PROMPT_MAX = 2;
export const PRODUCT_PREF_DEFAULT: ProductPref = 'hepsi';

export const parseProductPref = (value: unknown): ProductPref | null =>
  typeof value === 'string' && PRODUCT_PREFS.includes(value) ? (value as ProductPref) : null;
export const effectiveProductPref = (value: unknown): ProductPref => parseProductPref(value) ?? PRODUCT_PREF_DEFAULT;
/** Catalog genders a preference admits; cocuk is never included. */
export const allowedGendersFor = (pref: ProductPref): readonly ProductPrefGender[] => ALLOWED[pref];
export const nextPromptCount = (count: number): number =>
  Math.min(PRODUCT_PREF_PROMPT_MAX, (Number.isFinite(count) && count > 0 ? Math.floor(count) : 0) + 1);

/** Signed-out users get their own key; it never collides with a user key and is not account data. */
export const PRODUCT_PREF_GUEST_KEY = 'vitrify.product-pref.guest.v1';
export const productPrefStorageKey = (userId: string | null): string =>
  userId === null ? PRODUCT_PREF_GUEST_KEY : `vitrify.product-pref.v1.${encodeURIComponent(userId)}`;

export interface LocalProductPref { stored: ProductPref | null; effective: ProductPref }
/** Storage failures degrade to 'hepsi' instead of surfacing an error. */
export async function readLocalProductPref(userId: string | null): Promise<LocalProductPref> {
  try {
    const stored = parseProductPref(await AsyncStorage.getItem(productPrefStorageKey(userId)));
    return { stored, effective: stored ?? PRODUCT_PREF_DEFAULT };
  } catch {
    return { stored: null, effective: PRODUCT_PREF_DEFAULT };
  }
}
export async function writeLocalProductPref(userId: string | null, pref: ProductPref): Promise<boolean> {
  try {
    await AsyncStorage.setItem(productPrefStorageKey(userId), pref);
    return true;
  } catch {
    return false;
  }
}

/** Profile access stays behind this seam; no Supabase call is made from this module. */
export interface ProductPrefProfileGateway {
  read(userId: string): Promise<unknown>;
  write(userId: string, pref: ProductPref): Promise<void>;
}
export interface ProductPrefSyncDecision {
  effective: ProductPref;
  /** Value to store locally, or null when local is already correct. */
  writeLocal: ProductPref | null;
  /** Value to store on the profile, or null when the profile must not change. */
  writeProfile: ProductPref | null;
}
/** Login sync: a valid profile value wins over local; otherwise a valid local value is taken to the profile. */
export function resolveLoginProductPrefSync(profileValue: unknown, localValue: unknown): ProductPrefSyncDecision {
  const profile = parseProductPref(profileValue), local = parseProductPref(localValue);
  if (profile) return { effective: profile, writeLocal: profile === local ? null : profile, writeProfile: null };
  if (local) return { effective: local, writeLocal: null, writeProfile: local };
  return { effective: PRODUCT_PREF_DEFAULT, writeLocal: null, writeProfile: null };
}

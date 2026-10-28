import AsyncStorage from '@react-native-async-storage/async-storage';
import { withAccountWriteGuard } from './accountWriteFence';
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
export type ProductPrefWriteResult = 'written' | 'skipped' | 'failed';
/**
 * Runs an owner write behind the A1 write guard. A guard rejection (deletion pending,
 * session changed, unreadable fence) is a silent skip; the write's own error is 'failed'.
 */
async function guardedOwnerWrite(userId: string, write: () => Promise<void>): Promise<ProductPrefWriteResult> {
  try {
    return await withAccountWriteGuard(userId, async (): Promise<ProductPrefWriteResult> => {
      try { await write(); return 'written'; } catch { return 'failed'; }
    });
  } catch {
    return 'skipped';
  }
}
export async function writeLocalProductPref(userId: string | null, pref: ProductPref): Promise<ProductPrefWriteResult> {
  const write = () => AsyncStorage.setItem(productPrefStorageKey(userId), pref);
  if (userId !== null) return guardedOwnerWrite(userId, write);
  try { await write(); return 'written'; } catch { return 'failed'; }
}

/** Device-scoped (not account data): kept across sign-out and account deletion. */
export const PRODUCT_PREF_PROMPT_COUNT_KEY = 'vitrify.product-pref-prompt-count.v1';
const clampPromptCount = (count: number): number =>
  Math.min(PRODUCT_PREF_PROMPT_MAX, Number.isFinite(count) && count > 0 ? Math.floor(count) : 0);
/** An unreadable count is treated as already shown, so storage errors never re-prompt. */
export async function readProductPrefPromptCount(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(PRODUCT_PREF_PROMPT_COUNT_KEY);
    return raw === null ? 0 : clampPromptCount(Number(raw));
  } catch {
    return PRODUCT_PREF_PROMPT_MAX;
  }
}
export async function writeProductPrefPromptCount(count: number): Promise<boolean> {
  try {
    await AsyncStorage.setItem(PRODUCT_PREF_PROMPT_COUNT_KEY, String(clampPromptCount(count)));
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
export interface ProductPrefSyncResult {
  local: ProductPrefWriteResult | 'none';
  profile: ProductPrefWriteResult | 'none';
}
/** Applies a sync decision; both writes go through the A1 guard and never throw. */
export async function applyLoginProductPrefSync(userId: string, decision: ProductPrefSyncDecision,
  gateway: ProductPrefProfileGateway): Promise<ProductPrefSyncResult> {
  const { writeLocal, writeProfile } = decision;
  const local = writeLocal ? await writeLocalProductPref(userId, writeLocal) : 'none';
  const profile = writeProfile ? await guardedOwnerWrite(userId, () => gateway.write(userId, writeProfile)) : 'none';
  return { local, profile };
}

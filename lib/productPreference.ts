import AsyncStorage from '@react-native-async-storage/async-storage';
import { withAccountWriteGuard } from './accountWriteFence';
import type { FEED_GENDERS } from './catalogEnrichment';
import { PRODUCT_PREF_DEFAULT, parseProductPref, type ProductPref, type ProductPrefGender } from './productPreferenceRules';

export {
  PRODUCT_PREF_DEFAULT, allowedGendersFor, effectiveProductPref, parseProductPref,
  type ProductPref, type ProductPrefGender,
} from './productPreferenceRules';
// The Edge-safe rules spell the gender union out; keep it equal to the catalog's FEED_GENDERS.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const genderUnionMatchesCatalog: Same<ProductPrefGender, (typeof FEED_GENDERS)[number]> = true;
void genderUnionMatchesCatalog;

/** The choice screen is shown at most this many times. */
export const PRODUCT_PREF_PROMPT_MAX = 2;
export const nextPromptCount = (count: number): number =>
  Math.min(PRODUCT_PREF_PROMPT_MAX, (Number.isFinite(count) && count > 0 ? Math.floor(count) : 0) + 1);
/** Shown only while nothing is chosen and "Şimdi değil" was used fewer than PRODUCT_PREF_PROMPT_MAX times. */
export const shouldShowProductPrefPrompt = (pref: ProductPref | null, promptCount: number): boolean =>
  pref === null && promptCount < PRODUCT_PREF_PROMPT_MAX;

export const PRODUCT_PREF_OPTIONS: readonly { value: ProductPref; label: string }[] = [
  { value: 'kadin', label: 'Kadın' },
  { value: 'erkek', label: 'Erkek' },
  { value: 'hepsi', label: 'Hepsi' },
];
/** Display label; NULL (not chosen) reads as the effective 'Hepsi'. */
export const productPrefLabel = (pref: ProductPref | null): string =>
  PRODUCT_PREF_OPTIONS.find(option => option.value === (pref ?? PRODUCT_PREF_DEFAULT))!.label;

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

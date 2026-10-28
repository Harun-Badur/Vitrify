import {
  applyLoginProductPrefSync, parseProductPref, readLocalProductPref, resolveLoginProductPrefSync, shouldShowProductPrefPrompt,
  type LocalProductPref, type ProductPref, type ProductPrefProfileGateway,
} from '../lib/productPreference';
import { useAppStore } from '../store/useAppStore';
import { supabaseProductPrefGateway } from './productPrefProfileGateway';

/** A slow profile read must not hold the app on the boot screen; past this the local value stands. */
export const PRODUCT_PREF_PROFILE_READ_TIMEOUT_MS = 4000;

let sessionUser: string | null = null;
/** Bumped by every session start/end and user choice, so an older sync never lands over newer state. */
let generation = 0;

type ProfileRead = { ok: true; value: unknown } | { ok: false };
const readProfile = (userId: string, gateway: ProductPrefProfileGateway, timeoutMs: number): Promise<ProfileRead> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ProfileRead>(resolve => { timer = setTimeout(() => resolve({ ok: false }), timeoutMs); });
  const read = gateway.read(userId).then((value): ProfileRead => ({ ok: true, value }), (): ProfileRead => ({ ok: false }));
  return Promise.race([read, timeout]).finally(() => clearTimeout(timer));
};

/** Returns the chosen value (NULL = not chosen). Never throws; any failure keeps the local value. */
async function syncFromProfile(userId: string, local: LocalProductPref, gateway: ProductPrefProfileGateway,
  timeoutMs: number, current: () => boolean): Promise<ProductPref | null> {
  const profile = await readProfile(userId, gateway, timeoutMs);
  // An unread profile is never overwritten with the local value.
  if (!profile.ok || !current()) return local.stored;
  await applyLoginProductPrefSync(userId, resolveLoginProductPrefSync(profile.value, local.stored), gateway);
  return parseProductPref(profile.value) ?? local.stored;
}

/**
 * Login: applies the local value, syncs it with the profile and decides whether the choice
 * screen is due. Only waits for the profile when the screen could be shown.
 */
export async function startProductPrefSession(userId: string, gateway: ProductPrefProfileGateway = supabaseProductPrefGateway,
  timeoutMs = PRODUCT_PREF_PROFILE_READ_TIMEOUT_MS): Promise<'prompt' | 'done'> {
  sessionUser = userId;
  const started = ++generation;
  const current = () => sessionUser === userId && generation === started;
  const [local] = await Promise.all([readLocalProductPref(userId), useAppStore.getState().hydrateProductPrefPromptCount()]);
  if (!current()) return 'done';
  const sync = syncFromProfile(userId, local, gateway, timeoutMs, current).then((chosen) => {
    if (current()) useAppStore.getState().setProductPref(chosen);
    return chosen;
  });
  if (!shouldShowProductPrefPrompt(local.stored, useAppStore.getState().productPrefPromptCount)) {
    useAppStore.getState().setProductPref(local.stored);
    return 'done';
  }
  const chosen = await sync;
  return current() && shouldShowProductPrefPrompt(chosen, useAppStore.getState().productPrefPromptCount) ? 'prompt' : 'done';
}

/** Sign-out: drops any in-flight sync and clears the in-memory preference. */
export function endProductPrefSession(): void {
  sessionUser = null;
  generation++;
  useAppStore.getState().setProductPref(null);
}

/** A user choice (choice screen or Profile): applies at once, then stores locally and on the profile behind the A1 guard. */
export async function chooseProductPref(userId: string, pref: ProductPref,
  gateway: ProductPrefProfileGateway = supabaseProductPrefGateway): Promise<void> {
  generation++;
  useAppStore.getState().setProductPref(pref);
  // Same guarded local + profile writes as the login sync; failures are silent and the local value stands.
  await applyLoginProductPrefSync(userId, { effective: pref, writeLocal: pref, writeProfile: pref }, gateway);
}

/** "Şimdi değil": the preference stays NULL (effective hepsi) and the device count goes up. */
export const skipProductPrefPrompt = (): Promise<void> => useAppStore.getState().markProductPrefPromptShown();

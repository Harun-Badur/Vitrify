import AsyncStorage from '@react-native-async-storage/async-storage';
import { accountWriteBlockedNow, isAccountWriteFenced, withAccountWriteGuard } from '../lib/accountWriteFence';

export interface PrivacyLifecycleState {
  userId: string; schemaVersion: 1; generation: number;
  modelPhoto: 'UNSET' | 'SAVE_REQUESTED' | 'SAVED' | 'REMOVE_PENDING' | 'REMOVED';
  personalization: 'UNSET' | 'OPTED_IN' | 'OPTED_OUT' | 'RESET_PENDING';
  consent: Partial<Record<'vton' | 'model_photo_storage' | 'personalization',
    { choice: 'granted' | 'withdrawn'; textVersion: string; at: number }>>;
}
export const privacyLifecycleKey = (userId: string) => `vitrify.privacy-lifecycle.v1.${encodeURIComponent(userId)}`;
const operations = new Map<string, Promise<unknown>>();
function serial<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  if (!userId.trim()) return Promise.reject(new Error('Owner required'));
  const result = (operations.get(userId) ?? Promise.resolve()).catch(() => undefined).then(operation);
  operations.set(userId, result);
  void result.finally(() => { if (operations.get(userId) === result) operations.delete(userId); }).catch(() => undefined);
  return result;
}
export async function readPrivacyLifecycle(userId: string): Promise<PrivacyLifecycleState> {
  if (!userId.trim()) throw new Error('Owner required');
  const raw = await AsyncStorage.getItem(privacyLifecycleKey(userId));
  if (raw === null) return { userId, schemaVersion: 1, generation: 0, modelPhoto: 'UNSET', personalization: 'UNSET', consent: {} };
  const state = JSON.parse(raw) as PrivacyLifecycleState;
  if (state.userId !== userId || state.schemaVersion !== 1 || !Number.isInteger(state.generation) || state.generation < 0 || !state.consent) throw new Error('Invalid privacy state');
  return state;
}
async function save(state: PrivacyLifecycleState) {
  await withAccountWriteGuard(state.userId, async () => {
    await AsyncStorage.setItem(privacyLifecycleKey(state.userId), JSON.stringify(state));
    if (await AsyncStorage.getItem(privacyLifecycleKey(state.userId)) !== JSON.stringify(state)) throw new Error('Privacy checkpoint unverified');
  });
}
async function allow(userId: string) {
  if (await isAccountWriteFenced(userId) || accountWriteBlockedNow(userId)) throw new Error('Owner deletion pending');
}
/** Technical choice record, not evidence of legal consent sufficiency. No analytics/scoring use. */
export function recordPrivacyChoice(userId: string, purpose: keyof PrivacyLifecycleState['consent'],
  choice: 'granted' | 'withdrawn', textVersion: string): Promise<void> {
  return serial(userId, async () => {
    await allow(userId);
    if (!textVersion.trim()) throw new Error('Text version required');
    const state = await readPrivacyLifecycle(userId);
    state.consent[purpose] = { choice, textVersion, at: Date.now() };
    if (purpose === 'model_photo_storage') { state.modelPhoto = choice === 'granted' ? 'SAVE_REQUESTED' : 'REMOVE_PENDING'; state.generation++; }
    if (purpose === 'personalization') { state.personalization = choice === 'granted' ? 'OPTED_IN' : 'OPTED_OUT'; state.generation++; }
    await save(state);
  });
}
/** Explicit opt-in plus same generation prevents a late upload marking a withdrawn photo SAVED. */
export function markModelPhotoSaved(userId: string, generation: number): Promise<void> {
  return serial(userId, async () => {
    await allow(userId); const state = await readPrivacyLifecycle(userId);
    if (state.generation !== generation || state.modelPhoto !== 'SAVE_REQUESTED' || state.consent.model_photo_storage?.choice !== 'granted') throw new Error('Explicit save choice missing/stale');
    state.modelPhoto = 'SAVED'; await save(state);
  });
}
/** Cleanup callback must be idempotent and return verified absence of owned copies/derivatives. */
export function removeModelPhotoLifecycle(userId: string, cleanupAndVerify: () => Promise<boolean>): Promise<void> {
  return serial(userId, async () => {
    await allow(userId); const state = await readPrivacyLifecycle(userId);
    state.modelPhoto = 'REMOVE_PENDING'; state.generation++; await save(state);
    if (!await cleanupAndVerify()) throw new Error('Model photo removal pending');
    state.modelPhoto = 'REMOVED'; await save(state);
  });
}
export function resetPersonalizationLifecycle(userId: string, cleanupAndVerify: () => Promise<boolean>): Promise<void> {
  return serial(userId, async () => {
    await allow(userId); const state = await readPrivacyLifecycle(userId);
    state.personalization = 'RESET_PENDING'; state.generation++; await save(state);
    if (!await cleanupAndVerify()) throw new Error('Personalization reset pending');
    state.personalization = 'OPTED_OUT'; await save(state);
  });
}

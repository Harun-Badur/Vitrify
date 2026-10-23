import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureOwnerPublication, drainOwnerWork, fenceOwnerMemory, trackOwnerWork } from './accountDeviceWork';

export const ACCOUNT_WRITE_FENCE_KEY = 'vitrify.account-write-fences.v1';
let blocked = new Set<string>();
let hydrated = false;
let serial: Promise<unknown> = Promise.resolve();
function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  const result = serial.catch(() => undefined).then(operation);
  serial = result;
  return result;
}
async function hydrate() {
  if (hydrated) return;
  const raw = await AsyncStorage.getItem(ACCOUNT_WRITE_FENCE_KEY);
  const values: unknown = raw === null ? [] : JSON.parse(raw);
  if (!Array.isArray(values) || !values.every(value => typeof value === 'string' && value.trim())) throw new Error('Invalid account fence');
  blocked = new Set([...blocked, ...values]);
  blocked.forEach(fenceOwnerMemory);
  hydrated = true;
}
export function isAccountWriteFenced(userId: string): Promise<boolean> {
  return exclusive(async () => { await hydrate(); return blocked.has(userId); });
}
/** Use immediately before a side effect, after awaiting hydration; no async gap. */
export function accountWriteBlockedNow(userId: string): boolean { return !hydrated || blocked.has(userId); }
/** Fence persistence waits for guarded local writes; queued/late writes fail closed. */
export function withAccountWriteGuard<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  const current = captureOwnerPublication(userId);
  return exclusive(async () => {
    await hydrate();
    if (accountWriteBlockedNow(userId) || !current()) throw new Error('Owner deletion pending or session changed');
    return operation();
  });
}
/**
 * Admit a multi-step workflow without holding the local-write mutex across awaits.
 * Registration occurs inside the guard, BEFORE operation starts: a fence either
 * rejects admission or drains the entire workflow (including finally/cleanup).
 * This is not a mutex. Callers must retain their journal serialization and use
 * withAccountWriteGuard at subsequent local-write/dispatch boundaries.
 */
export async function withAccountWriteWorkflow<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  const admitted = await withAccountWriteGuard(userId, async () => ({
    work: trackOwnerWork(userId, Promise.resolve().then(operation)),
  }));
  return admitted.work;
}
export function withAccountCleanupGuard<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  return exclusive(async () => {
    await hydrate();
    const persisted: unknown = JSON.parse((await AsyncStorage.getItem(ACCOUNT_WRITE_FENCE_KEY)) ?? 'null');
    if (!blocked.has(userId) || !Array.isArray(persisted) || !persisted.includes(userId)) throw new Error('Durable cleanup fence required');
    return operation();
  });
}
export function fenceAccountWrites(userId: string): Promise<void> {
  if (!userId.trim()) return Promise.reject(new Error('Owner required'));
  blocked.add(userId); // also blocks this process if persistence fails
  fenceOwnerMemory(userId);
  return exclusive(async () => {
    await hydrate();
    await AsyncStorage.setItem(ACCOUNT_WRITE_FENCE_KEY, JSON.stringify([...blocked]));
    const proof: unknown = JSON.parse((await AsyncStorage.getItem(ACCOUNT_WRITE_FENCE_KEY)) ?? 'null');
    if (!Array.isArray(proof) || !proof.includes(userId)) throw new Error('Account fence persistence unverified');
  }).then(async () => {
    // Outside the serialized write lock: pending workflows may need to observe a rejected guarded write.
    if (!await drainOwnerWork(userId)) throw new Error('Owner memory resource drain unverified');
  });
}
/** Tombstones are not removed by logout or account cleanup. */
export function resetAccountWriteFenceMemoryForTests() { blocked = new Set(); hydrated = false; serial = Promise.resolve(); }

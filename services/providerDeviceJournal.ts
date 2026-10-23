import AsyncStorage from '@react-native-async-storage/async-storage';
import { createUuid } from '../lib/analytics';
import { accountWriteBlockedNow } from '../lib/accountWriteFence';

type Provider = 'fashn' | 'wardrobe-cutout';
interface Intent { owner: string; provider: Provider; request: string; state: 'UNKNOWN' | 'RESPONSE_OBSERVED' }
export const providerDeviceJournalPrefix = (owner: string) => `vitrify.provider-dispatch.v1.${encodeURIComponent(owner)}.`;
const key = (intent: Intent) => providerDeviceJournalPrefix(intent.owner) + intent.provider + '.' + intent.request;
async function save(intent: Intent) {
  const value = JSON.stringify(intent); await AsyncStorage.setItem(key(intent), value);
  if (await AsyncStorage.getItem(key(intent)) !== value) throw new Error('Provider checkpoint unverified');
}
/** Caller holds the account write guard. No model bytes, URI or JWT is persisted. */
export async function beginProviderDeviceIntentUnderGuard(owner: string, provider: Provider): Promise<Intent> {
  if (accountWriteBlockedNow(owner)) throw new Error('Provider owner fenced');
  // A fresh UUID must not turn a lost provider reply into an implicit replay.
  const inventory = await providerDeviceInventory(owner);
  for (const item of inventory.keys) {
    const prior = JSON.parse(await AsyncStorage.getItem(item) ?? 'null') as Intent;
    if (!prior || prior.provider === provider && prior.state === 'UNKNOWN') throw new Error('Provider dispatch unresolved');
  }
  const intent: Intent = { owner, provider, request: createUuid(), state: 'UNKNOWN' };
  if (await AsyncStorage.getItem(key(intent)) !== null) throw new Error('Provider intent already exists');
  await save(intent); return intent;
}
export async function observeProviderDeviceResponseUnderGuard(intent: Intent): Promise<void> {
  const raw = await AsyncStorage.getItem(key(intent));
  if (raw !== JSON.stringify(intent) || intent.state !== 'UNKNOWN') throw new Error('Provider intent changed');
  await save({ ...intent, state: 'RESPONSE_OBSERVED' });
}
export async function providerDeviceInventory(owner: string) {
  const keys = (await AsyncStorage.getAllKeys()).filter(item => item.startsWith(providerDeviceJournalPrefix(owner)));
  let unknown = 0;
  for (const item of keys) {
    const intent = JSON.parse(await AsyncStorage.getItem(item) ?? 'null') as Intent;
    if (!intent || intent.owner !== owner || !['fashn', 'wardrobe-cutout'].includes(intent.provider) ||
      typeof intent.request !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(intent.request) ||
      !['UNKNOWN', 'RESPONSE_OBSERVED'].includes(intent.state) || item !== key(intent)) throw new Error('Provider ownership journal invalid');
    if (intent.state === 'UNKNOWN') unknown++;
  }
  return { keys, unknown, retentionUnverified: keys.length }; // Response is not retention/deletion evidence.
}

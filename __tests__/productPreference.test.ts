import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PRODUCT_PREF_GUEST_KEY, PRODUCT_PREF_PROMPT_MAX, allowedGendersFor, effectiveProductPref, nextPromptCount,
  parseProductPref, productPrefStorageKey, readLocalProductPref, resolveLoginProductPrefSync, writeLocalProductPref,
} from '../lib/productPreference';
import { useAppStore } from '../store/useAppStore';
import { deviceDeletionAdapters } from '../services/deviceDeletionAdapters';
import { createDeletionReceipt } from '../lib/accountDeletionFoundation';

jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///docs/', cacheDirectory: 'file:///cache/' }));
const getItem = jest.mocked(AsyncStorage.getItem).getMockImplementation()!;
const setItem = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
beforeEach(async () => {
  jest.mocked(AsyncStorage.getItem).mockImplementation(getItem);
  jest.mocked(AsyncStorage.setItem).mockImplementation(setItem);
  await AsyncStorage.clear();
});

describe('allowed gender set', () => {
  it.each([
    ['kadin', ['kadin', 'unisex']],
    ['erkek', ['erkek', 'unisex']],
    ['hepsi', ['kadin', 'erkek', 'unisex']],
  ] as const)('%s -> %j and never cocuk', (pref, expected) => {
    expect(allowedGendersFor(pref)).toEqual(expected);
    expect(allowedGendersFor(pref)).not.toContain('cocuk');
  });
  it('NULL and invalid values resolve to hepsi', () => {
    for (const value of [null, undefined, '', 'cocuk', 'KADIN', 'women', 42, {}]) {
      expect(parseProductPref(value)).toBeNull();
      expect(effectiveProductPref(value)).toBe('hepsi');
    }
    expect(allowedGendersFor(effectiveProductPref(null))).toEqual(['kadin', 'erkek', 'unisex']);
  });
});

describe('local storage', () => {
  it('user and guest keys are separate', () => {
    expect(productPrefStorageKey('u-1')).toBe('vitrify.product-pref.v1.u-1');
    expect(productPrefStorageKey(null)).toBe(PRODUCT_PREF_GUEST_KEY);
    expect(PRODUCT_PREF_GUEST_KEY).not.toBe(productPrefStorageKey('guest'));
  });
  it('round-trips per owner without leaking across owners', async () => {
    expect(await writeLocalProductPref('A', 'erkek')).toBe(true);
    expect(await writeLocalProductPref(null, 'kadin')).toBe(true);
    expect(await readLocalProductPref('A')).toEqual({ stored: 'erkek', effective: 'erkek' });
    expect(await readLocalProductPref(null)).toEqual({ stored: 'kadin', effective: 'kadin' });
    expect(await readLocalProductPref('B')).toEqual({ stored: null, effective: 'hepsi' });
  });
  it('invalid stored value reads as hepsi', async () => {
    await AsyncStorage.setItem(productPrefStorageKey('A'), 'cocuk');
    expect(await readLocalProductPref('A')).toEqual({ stored: null, effective: 'hepsi' });
  });
  it('read failure falls back to hepsi', async () => {
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('disk'));
    expect(await readLocalProductPref('A')).toEqual({ stored: null, effective: 'hepsi' });
  });
  it('write failure reports false and never throws', async () => {
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk'));
    expect(await writeLocalProductPref('A', 'kadin')).toBe(false);
    expect(await readLocalProductPref('A')).toEqual({ stored: null, effective: 'hepsi' });
  });
});

describe('login sync', () => {
  it('profile value overrides a different local value', () => {
    expect(resolveLoginProductPrefSync('erkek', 'kadin')).toEqual({ effective: 'erkek', writeLocal: 'erkek', writeProfile: null });
  });
  it('profile value equal to local writes nothing', () => {
    expect(resolveLoginProductPrefSync('kadin', 'kadin')).toEqual({ effective: 'kadin', writeLocal: null, writeProfile: null });
  });
  it('profile value with no local value writes local', () => {
    expect(resolveLoginProductPrefSync('hepsi', null)).toEqual({ effective: 'hepsi', writeLocal: 'hepsi', writeProfile: null });
  });
  it('missing profile value takes the local value to the profile', () => {
    expect(resolveLoginProductPrefSync(null, 'erkek')).toEqual({ effective: 'erkek', writeLocal: null, writeProfile: 'erkek' });
  });
  it('invalid profile value is treated as missing', () => {
    expect(resolveLoginProductPrefSync('cocuk', 'kadin')).toEqual({ effective: 'kadin', writeLocal: null, writeProfile: 'kadin' });
  });
  it('neither side set writes nothing and is effectively hepsi', () => {
    expect(resolveLoginProductPrefSync(null, 'garbage')).toEqual({ effective: 'hepsi', writeLocal: null, writeProfile: null });
  });
});

describe('store', () => {
  it('holds the preference and caps the prompt count at 2', () => {
    expect(useAppStore.getState().productPref).toBeNull();
    useAppStore.getState().setProductPref('erkek');
    expect(useAppStore.getState().productPref).toBe('erkek');
    for (let i = 0; i < 5; i += 1) useAppStore.getState().markProductPrefPromptShown();
    expect(useAppStore.getState().productPrefPromptCount).toBe(PRODUCT_PREF_PROMPT_MAX);
    expect(nextPromptCount(Number.NaN)).toBe(1);
    expect(nextPromptCount(2)).toBe(2);
  });
});

describe('A1 device inventory', () => {
  const adapter = () => deviceDeletionAdapters({ subjectId: 'A', coverageVerified: true, ownedFiles: [], extraOwnedKeys: [] }, async () => true).async_storage!;
  it('deletes the owner product preference and keeps other owners and guest', async () => {
    await AsyncStorage.setItem(productPrefStorageKey('A'), 'kadin');
    await AsyncStorage.setItem(productPrefStorageKey('B'), 'erkek');
    await AsyncStorage.setItem(PRODUCT_PREF_GUEST_KEY, 'hepsi');
    const a = adapter(), r = createDeletionReceipt('r', 'A');
    await a.cleanup(r);
    expect(await AsyncStorage.getItem(productPrefStorageKey('A'))).toBeNull();
    expect(await AsyncStorage.getItem(productPrefStorageKey('B'))).toBe('erkek');
    expect(await AsyncStorage.getItem(PRODUCT_PREF_GUEST_KEY)).toBe('hepsi');
    expect((await a.verify(r)).complete).toBe(true);
  });
  it('a late product preference write fails verification', async () => {
    const a = adapter(), r = createDeletionReceipt('r', 'A');
    await a.cleanup(r);
    await AsyncStorage.setItem(productPrefStorageKey('A'), 'kadin');
    expect((await a.verify(r)).complete).toBe(false);
  });
});

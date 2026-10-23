import AsyncStorage from '@react-native-async-storage/async-storage';
import { grantVtonConsent, hasVtonConsent, VTON_CONSENT_TEXT_VERSION } from '../lib/consent';
import { privacyLifecycleKey, recordPrivacyChoice } from '../services/privacyLifecycleService';
import { resetAccountWriteFenceMemoryForTests } from '../lib/accountWriteFence';
beforeEach(async () => { await AsyncStorage.clear(); resetAccountWriteFenceMemoryForTests(); });
test('legacy device-wide acceptance cannot authorize either account', async () => {
  await AsyncStorage.setItem('kabin.consent.vton.v1', 'granted');
  expect(await hasVtonConsent('A')).toBe(false);
  expect(await hasVtonConsent('B')).toBe(false);
});
test('acceptance is persisted only for its account and current disclosure version', async () => {
  await grantVtonConsent('A');
  expect(await hasVtonConsent('A')).toBe(true);
  expect(await hasVtonConsent('B')).toBe(false);
  const stored = JSON.parse((await AsyncStorage.getItem(privacyLifecycleKey('A')))!);
  expect(stored.consent.vton).toMatchObject({ choice: 'granted', textVersion: VTON_CONSENT_TEXT_VERSION });
  await recordPrivacyChoice('A', 'vton', 'granted', 'previous-copy');
  expect(await hasVtonConsent('A')).toBe(false);
  await recordPrivacyChoice('A', 'vton', 'withdrawn', VTON_CONSENT_TEXT_VERSION);
  expect(await hasVtonConsent('A')).toBe(false);
});
test('failed persistence rejects and cannot silently grant consent', async () => {
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('storage failed'));
  await expect(grantVtonConsent('A')).rejects.toThrow();
  expect(await hasVtonConsent('A')).toBe(false);
  jest.restoreAllMocks();
});
test('anonymous and malformed records fail closed', async () => {
  expect(await hasVtonConsent('')).toBe(false);
  await AsyncStorage.setItem(privacyLifecycleKey('B'), '{');
  expect(await hasVtonConsent('B')).toBe(false);
});

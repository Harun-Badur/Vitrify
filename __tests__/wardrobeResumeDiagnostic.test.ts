import AsyncStorage from '@react-native-async-storage/async-storage';
import { createWardrobeResumeDiagnostic } from '../lib/wardrobeResumeDiagnostic';
import type { WardrobeItem } from '../types/wardrobe';

test('one-shot read-only resume summary reports gates without secrets and suppresses stale owners and production', async () => {
  await AsyncStorage.clear();
  const owner = 'private-owner';
  const makeItem = (id: string, cutoutStatus: WardrobeItem['cutoutStatus']): WardrobeItem => ({
    id, cutoutStatus, title: 'private-title', category: 'upper_body', brand: '',
    imageUrl: 'https://private.invalid/photo', createdAt: '2026-10-01',
  });
  const items = [makeItem('private-old', 'blocked'), makeItem('private-new', 'pending'),
    { ...makeItem('private-ready', 'ready'), cutoutLocalUri: 'file:///private-photo' }];
  await AsyncStorage.setItem(`vitrify.wardrobe.sync.v1.${encodeURIComponent(owner)}`, JSON.stringify({
    version: 1, owner, ids: { 'item:private-new': 'remote-new', 'item:private-old': 'remote-old', 'item:private-ready': 'remote-ready' },
    base: { items: items.map((item, i) => ({ ...item, id: ['remote-old', 'remote-new', 'remote-ready'][i], updatedAt: 'v1' })) },
    pending: [{ kind: 'item', id: 'remote-old', localId: 'private-old' }],
  }));
  const prefix = `vitrify.provider-dispatch.v1.${encodeURIComponent(owner)}.`;
  await AsyncStorage.setItem(`${prefix}wardrobe-cutout.request-test`, JSON.stringify({ owner, provider: 'wardrobe-cutout', request: 'request-test', state: 'UNKNOWN' }));
  // Another provider's UNKNOWN must not be counted as a wardrobe blocker.
  await AsyncStorage.setItem(`${prefix}fashn.other-test`, JSON.stringify({ owner, provider: 'fashn', request: 'other-test', state: 'UNKNOWN' }));
  const log = jest.spyOn(console, 'info').mockImplementation(() => {});
  const set = jest.spyOn(AsyncStorage, 'setItem'); set.mockClear();
  const remove = jest.spyOn(AsyncStorage, 'removeItem'); remove.mockClear();
  const runtime = globalThis as unknown as { __DEV__: boolean }, previous = runtime.__DEV__;
  const input = { owner, generation: 1, wardrobeStatus: 'ready' as const,
    wardrobeSync: { state: 'pending' as const, pending: 1 }, wardrobeItems: items,
    cutoutEndpointConfigured: false, current: () => true };
  try {
    const observe = createWardrobeResumeDiagnostic();
    await observe(input); await observe(input);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({
      type: 'wardrobe_resume_diagnostic', wardrobeStatus: 'ready', wardrobeSync: { state: 'pending' }, pendingCount: 1,
      cloudConfirmedItemCount: 2, pendingCutoutCount: 1, blockedWithoutArtifactCount: 1,
      artifactReadyCount: 1, providerUnknownCount: 1, cutoutEndpointConfigured: false,
      reasonCodes: ['GLOBAL_SYNC_BLOCKED', 'BLOCKED_NO_ARTIFACT', 'PROVIDER_UNKNOWN', 'ENDPOINT_MISSING'],
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|remote-|request-test|https:|file:/);
    log.mockClear();
    await createWardrobeResumeDiagnostic()({ ...input, wardrobeItems: [...items, makeItem('private-unsent', 'pending')] });
    expect(JSON.parse(log.mock.calls[0][0]).reasonCodes).toContain('ITEM_NOT_CONFIRMED');
    log.mockClear();
    let current = true;
    const stale = createWardrobeResumeDiagnostic()({ ...input, current: () => current });
    current = false; await stale;
    expect(log).not.toHaveBeenCalled();
    runtime.__DEV__ = false;
    const read = jest.spyOn(AsyncStorage, 'getAllKeys'); read.mockClear();
    await createWardrobeResumeDiagnostic()(input);
    expect(log).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  } finally { runtime.__DEV__ = previous; jest.restoreAllMocks(); }
});

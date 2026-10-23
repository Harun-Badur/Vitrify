import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FS from 'expo-file-system/legacy';
import { fenceAccountWrites, withAccountWriteGuard, resetAccountWriteFenceMemoryForTests } from '../lib/accountWriteFence';
import { resetDeviceWorkForTests } from '../lib/accountDeviceWork';
import { createOwnedFileUnderGuard, withOwnedNativeFileUnderGuard, ownedFileLedgerKey, readOwnedFileLedger, clearCompletedOwnedFileLedger } from '../services/ownedDeviceFiles';
import { createAccountDeletionRuntime } from '../services/accountDeletionRuntime';
import { deviceDeletionAdapters } from '../services/deviceDeletionAdapters';
import { createDeletionReceipt } from '../lib/accountDeletionFoundation';

const mockFiles = new Set<string>();
jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: 'file:///cache/', documentDirectory: 'file:///docs/',
  deleteAsync: jest.fn(async (path: string) => { mockFiles.delete(path); }),
  getInfoAsync: jest.fn(async (path: string) => ({ exists: mockFiles.has(path), isDirectory: false })),
  readDirectoryAsync: jest.fn().mockResolvedValue([]) }));
const a = 'file:///cache/vitrify-owned/A/result.png', b = 'file:///cache/vitrify-owned/B/result.png';
const getItemImplementation = jest.mocked(AsyncStorage.getItem).getMockImplementation()!;
beforeEach(async () => { jest.mocked(AsyncStorage.getItem).mockImplementation(getItemImplementation);
  await AsyncStorage.clear(); mockFiles.clear(); resetDeviceWorkForTests(); resetAccountWriteFenceMemoryForTests(); jest.clearAllMocks(); });

it('durable owner intent precedes creation; failed read-back cannot create a file', async () => {
  const created = jest.fn();
  const read = jest.spyOn(AsyncStorage, 'getItem');
  await withAccountWriteGuard('A', async () => {
    read.mockResolvedValueOnce(null).mockResolvedValueOnce('wrong-readback');
    await expect(createOwnedFileUnderGuard('A', 'vton-result', a, created)).rejects.toThrow('checkpoint');
  });
  expect(created).not.toHaveBeenCalled(); read.mockRestore();
});
it('native temporary is owner-bound, consumed and verified absent while gallery input is preserved', async () => {
  const source = 'file:///gallery/original.jpg', temp = 'file:///cache/ImageManipulator/generated.jpg'; mockFiles.add(source); mockFiles.add(temp);
  const value = await withAccountWriteGuard('A', () => withOwnedNativeFileUnderGuard('A', source, async () => {
    expect((await readOwnedFileLedger('A')).intents[0]).toMatchObject({ state: 'CREATING', opaque: true, paths: [] }); return temp;
  }, async uri => { expect((await readOwnedFileLedger('A')).intents[0].paths).toEqual([uri]); return 'used'; }));
  expect(value).toBe('used'); expect(mockFiles.has(source)).toBe(true); expect(mockFiles.has(temp)).toBe(false);
  expect((await readOwnedFileLedger('A')).intents).toEqual([]);
});
it('failed temporary deletion remains in a durable release journal and is included after restart', async () => {
  const temp = 'file:///cache/ImageManipulator/generated.jpg'; mockFiles.add(temp);
  jest.mocked(FS.deleteAsync).mockRejectedValueOnce(new Error('filesystem unavailable'));
  await expect(withAccountWriteGuard('A', () => withOwnedNativeFileUnderGuard('A', 'file:///gallery/input.jpg', async () => temp, async () => 'used'))).rejects.toThrow('filesystem');
  resetAccountWriteFenceMemoryForTests(); resetDeviceWorkForTests();
  const ledger = await readOwnedFileLedger('A'); expect(ledger.intents[0]).toMatchObject({ state: 'RELEASE_PENDING', paths: [temp] });
  expect((await createAccountDeletionRuntime('A', async () => true)).inventory.ownedFiles).toContain(temp);
});
it('opaque interruption after native invocation stays BLOCKED; unknown files are never guessed', async () => {
  await expect(withAccountWriteGuard('A', () => withOwnedNativeFileUnderGuard('A', 'file:///gallery/input.jpg', async () => { throw new Error('native crash'); }, async () => {}))).rejects.toThrow('native crash');
  resetAccountWriteFenceMemoryForTests(); resetDeviceWorkForTests();
  const runtime = await createAccountDeletionRuntime('A', async () => true);
  expect(runtime.inventory.coverageVerified).toBe(false); expect(runtime.inventory.blockers).toContain('OPAQUE_NATIVE_CREATION_INTERRUPTED');
  expect(FS.deleteAsync).not.toHaveBeenCalled();
});
it.each(['file:///cache/vitrify-owned/B/result.png', 'file:///docs/wardrobe/A/../B/photo.jpg', 'file:///gallery/input.jpg'])('A cannot claim unsupported output %s', async path => {
  const create = jest.fn();
  await expect(withAccountWriteGuard('A', () => createOwnedFileUnderGuard('A', 'vton-result', path, create))).rejects.toThrow('unsupported');
  expect(create).not.toHaveBeenCalled();
});
it('source/returned-same URI is not treated as a generated file', async () => {
  const source = 'file:///cache/imported-original.jpg'; mockFiles.add(source);
  await expect(withAccountWriteGuard('A', () => withOwnedNativeFileUnderGuard('A', source, async () => source, async () => {}))).rejects.toThrow('ownership');
  expect(mockFiles.has(source)).toBe(true); expect(FS.deleteAsync).not.toHaveBeenCalled();
});
it('A cleanup preserves B files, keys and wardrobe references; ledger is removed only after file absence', async () => {
  await withAccountWriteGuard('A', () => createOwnedFileUnderGuard('A', 'vton-result', a, async () => { mockFiles.add(a); }));
  await withAccountWriteGuard('B', () => createOwnedFileUnderGuard('B', 'vton-result', b, async () => { mockFiles.add(b); }));
  await expect(clearCompletedOwnedFileLedger('A')).rejects.toThrow('incomplete');
  await fenceAccountWrites('A');
  const adapter = deviceDeletionAdapters({ subjectId: 'A', coverageVerified: true, ownedFiles: [a], extraOwnedKeys: [] }, async () => true).local_files!;
  await adapter.cleanup(createDeletionReceipt('r', 'A')); expect((await adapter.verify(createDeletionReceipt('r', 'A'))).complete).toBe(true);
  await clearCompletedOwnedFileLedger('A'); expect(await AsyncStorage.getItem(ownedFileLedgerKey('A'))).toBeNull();
  expect(mockFiles.has(b)).toBe(true); expect(await AsyncStorage.getItem(ownedFileLedgerKey('B'))).not.toBeNull();
});
it('shared URI referenced by B wardrobe is retained rather than guessed as A-only', async () => {
  await withAccountWriteGuard('A', () => createOwnedFileUnderGuard('A', 'vton-result', a, async () => { mockFiles.add(a); }));
  await AsyncStorage.setItem('vitrify.wardrobe.v1.B', JSON.stringify({ wardrobeItems: [{ imageUrl: a }], savedOutfits: [] }));
  await fenceAccountWrites('A');
  const adapter = deviceDeletionAdapters({ subjectId: 'A', coverageVerified: true, ownedFiles: [a], extraOwnedKeys: [] }, async () => true).local_files!;
  await expect(adapter.cleanup(createDeletionReceipt('r', 'A'))).rejects.toThrow('shared'); expect(mockFiles.has(a)).toBe(true);
});
it('fence drains an admitted writer; fresh snapshot includes its late file and restart rejects new writes', async () => {
  const runtime = await createAccountDeletionRuntime('A', async () => true); expect(runtime.inventory.ownedFiles).not.toContain(a);
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const writer = withAccountWriteGuard('A', () => createOwnedFileUnderGuard('A', 'vton-result', a, async () => {
    started(); await new Promise<void>(resolve => { release = resolve; }); mockFiles.add(a);
  }));
  await ready; let drained = false; const fence = fenceAccountWrites('A').then(() => { drained = true; });
  await Promise.resolve(); expect(drained).toBe(false); release(); await writer; await fence;
  expect((await runtime.collectAfterFence!()).ownedFiles).toContain(a);
  resetAccountWriteFenceMemoryForTests(); resetDeviceWorkForTests();
  const create = jest.fn(); await expect(withAccountWriteGuard('A', create)).rejects.toThrow('deletion'); expect(create).not.toHaveBeenCalled();
});

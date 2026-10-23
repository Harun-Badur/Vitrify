import AsyncStorage from '@react-native-async-storage/async-storage';
import { fenceAccountWrites, resetAccountWriteFenceMemoryForTests, withAccountWriteGuard, withAccountWriteWorkflow } from '../lib/accountWriteFence';
import { ownerWorkEvidence, resetDeviceWorkForTests, setDeviceSessionOwner } from '../lib/accountDeviceWork';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(async () => { await AsyncStorage.clear(); resetAccountWriteFenceMemoryForTests(); resetDeviceWorkForTests(); });

it('a tracked workflow can await a guarded write without holding the admission lock', async () => {
  await expect(withAccountWriteWorkflow('A', () => withAccountWriteGuard('A', async () => 'saved'))).resolves.toBe('saved');
  expect(ownerWorkEvidence('A').pending).toBe(0);
});

it('fence persists but cannot drain before the actual workflow and its cleanup settle', async () => {
  const started = deferred(), response = deferred(), cleaning = deferred(), cleanup = deferred();
  const work = withAccountWriteWorkflow('A', async () => {
    started.resolve();
    try { await response.promise; await withAccountWriteGuard('A', async () => { throw new Error('must not write'); }); }
    finally { cleaning.resolve(); await cleanup.promise; }
  });
  const result = expect(work).rejects.toThrow('deletion');
  await started.promise;
  let drained = false;
  const fence = fenceAccountWrites('A').then(() => { drained = true; });
  // A guarded probe also proves fence admission is no longer behind the network request.
  await expect(withAccountWriteGuard('A', async () => {})).rejects.toThrow('deletion');
  expect(drained).toBe(false); expect(ownerWorkEvidence('A').pending).toBe(1);
  response.resolve(); await cleaning.promise;
  expect(drained).toBe(false);
  cleanup.resolve(); await result; await fence;
  expect(ownerWorkEvidence('A')).toEqual({ fenced: true, pending: 0, nonempty: 0 });
});

it('switching accounts rejects a late guarded step while retaining old work for drain', async () => {
  setDeviceSessionOwner('A');
  const started = deferred(), response = deferred(); const publish = jest.fn();
  const work = withAccountWriteWorkflow('A', async () => { started.resolve(); await response.promise; await withAccountWriteGuard('A', async () => { publish(); }); });
  const rejected = expect(work).rejects.toThrow('session');
  await started.promise; setDeviceSessionOwner('B');
  await expect(withAccountWriteWorkflow('B', async () => 'B')).resolves.toBe('B');
  expect(ownerWorkEvidence('A').pending).toBe(1);
  response.resolve(); await rejected;
  expect(publish).not.toHaveBeenCalled(); expect(ownerWorkEvidence('A').pending).toBe(0);
});

it('a queued workflow cannot start after fencing, and synchronous failure does not poison the queue', async () => {
  await expect(withAccountWriteWorkflow('B', () => { throw new Error('failed'); })).rejects.toThrow('failed');
  const blocker = deferred(), started = deferred();
  const local = withAccountWriteGuard('A', async () => { started.resolve(); await blocker.promise; });
  await started.promise;
  const effect = jest.fn(async () => {});
  const work = withAccountWriteWorkflow('A', effect);
  const rejected = expect(work).rejects.toThrow('deletion');
  const fence = fenceAccountWrites('A'); blocker.resolve();
  await local; await rejected; await fence;
  expect(effect).not.toHaveBeenCalled();
});

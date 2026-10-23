import { createDeletionReceipt } from '../supabase/functions/_shared/accountDeletionFoundation';
import { deletionStorageAdapter } from '../supabase/functions/_shared/accountDeletionStorage';
import { verifiedDeletionStorage, deleteAuthAfterStorage, DRAIN_MARGIN_MS, STORAGE_EMPTY_CONFIRM_DELAY_MS } from '../supabase/functions/_shared/accountDeletionExecution';
import { UPLOAD_HANDLER_DEADLINE_MS } from '../supabase/functions/_shared/accountStorageUploadHandler';
import { readFileSync } from 'node:fs';

const receipt = () => createDeletionReceipt('request-A','A');
function fixture() {
  let objects = ['A/model.jpg'], failRemove = false, remain = false;
  const calls: string[] = [];
  const sweep = deletionStorageAdapter({ assertLease: async () => {}, barrier: async () => true,
    objects: async bucket => { calls.push('list:'+bucket); return bucket==='model-photos'?objects:[]; },
    remove: async () => { calls.push('remove'); if(failRemove)throw new Error('remove'); if(!remain)objects=[]; } });
  const wait = jest.fn(async (ms:number) => { calls.push('delay'); expect(ms).toBe(STORAGE_EMPTY_CONFIRM_DELAY_MS); });
  const storage = verifiedDeletionStorage(sweep, wait);
  const purge = jest.fn(async () => { calls.push('purge'); });
  const auth = jest.fn(async () => { calls.push('auth'); });
  return {storage,purge,auth,wait,calls,dirty:()=>{objects=['A/model.jpg'];},fail:()=>{failRemove=true;},recover:()=>{failRemove=false;},remain:()=>{remain=true;}};
}
it('T1: sweep, two empty measurements, purge, Auth in order',async()=>{
  const f=fixture();await f.storage.cleanup(receipt());await deleteAuthAfterStorage(receipt(),f.storage,f.purge,f.auth);
  expect(f.calls.indexOf('remove')).toBeLessThan(f.calls.indexOf('delay'));
  expect(f.calls.lastIndexOf('list:wardrobe-cutouts')).toBeLessThan(f.calls.indexOf('purge'));
  expect(f.calls.indexOf('purge')).toBeLessThan(f.calls.indexOf('auth'));expect(f.auth).toHaveBeenCalledTimes(1);
});
it('T3: remove fails before purge/Auth and is retryable',async()=>{
  const f=fixture();f.fail();await expect(f.storage.cleanup(receipt())).rejects.toThrow();expect(f.auth).not.toHaveBeenCalled();
  f.recover();await f.storage.cleanup(receipt());await deleteAuthAfterStorage(receipt(),f.storage,f.purge,f.auth);expect(f.auth).toHaveBeenCalledTimes(1);
});
it('T3: nonempty verification is bounded, Auth never called',async()=>{
  const f=fixture();f.remain();await expect(f.storage.cleanup(receipt())).rejects.toThrow();expect(f.calls.filter(x=>x==='remove')).toHaveLength(2);expect(f.auth).not.toHaveBeenCalled();
});
it('T3: purge failure precedes Auth',async()=>{
  const f=fixture();await f.storage.cleanup(receipt());f.purge.mockRejectedValueOnce(new Error('purge'));
  await expect(deleteAuthAfterStorage(receipt(),f.storage,f.purge,f.auth)).rejects.toThrow('purge');expect(f.auth).not.toHaveBeenCalled();
  await deleteAuthAfterStorage(receipt(),f.storage,f.purge,f.auth);expect(f.auth).toHaveBeenCalledTimes(1);
});
it('T3: ownership signal returns to sweep, then purge/Auth; bounded',async()=>{
  const f=fixture();await f.storage.cleanup(receipt());f.auth.mockImplementationOnce(async()=>{f.dirty();throw Object.assign(new Error('owns'),{code:'STORAGE_OBJECTS_REMAIN'});});
  await deleteAuthAfterStorage(receipt(),f.storage,f.purge,f.auth);expect(f.auth).toHaveBeenCalledTimes(2);expect(f.purge).toHaveBeenCalledTimes(2);
  f.auth.mockRejectedValue(Object.assign(new Error('owns'),{code:'STORAGE_OBJECTS_REMAIN'}));
  await expect(deleteAuthAfterStorage(receipt(),f.storage,f.purge,f.auth)).rejects.toThrow();
  expect(f.auth).toHaveBeenCalledTimes(5);
});
it('T3: other Auth error is retryable but never blindly swept/retried',async()=>{
  const f=fixture();await f.storage.cleanup(receipt());f.auth.mockRejectedValueOnce(new Error('Auth offline'));
  await expect(deleteAuthAfterStorage(receipt(),f.storage,f.purge,f.auth)).rejects.toThrow('Auth offline');expect(f.auth).toHaveBeenCalledTimes(1);
  await deleteAuthAfterStorage(receipt(),f.storage,f.purge,f.auth);expect(f.auth).toHaveBeenCalledTimes(2);
});
it('drain SQL uses DB clock with the shared 60s + 30s constants; internal field only',()=>{
  expect(UPLOAD_HANDLER_DEADLINE_MS+DRAIN_MARGIN_MS).toBe(90_000);
  const sql=readFileSync('reports/backend/proposals/20261012_a1_phase4_fence_timestamp.sql','utf8').split('-- ROLLBACK')[0];
  expect(sql).toContain('drain_remaining_ms');expect(sql).toContain('clock_timestamp()');expect(sql).toContain('60000 + 30000');
});
it('purge SQL binds caller capability, orders deletes, preserves tombstones',()=>{
  const sql=readFileSync('reports/backend/proposals/20261012_a1_phase4b_purge_operations.sql','utf8').split('-- ROLLBACK')[0];
  expect(sql).toContain('public.deletion_assert_lease(p_request,p_lease)');expect(sql).toContain('who is distinct from subject');
  const tables=['storage_resolutions','storage_operations','provider_operations'];
  const positions=tables.map(t=>sql.indexOf('delete from deletion_private.'+t));expect(positions.every(n=>n>=0)).toBe(true);expect(positions).toEqual([...positions].sort((a,b)=>a-b));
  expect(sql).not.toMatch(/delete from deletion_private\.(owner_gates|receipts)/);expect(sql).toContain('to service_role');
});

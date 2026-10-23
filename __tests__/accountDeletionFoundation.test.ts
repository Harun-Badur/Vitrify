import { createDeletionReceipt, deletionCompletion, DELETION_LAYERS, runDeletionFoundation,
  type DeletionAdapter, type DeletionLayer } from '../lib/accountDeletionFoundation';

function adapters() {
  const order: string[] = [];
  const result: Partial<Record<DeletionLayer, DeletionAdapter>> = {};
  for (const layer of Object.keys(DELETION_LAYERS) as DeletionLayer[]) {
    let absent = false;
    result[layer] = { idempotent: true, cleanup: async () => { order.push(layer); absent = true; },
      verify: async () => ({ complete: absent, evidence: absent ? ['absence verified'] : [] }) };
  }
  return { result, order };
}
it('requires verified storage/fence/jobs before Auth; leaves external layers UNKNOWN', async () => {
  const a = adapters(), receipt = createDeletionReceipt('request', 'user');
  await runDeletionFoundation(receipt, a.result, async () => undefined);
  expect(a.order.indexOf('storage')).toBeLessThan(a.order.indexOf('auth'));
  expect(a.order.indexOf('db')).toBeLessThan(a.order.indexOf('auth'));
  expect(a.order.at(-1)).toBe('auth');
  expect(deletionCompletion(receipt)).toEqual({ appControlledComplete: true, allLayersComplete: false });
  expect(receipt.layers.vendor.state).toBe('UNKNOWN');
  await runDeletionFoundation(receipt, a.result, async () => undefined);
  expect(a.order.filter(layer => layer === 'auth')).toHaveLength(1);
});
it('storage failure blocks Auth and can resume idempotently with a persisted checkpoint', async () => {
  const a = adapters(), receipt = createDeletionReceipt('request', 'user'), original = a.result.storage!;
  a.result.storage = { ...original, cleanup: async () => { throw new Error('failed'); } };
  const saves: unknown[] = [];
  await runDeletionFoundation(receipt, a.result, async snapshot => { saves.push(snapshot); });
  expect(receipt.layers.storage.state).toBe('RETRY_REQUIRED');
  expect(receipt.layers.auth.state).toBe('BLOCKED');
  expect(a.order).not.toContain('auth');
  a.result.storage = original;
  await runDeletionFoundation(receipt, a.result, async () => undefined);
  expect(receipt.layers.auth.state).toBe('VERIFIED'); expect(saves.length).toBeGreaterThan(0);
});
it('HTTP-like success without absence evidence cannot complete deletion', async () => {
  const a = adapters(), receipt = createDeletionReceipt('request', 'user');
  a.result.storage = { idempotent: true, cleanup: async () => undefined, verify: async () => ({ complete: true, evidence: [' '] }) };
  await runDeletionFoundation(receipt, a.result, async () => undefined);
  expect(deletionCompletion(receipt).appControlledComplete).toBe(false);
  expect(receipt.layers.auth.state).toBe('BLOCKED');
});
it('missing adapters and failed durable checkpoint never allow Auth cleanup', async () => {
  const a = adapters(); delete a.result.write_fence;
  const receipt = createDeletionReceipt('request', 'user');
  await runDeletionFoundation(receipt, a.result, async () => undefined);
  expect(receipt.layers.auth.state).toBe('BLOCKED');
  const fresh = adapters();
  await expect(runDeletionFoundation(createDeletionReceipt('r', 'u'), fresh.result,
    async () => { throw new Error('persistence failed'); })).rejects.toThrow();
  expect(fresh.order).toEqual([]);
});

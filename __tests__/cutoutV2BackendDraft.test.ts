import { DraftCutoutLedger, type Identity } from '../supabase/proposals/cutout-v2/protocol.draft';

const identity: Identity = { owner: 'owner-a', item: 'item-a', original: 'original-a' };
const setup = () => {
  const ledger = new DraftCutoutLedger();
  ledger.setOriginal(identity);
  return ledger;
};

describe('Cutout V2 backend offline contract (not a PostgreSQL/server implementation)', () => {
  test('two devices reserve one canonical job with stable request aliases', () => {
    const ledger = setup();
    const a = ledger.reserve(identity, 'request-a');
    expect(ledger.reserve(identity, 'request-b')).toBe(a);
    expect(ledger.reserve(identity, 'request-a')).toBe(a);
    expect(() => ledger.reserve({ ...identity, item: 'different' }, 'request-a')).toThrow('REQUEST_CONFLICT');
    expect(ledger.inspect(a).state).toBe('RESERVED');
  });

  test('failed durable commit before execute cannot create dispatch permission', () => {
    const ledger = setup(), job = ledger.reserve(identity, 'request');
    ledger.failNextCommit = true;
    expect(() => ledger.execute(identity, job)).toThrow('CHECKPOINT_FAILED');
    expect(ledger.inspect(job).state).toBe('RESERVED');
    expect(() => ledger.claim(identity, job)).toThrow('CLAIM_DENIED');
  });

  test('duplicate delivery and two simultaneous workers have exactly one claim winner', async () => {
    const ledger = setup(), job = ledger.reserve(identity, 'request');
    ledger.execute(identity, job);
    const results = await Promise.allSettled([0, 1].map(async () => ledger.claim(identity, job)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(ledger.inspect(job).claims).toBe(1);
    expect(() => ledger.execute(identity, job)).toThrow('DISPATCH_UNCERTAIN');
  });

  test.each(['timeout', 'worker-crash', 'lost-response'])('%s never releases a claimed job or infers non-dispatch', () => {
    const ledger = setup(), job = ledger.reserve(identity, 'request');
    ledger.execute(identity, job); ledger.claim(identity, job);
    ledger.uncertain(job);
    expect(ledger.status(identity, job).state).toBe('UNKNOWN');
    expect(() => ledger.claim(identity, job)).toThrow('CLAIM_DENIED');
    expect(() => ledger.closeUnclaimed(identity, job)).toThrow('DISPATCH_UNCERTAIN');
    expect(ledger.reserve(identity, 'device-b')).toBe(job);
    expect(ledger.status(identity, 'missing').state).toBe('UNKNOWN');
  });

  test('closing an unclaimed job revokes dispatch before issuing non-dispatch proof', () => {
    const ledger = setup(), job = ledger.reserve(identity, 'request');
    ledger.execute(identity, job);
    expect(ledger.closeUnclaimed(identity, job)).toEqual({ state: 'FAILED', nonDispatch: true });
    expect(() => ledger.claim(identity, job)).toThrow('CLAIM_DENIED');
    expect(() => ledger.execute(identity, job)).toThrow('DISPATCH_UNCERTAIN');
  });

  test('status/result reads do not dispatch, mutate, or turn absence into proof', () => {
    const ledger = setup(), job = ledger.reserve(identity, 'request');
    const before = ledger.inspect(job);
    expect(ledger.result(identity, job)).toBeUndefined();
    expect(ledger.status(identity, 'absent')).toEqual({ state: 'UNKNOWN', nonDispatch: false });
    expect(ledger.inspect(job)).toEqual(before);
    expect(() => ledger.status({ ...identity, owner: 'owner-b' }, job)).toThrow('OWNER_MISMATCH');
  });

  test('artifact publication requires sole writer receipt; unknown upload is reconciled without another write', () => {
    const ledger = setup(), job = ledger.reserve(identity, 'request');
    ledger.execute(identity, job); ledger.claim(identity, job);
    ledger.beginCompletion(identity, job, 'digest');
    expect(ledger.result(identity, job)).toBeUndefined();
    expect(() => ledger.beginCompletion(identity, job, 'digest')).toThrow('STORAGE_UNCERTAIN');
    expect(() => ledger.confirmStorage(identity, job, { writer: 'provider', operation: 'op', digest: 'digest' })).toThrow('WRITER_PROOF_INVALID');
    ledger.confirmStorage(identity, job, { writer: 'account-storage-upload', operation: 'op', digest: 'digest' });
    expect(ledger.result(identity, job)).toEqual({ reference: job, digest: 'digest' });
    expect(ledger.status(identity, job).state).toBe('SUCCEEDED');
    expect(() => ledger.claim(identity, job)).toThrow('CLAIM_DENIED');
  });

  test('late completion after original replacement is never published; tombstone keeps dedup history', () => {
    const ledger = setup(), job = ledger.reserve(identity, 'request');
    ledger.execute(identity, job); ledger.claim(identity, job);
    ledger.setOriginal({ ...identity, original: 'replacement' });
    expect(() => ledger.beginCompletion(identity, job, 'digest')).toThrow('ORIGINAL_CHANGED');
    expect(ledger.result(identity, job)).toBeUndefined();
    expect(ledger.reserve({ ...identity, original: 'replacement' }, 'new-request')).not.toBe(job);
    expect(ledger.inspect(job).claims).toBe(1);
  });

  test('item tombstone prevents late publication and identity reuse', () => {
    const ledger = setup(), job = ledger.reserve(identity, 'request');
    ledger.execute(identity, job); ledger.claim(identity, job);
    ledger.removeItem(identity);
    expect(() => ledger.beginCompletion(identity, job, 'digest')).toThrow('ORIGINAL_CHANGED');
    expect(() => ledger.reserve(identity, 'other-request')).toThrow('ORIGINAL_CHANGED');
    expect(ledger.inspect(job).claims).toBe(1);
  });

  test('deletion fence closes admission; physical writer must drain before sweep/auth deletion', () => {
    const ledger = setup(), job = ledger.reserve(identity, 'request');
    ledger.execute(identity, job); ledger.claim(identity, job);
    ledger.beginCompletion(identity, job, 'digest');
    ledger.fence(identity.owner);
    expect(() => ledger.reserve(identity, 'other')).toThrow('FENCED');
    expect(() => ledger.confirmStorage(identity, job, { writer: 'account-storage-upload', operation: 'op', digest: 'digest' })).toThrow('FENCED');
    expect(ledger.canDeleteAuth(identity.owner)).toBe(false);
    ledger.verifyWriterDrained(identity.owner);
    expect(ledger.canDeleteAuth(identity.owner)).toBe(false);
    ledger.verifySweep(identity.owner);
    expect(ledger.canDeleteAuth(identity.owner)).toBe(true);
    expect(ledger.result(identity, job)).toBeUndefined();
  });

  test('one uncertain item does not block an independent V2 item; legacy UNKNOWN still blocks new dispatch', () => {
    const ledger = setup(), first = ledger.reserve(identity, 'first');
    ledger.execute(identity, first); ledger.claim(identity, first); ledger.uncertain(first);
    const secondIdentity = { ...identity, item: 'item-b' }; ledger.setOriginal(secondIdentity);
    const second = ledger.reserve(secondIdentity, 'second');
    ledger.execute(secondIdentity, second); ledger.claim(secondIdentity, second);
    expect(ledger.inspect(second).claims).toBe(1);
    const thirdIdentity = { ...identity, item: 'item-c' }; ledger.setOriginal(thirdIdentity);
    const third = ledger.reserve(thirdIdentity, 'third');
    ledger.legacyUnknown.add(identity.owner);
    expect(() => ledger.execute(thirdIdentity, third)).toThrow('LEGACY_UNKNOWN');
    expect(ledger.inspect(first).state).toBe('UNKNOWN');
  });
});

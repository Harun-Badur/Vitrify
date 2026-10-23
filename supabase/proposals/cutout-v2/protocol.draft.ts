/** Offline specification model ONLY. No IO, auth, SQL, provider or Storage adapter.
 * Its synchronous transitions model ONE serialized transaction, not PostgreSQL
 * isolation, durable commits, capability verification or physical drain proofs.
 * Never import into application/Edge runtime. See api-contract.md for bindings.
 */
export interface Identity { owner: string; item: string; original: string }
type State = 'RESERVED' | 'ARMED' | 'RUNNING' | 'UNKNOWN' | 'COMPLETING' | 'SUCCEEDED' | 'FAILED';
interface Job {
  identity: Identity; state: State; claims: number; revision: number;
  nonDispatch: boolean; digest?: string; operation?: string;
}
const fail = (code: string): never => { throw new Error(code); };
const tuple = (id: Identity) => JSON.stringify([id.owner, id.item, id.original]);
const itemKey = (id: Identity) => JSON.stringify([id.owner, id.item]);

export class DraftCutoutLedger {
  private jobs = new Map<string, Job>();
  private canonical = new Map<string, string>();
  private aliases = new Map<string, string>();
  private originals = new Map<string, string>();
  private fenced = new Set<string>();
  private drained = new Set<string>();
  private swept = new Set<string>();
  readonly legacyUnknown = new Set<string>();
  failNextCommit = false;

  setOriginal(id: Identity) { this.originals.set(itemKey(id), id.original); }
  removeItem(id: Identity) { this.originals.delete(itemKey(id)); }
  private current(id: Identity) {
    if (this.fenced.has(id.owner)) fail('FENCED');
    if (this.originals.get(itemKey(id)) !== id.original) fail('ORIGINAL_CHANGED');
  }
  private owned(id: Identity, key: string) {
    const job = this.jobs.get(key) ?? fail('UNKNOWN_JOB');
    if (job.identity.owner !== id.owner) fail('OWNER_MISMATCH');
    if (tuple(job.identity) !== tuple(id)) fail('IDENTITY_MISMATCH');
    return job;
  }
  private commit(key: string, job: Job) {
    if (this.failNextCommit) { this.failNextCommit = false; fail('CHECKPOINT_FAILED'); }
    this.jobs.set(key, { ...job, identity: { ...job.identity }, revision: job.revision + 1 });
  }
  reserve(id: Identity, request: string) {
    const alias = JSON.stringify([id.owner, request]);
    const existing = this.aliases.get(alias);
    if (existing && tuple(this.jobs.get(existing)!.identity) !== tuple(id)) fail('REQUEST_CONFLICT');
    this.current(id);
    if (existing) return existing;
    const prior = this.canonical.get(tuple(id));
    const key = prior ?? `job-${this.jobs.size + 1}`;
    if (!prior) {
      this.commit(key, { identity: id, state: 'RESERVED', claims: 0, revision: 0, nonDispatch: false });
      this.canonical.set(tuple(id), key);
    } else if (this.failNextCommit) { this.failNextCommit = false; fail('CHECKPOINT_FAILED'); }
    this.aliases.set(alias, key);
    return key;
  }
  execute(id: Identity, key: string) {
    this.current(id);
    if (this.legacyUnknown.has(id.owner)) fail('LEGACY_UNKNOWN');
    const job = this.owned(id, key);
    if (job.state !== 'RESERVED') fail('DISPATCH_UNCERTAIN');
    this.commit(key, { ...job, state: 'ARMED' }); // durable before external worker delivery
  }
  claim(id: Identity, key: string) {
    this.current(id);
    const job = this.owned(id, key);
    if (job.state !== 'ARMED' || job.claims !== 0) fail('CLAIM_DENIED');
    this.commit(key, { ...job, state: 'RUNNING', claims: 1 });
    return { inferenceAllowed: true as const };
  }
  uncertain(key: string) {
    const job = this.jobs.get(key) ?? fail('UNKNOWN_JOB');
    if (!['RUNNING', 'UNKNOWN'].includes(job.state)) fail('INVALID_TRANSITION');
    this.commit(key, { ...job, state: 'UNKNOWN' });
  }
  closeUnclaimed(id: Identity, key: string) {
    this.current(id);
    const job = this.owned(id, key);
    if (!['RESERVED', 'ARMED'].includes(job.state) || job.claims !== 0) fail('DISPATCH_UNCERTAIN');
    this.commit(key, { ...job, state: 'FAILED', nonDispatch: true });
    return { state: 'FAILED', nonDispatch: true };
  }
  beginCompletion(id: Identity, key: string, digest: string) {
    this.current(id);
    const job = this.owned(id, key);
    if (job.state === 'COMPLETING') fail('STORAGE_UNCERTAIN');
    if (!['RUNNING', 'UNKNOWN'].includes(job.state) || job.claims !== 1) fail('INVALID_TRANSITION');
    this.commit(key, { ...job, state: 'COMPLETING', digest });
  }
  confirmStorage(id: Identity, key: string, proof: { writer: string; operation: string; digest: string }) {
    this.current(id);
    const job = this.owned(id, key);
    // Simulation token only: a production receipt MUST come from trusted writer
    // journal + Storage verification, never from a client-supplied writer string.
    if (job.state !== 'COMPLETING' || proof.writer !== 'account-storage-upload' || !proof.operation || proof.digest !== job.digest) fail('WRITER_PROOF_INVALID');
    this.commit(key, { ...job, state: 'SUCCEEDED', operation: proof.operation });
  }
  status(id: Identity, key: string) {
    if (!this.jobs.has(key)) return { state: 'UNKNOWN', nonDispatch: false };
    const job = this.owned(id, key);
    return { state: job.state, nonDispatch: job.nonDispatch };
  }
  result(id: Identity, key: string) {
    const job = this.owned(id, key);
    if (this.fenced.has(id.owner) || this.originals.get(itemKey(id)) !== id.original || job.state !== 'SUCCEEDED') return undefined;
    return { reference: key, digest: job.digest };
  }
  inspect(key: string): Job {
    const job = this.jobs.get(key) ?? fail('UNKNOWN_JOB');
    return { ...job, identity: { ...job.identity } };
  }
  fence(owner: string) { this.fenced.add(owner); }
  // Test harness evidence inputs, NOT production proof APIs.
  verifyWriterDrained(owner: string) { if (!this.fenced.has(owner)) fail('NOT_FENCED'); this.drained.add(owner); }
  verifySweep(owner: string) { if (!this.drained.has(owner)) fail('NOT_DRAINED'); this.swept.add(owner); }
  canDeleteAuth(owner: string) { return this.fenced.has(owner) && this.drained.has(owner) && this.swept.has(owner); }
}

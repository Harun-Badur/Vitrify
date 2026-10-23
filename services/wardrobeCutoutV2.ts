import AsyncStorage from '@react-native-async-storage/async-storage';
import { createUuid } from '../lib/analytics';
import { captureOwnerPublication } from '../lib/accountDeviceWork';
import { accountWriteBlockedNow, withAccountWriteGuard, withAccountWriteWorkflow } from '../lib/accountWriteFence';
import { providerDeviceInventory } from './providerDeviceJournal';

// Dormant infrastructure: no production backend/artifact adapter or store wiring.
export interface CutoutV2Identity { owner: string; wardrobeItemId: string; originalVersion: string }
export type CutoutV2State = 'PRE_DISPATCH' | 'DISPATCH_POSSIBLE' | 'RESPONSE_OBSERVED' | 'ARTIFACT_SAVED';
export interface CutoutV2Response extends CutoutV2Identity {
  protocol: 'vitrify.cutout.v2'; request: string; resultId: string; pngSha256: string;
}
export interface CutoutV2Artifact { uri: string; pngSha256: string }
export interface CutoutV2Job {
  version: 2; identity: CutoutV2Identity; request: string; state: CutoutV2State;
  revision: number; prepareAttempts: number; preparationStopped: boolean;
  response?: CutoutV2Response; artifact?: CutoutV2Artifact;
}
export interface CutoutV2Prepared { value: unknown; cleanup(): Promise<void> }
export interface CutoutV2Backend {
  // This port requires a reviewed, owner-bound status/result/idempotency backend.
  // A URL/env flag or the current stateless JSON response is NOT this contract.
  contract: 'vitrify.cutout.v2';
  prepare(job: CutoutV2Job): Promise<CutoutV2Prepared>; // Local preparation only; own/clean native outputs.
  dispatch(job: CutoutV2Job, prepared: CutoutV2Prepared): Promise<CutoutV2Response | (CutoutV2Identity & {
    protocol: 'vitrify.cutout.v2'; request: string; state: 'DISPATCH_POSSIBLE';
  })>;
  status(job: CutoutV2Job): Promise<{ state: 'UNKNOWN' | 'NOT_FOUND' } | { state: 'RESPONSE_OBSERVED'; response: CutoutV2Response }>;
  recoverCompletion?: CutoutV2Backend['status']; // explicit metadata-only completion recovery, no inference/upload
}
interface Options {
  // The protocol marker must come from durable NEW-item creation metadata.
  // Never synthesize/backfill it for an existing pending/blocked legacy item.
  currentItem(identity: CutoutV2Identity): { originalVersion: string; cutoutStatus?: string; cutoutProtocol?: 2 } | undefined;
  backend?: CutoutV2Backend;
  artifacts?: {
    // Idempotently recover ONLY response.resultId, never run inference. Use existing
    // owned-file journal/guards; do not resolve until all native work/cleanup settles.
    saveVerified(job: CutoutV2Job, response: CutoutV2Response): Promise<CutoutV2Artifact>;
    verifyOwnedPng(job: CutoutV2Job, artifact: CutoutV2Artifact): Promise<boolean>; // Read-only, no nested guard.
  };
}
const MAX_PREPARATIONS = 2;
const hash = /^[a-f0-9]{64}$/i, opaque = /^[a-zA-Z0-9-]{1,160}$/;
const fail = (code: string) => Object.assign(new Error('Cutout V2 işlemi doğrulanamadı.'), { code });
export const transientCutoutPreparationFailure = () => fail('CUTOUT_V2_PREPARATION_TRANSIENT');
export const cutoutV2Prefix = (owner: string) => `vitrify.wardrobe-cutout-jobs.v2.${encodeURIComponent(owner)}.`;
export const cutoutV2Key = (id: CutoutV2Identity) => cutoutV2Prefix(id.owner) + encodeURIComponent(JSON.stringify([id.wardrobeItemId, id.originalVersion]));
const running = new Map<string, Promise<CutoutV2Job>>();
const sameIdentity = (a: CutoutV2Identity, b: CutoutV2Identity) => a.owner === b.owner && a.wardrobeItemId === b.wardrobeItemId && a.originalVersion === b.originalVersion;
function identity(input: CutoutV2Identity): CutoutV2Identity {
  if (!opaque.test(input.owner) || !opaque.test(input.wardrobeItemId) || !hash.test(input.originalVersion)) throw fail('CUTOUT_V2_IDENTITY_INVALID');
  return { owner: input.owner, wardrobeItemId: input.wardrobeItemId, originalVersion: input.originalVersion };
}
function responseFor(value: CutoutV2Response, job: CutoutV2Job): CutoutV2Response {
  if (!value || value.protocol !== 'vitrify.cutout.v2' || !sameIdentity(value, job.identity) || value.request !== job.request ||
    !opaque.test(value.resultId) || !hash.test(value.pngSha256)) throw fail('CUTOUT_V2_RESPONSE_INVALID');
  return { protocol: 'vitrify.cutout.v2', ...job.identity, request: job.request, resultId: value.resultId, pngSha256: value.pngSha256 };
}
function parse(raw: string, id: CutoutV2Identity): CutoutV2Job {
  let job: CutoutV2Job;
  try { job = JSON.parse(raw); } catch { throw fail('CUTOUT_V2_JOURNAL_INVALID'); }
  if (!job || job.version !== 2 || !job.identity || !sameIdentity(job.identity, id) || !opaque.test(job.request) ||
    !['PRE_DISPATCH', 'DISPATCH_POSSIBLE', 'RESPONSE_OBSERVED', 'ARTIFACT_SAVED'].includes(job.state) ||
    !Number.isSafeInteger(job.revision) || job.revision < 0 || !Number.isSafeInteger(job.prepareAttempts) ||
    job.prepareAttempts < 0 || job.prepareAttempts > MAX_PREPARATIONS || typeof job.preparationStopped !== 'boolean') throw fail('CUTOUT_V2_JOURNAL_INVALID');
  if (job.state === 'RESPONSE_OBSERVED' || job.state === 'ARTIFACT_SAVED') responseFor(job.response!, job);
  else if (job.response || job.artifact) throw fail('CUTOUT_V2_JOURNAL_INVALID');
  if (job.state === 'ARTIFACT_SAVED' && (!job.artifact || !job.artifact.uri || job.artifact.pngSha256 !== job.response!.pngSha256)) throw fail('CUTOUT_V2_JOURNAL_INVALID');
  if (job.state !== 'ARTIFACT_SAVED' && job.artifact) throw fail('CUTOUT_V2_JOURNAL_INVALID');
  return job;
}

/** Read-only A1 inventory; malformed/foreign data never grants deletion coverage. */
export async function cutoutV2DeviceInventory(owner: string) {
  if (!opaque.test(owner)) throw fail('CUTOUT_V2_IDENTITY_INVALID');
  const prefix = cutoutV2Prefix(owner);
  const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(prefix));
  const artifacts: string[] = [];
  for (const key of keys) {
    const parts: unknown = JSON.parse(decodeURIComponent(key.slice(prefix.length)));
    if (!Array.isArray(parts) || parts.length !== 2 || parts.some(value => typeof value !== 'string')) throw fail('CUTOUT_V2_JOURNAL_INVALID');
    const id = identity({ owner, wardrobeItemId: parts[0], originalVersion: parts[1] });
    if (cutoutV2Key(id) !== key) throw fail('CUTOUT_V2_JOURNAL_INVALID');
    const raw = await AsyncStorage.getItem(key);
    if (!raw) throw fail('CUTOUT_V2_JOURNAL_INVALID');
    const job = parse(raw, id);
    if (job.artifact) artifacts.push(job.artifact.uri);
  }
  return { keys, artifacts };
}

export function createWardrobeCutoutV2(options: Options) {
  const assertCurrent = (id: CutoutV2Identity, live: () => boolean) => {
    if (!live() || accountWriteBlockedNow(id.owner) || options.currentItem(id)?.originalVersion !== id.originalVersion) throw fail('CUTOUT_V2_OWNER_OR_ORIGINAL_CHANGED');
  };
  const guarded = <T>(id: CutoutV2Identity, live: () => boolean, work: () => Promise<T>) => withAccountWriteGuard(id.owner, async () => {
    assertCurrent(id, live); return work();
  });
  const readUnderGuard = async (id: CutoutV2Identity) => {
    const raw = await AsyncStorage.getItem(cutoutV2Key(id));
    return raw === null ? undefined : parse(raw, id);
  };
  const writeUnderGuard = async (id: CutoutV2Identity, live: () => boolean, before: CutoutV2Job | undefined, next: CutoutV2Job) => {
    const current = await readUnderGuard(id);
    if (JSON.stringify(current) !== JSON.stringify(before)) throw fail('CUTOUT_V2_JOURNAL_CHANGED');
    assertCurrent(id, live);
    const raw = JSON.stringify(next);
    await AsyncStorage.setItem(cutoutV2Key(id), raw);
    if (await AsyncStorage.getItem(cutoutV2Key(id)) !== raw) throw fail('CUTOUT_V2_CHECKPOINT_UNVERIFIED');
    assertCurrent(id, live);
    return next;
  };
  const legacyBarrier = async (owner: string) => {
    const inventory = await providerDeviceInventory(owner); // Validate legacy data, never mutate it.
    for (const key of inventory.keys) {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) throw fail('CUTOUT_V2_LEGACY_UNKNOWN');
      const prior = JSON.parse(raw);
      if (prior.provider === 'wardrobe-cutout' && prior.state === 'UNKNOWN') throw fail('CUTOUT_V2_LEGACY_UNKNOWN');
    }
  };
  const create = (id: CutoutV2Identity, live: () => boolean) => guarded(id, live, async () => {
    const existing = await readUnderGuard(id);
    if (existing) return existing;
    const item = options.currentItem(id);
    if (item?.cutoutProtocol !== 2 || item.cutoutStatus !== 'pending') throw fail('CUTOUT_V2_LEGACY_ITEM_BLOCKED');
    await legacyBarrier(id.owner);
    const job: CutoutV2Job = { version: 2, identity: id, request: createUuid(), state: 'PRE_DISPATCH', revision: 0, prepareAttempts: 0, preparationStopped: false };
    if (!opaque.test(job.request)) throw fail('CUTOUT_V2_IDENTITY_INVALID');
    return writeUnderGuard(id, live, undefined, job);
  });
  const backend = () => {
    if (options.backend?.contract !== 'vitrify.cutout.v2') throw fail('CUTOUT_V2_BACKEND_UNAVAILABLE');
    return options.backend;
  };
  const update = (id: CutoutV2Identity, live: () => boolean, job: CutoutV2Job, patch: Partial<CutoutV2Job>) =>
    guarded(id, live, () => writeUnderGuard(id, live, job, { ...job, ...patch, revision: job.revision + 1 }));
  const artifact = async (id: CutoutV2Identity, live: () => boolean, job: CutoutV2Job) => {
    const port = options.artifacts;
    if (!port) throw fail('CUTOUT_V2_ARTIFACT_ADAPTER_UNAVAILABLE');
    if(job.state==='ARTIFACT_SAVED'){
      const valid=await guarded(id,live,async()=>{
        const valid=!!job.artifact && await port.verifyOwnedPng(job,job.artifact);
        assertCurrent(id,live);return valid;
      });
      if(valid)return job;
    }
    if (job.state === 'RESPONSE_OBSERVED' || job.state==='ARTIFACT_SAVED') {
      const saved = await port.saveVerified(job, responseFor(job.response!, job));
      job = await guarded(id, live, async () => {
        if (!saved || typeof saved.uri !== 'string' || !saved.uri || saved.pngSha256 !== job.response!.pngSha256 || !await port.verifyOwnedPng(job, saved)) throw fail('CUTOUT_V2_ARTIFACT_UNVERIFIED');
        return writeUnderGuard(id, live, job, { ...job, artifact: { uri: saved.uri, pngSha256: saved.pngSha256 }, state: 'ARTIFACT_SAVED', revision: job.revision + 1 });
      });
      return job;
    }
    return guarded(id, live, async () => {
      if (!job.artifact || !await port.verifyOwnedPng(job, job.artifact)) throw fail('CUTOUT_V2_ARTIFACT_UNVERIFIED');
      assertCurrent(id, live); return job;
    });
  };
  async function runUnlocked(id: CutoutV2Identity, live: () => boolean): Promise<CutoutV2Job> {
    let job = await guarded(id, live, () => readUnderGuard(id));
    if (job?.state === 'DISPATCH_POSSIBLE') throw fail('CUTOUT_V2_UNKNOWN');
    if (job?.state === 'RESPONSE_OBSERVED' || job?.state === 'ARTIFACT_SAVED') return artifact(id, live, job);
    const provider = backend(); // Missing contract cannot even create/prepare a new job.
    job ??= await create(id, live);
    for (;;) {
      if (job.preparationStopped) throw fail('CUTOUT_V2_PREPARATION_STOPPED');
      if (job.prepareAttempts >= MAX_PREPARATIONS) throw fail('CUTOUT_V2_PREPARATION_LIMIT');
      await guarded(id, live, () => legacyBarrier(id.owner));
      job = await update(id, live, job, { prepareAttempts: job.prepareAttempts + 1 });
      let prepared: CutoutV2Prepared;
      try { prepared = await provider.prepare(job); }
      catch (error) {
        const transient = !!error && typeof error === 'object' && 'code' in error && error.code === 'CUTOUT_V2_PREPARATION_TRANSIENT';
        job = await update(id, live, job, { preparationStopped: !transient });
        if (transient && job.prepareAttempts < MAX_PREPARATIONS) continue;
        throw error;
      }
      try {
        const admitted = await guarded(id, live, async () => {
          await legacyBarrier(id.owner);
          const next = await writeUnderGuard(id, live, job, { ...job!, state: 'DISPATCH_POSSIBLE', revision: job!.revision + 1 });
          assertCurrent(id, live);
          // Start synchronously after checkpoint, return a boxed promise: the
          // global local-write mutex is NOT held for the provider response.
          return { job: next, response: provider.dispatch(next, prepared) };
        });
        job = admitted.job;
        const observed = await admitted.response;
        if ('state' in observed && observed.state === 'DISPATCH_POSSIBLE') {
          if (observed.protocol !== 'vitrify.cutout.v2' || !sameIdentity(observed, job.identity) || observed.request !== job.request) throw fail('CUTOUT_V2_RESPONSE_INVALID');
          assertCurrent(id, live);
          return job; // asynchronous ACK is not response/artifact success
        }
        const response = responseFor(observed as CutoutV2Response, job);
        job = await update(id, live, job, { state: 'RESPONSE_OBSERVED', response });
      } finally { await prepared.cleanup(); }
      return artifact(id, live, job);
    }
  }
  return {
    observeVerifiedResult(input: CutoutV2Identity, response: CutoutV2Response): Promise<CutoutV2Job> {
      const id=identity(input), live=captureOwnerPublication(id.owner);
      return guarded(id,live,async()=>{
        const before=await readUnderGuard(id);
        if (before) return before; // never replace an existing request/UNKNOWN
        if (options.currentItem(id)?.cutoutProtocol!==2) throw fail('CUTOUT_V2_LEGACY_ITEM_BLOCKED');
        const job:CutoutV2Job={version:2,identity:id,request:response.request,state:'RESPONSE_OBSERVED',revision:0,prepareAttempts:0,preparationStopped:false,response};
        job.response=responseFor(response,job);
        return writeUnderGuard(id,live,undefined,job);
      });
    },
    createNew(input: CutoutV2Identity) { const id = identity(input); return create(id, captureOwnerPublication(id.owner)); },
    read(input: CutoutV2Identity) { const id = identity(input); return guarded(id, captureOwnerPublication(id.owner), () => readUnderGuard(id)); },
    run(input: CutoutV2Identity): Promise<CutoutV2Job> {
      const id = identity(input), key = cutoutV2Key(id), live = captureOwnerPublication(id.owner);
      const active = running.get(key); if (active) return active;
      const work = withAccountWriteWorkflow(id.owner, () => runUnlocked(id, live)).finally(() => { running.delete(key); });
      running.set(key, work); return work;
    },
    reconcile(input: CutoutV2Identity, recoverCompletion = false): Promise<CutoutV2Job> {
      const id = identity(input), live = captureOwnerPublication(id.owner);
      return withAccountWriteWorkflow(id.owner, async () => {
        const job = await guarded(id, live, () => readUnderGuard(id));
        if (!job) throw fail('CUTOUT_V2_JOURNAL_MISSING');
        if (job.state !== 'DISPATCH_POSSIBLE') return job;
        const provider = backend();
        const admitted = await guarded(id, live, async () => ({ pending: (recoverCompletion && provider.recoverCompletion ? provider.recoverCompletion : provider.status)(job) }));
        const result = await admitted.pending;
        if (result.state !== 'RESPONSE_OBSERVED') return guarded(id, live, async () => (await readUnderGuard(id))!);
        return update(id, live, job, { state: 'RESPONSE_OBSERVED', response: responseFor(result.response, job) });
      });
    },
  };
}

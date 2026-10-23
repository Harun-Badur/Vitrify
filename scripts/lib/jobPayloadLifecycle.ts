import { createHash } from 'node:crypto';

export const JOB_RECOVERY_MAX_MS = 24 * 60 * 60 * 1000;
export interface LifecycleJob {
  id: string; ownerId: string; status: 'queued' | 'running' | 'completed' | 'error';
  attempt: string; revision: number; requestPayload: string | null; resultPacket: string | null;
  resultHash?: string; completedAt?: number; acknowledgedAt?: number; recoveryUntil?: number;
}
export interface JobTransaction {
  job: LifecycleJob;
  ownerFenced: boolean;
}
/** Must atomically lock job + owner fence and persist the update before returning. */
export interface JobLifecycleStore {
  transaction<T>(jobId: string, operation: (transaction: JobTransaction) => T): Promise<T>;
}
const clock = (now: number) => { if (!Number.isFinite(now)) throw new Error('Invalid clock'); };

/** Off-path protocol, NOT installed into the existing worker. Pending/error policy remains unchanged. */
export async function publishCompletedJob(store: JobLifecycleStore, id: string, attempt: string,
  packet: string, now: number, deliveryRecoveryMs: number): Promise<string> {
  clock(now);
  if (!attempt || !packet || !Number.isFinite(deliveryRecoveryMs) || deliveryRecoveryMs <= 0 || deliveryRecoveryMs > JOB_RECOVERY_MAX_MS) {
    throw new Error('Explicit bounded delivery recovery required');
  }
  return store.transaction(id, tx => {
    const job = tx.job;
    if (tx.ownerFenced || job.status !== 'running' || job.attempt !== attempt) throw new Error('Stale/fenced worker publication');
    job.resultPacket = packet;
    job.resultHash = createHash('sha256').update(packet).digest('hex');
    job.status = 'completed'; job.completedAt = now; job.recoveryUntil = now + deliveryRecoveryMs;
    delete job.acknowledgedAt; job.revision++;
    return job.resultHash;
  });
}
/** authenticatedOwner must come from verified server authentication, never request body owner. */
export async function acknowledgeJobResult(store: JobLifecycleStore, id: string, authenticatedOwner: string,
  resultHash: string, now: number): Promise<void> {
  clock(now);
  return store.transaction(id, tx => {
    const job = tx.job;
    if (tx.ownerFenced || job.ownerId !== authenticatedOwner || job.status !== 'completed' ||
      !job.resultHash || job.resultHash !== resultHash || job.completedAt === undefined || now < job.completedAt) throw new Error('Invalid result acknowledgment');
    if (job.acknowledgedAt !== undefined) return; // idempotent identical acknowledgment
    job.acknowledgedAt = now; job.requestPayload = null; job.resultPacket = null; job.revision++;
  });
}
/** Only a verified completed revision can be purged; no queued/running/error expiry invented. */
export async function purgeCompletedPayload(store: JobLifecycleStore, id: string, expectedRevision: number, now: number): Promise<boolean> {
  clock(now);
  return store.transaction(id, tx => {
    const job = tx.job;
    if (tx.ownerFenced || job.revision !== expectedRevision || job.status !== 'completed' || job.completedAt === undefined || !job.resultHash) return false;
    const acknowledged = job.acknowledgedAt !== undefined;
    const recoveryExpired = job.recoveryUntil !== undefined && job.recoveryUntil > job.completedAt &&
      job.recoveryUntil - job.completedAt <= JOB_RECOVERY_MAX_MS && now >= job.recoveryUntil;
    if (!acknowledged && !recoveryExpired) return false;
    job.requestPayload = null; job.resultPacket = null; job.revision++;
    return true;
  });
}

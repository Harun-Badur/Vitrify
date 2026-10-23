/** Shared client/server deletion state machine. HTTP success is never completion evidence. */
export type DeletionState = 'PENDING' | 'RUNNING' | 'VERIFIED' | 'RETRY_REQUIRED' | 'UNKNOWN' | 'BLOCKED';
export const DELETION_LAYERS = {
  write_fence: { owner: 'server', cleanup: 'quiesce user uploads, ingest and worker writes', before: [] },
  queue: { owner: 'device', cleanup: 'stop/drain in-flight analytics and remove user queue', before: [] },
  storage: { owner: 'server', cleanup: 'enumerate/remove/verify all owned model, cutout and derived objects', before: ['write_fence'] },
  jobs_payload: { owner: 'server', cleanup: 'quiesce owned jobs; remove and verify owned payloads', before: ['write_fence'] },
  db: { owner: 'server', cleanup: 'delete and verify all owned DB rows before Auth', before: ['write_fence', 'jobs_payload'] },
  async_storage: { owner: 'device', cleanup: 'remove and verify inventoried per-user keys', before: ['queue'] },
  local_files: { owner: 'device', cleanup: 'remove/verify owned local photos, history and derived files', before: [] },
  memory_cache: { owner: 'device', cleanup: 'clear user state and in-flight references; verify', before: [] },
  recommendation_cache: { owner: 'server+device', cleanup: 'purge owned persistent/session caches and verify', before: ['write_fence'] },
  auth: { owner: 'server', cleanup: 'delete Auth LAST and verify absence', before: ['write_fence', 'storage', 'jobs_payload', 'db', 'queue', 'async_storage', 'local_files', 'memory_cache', 'recommendation_cache'] },
  vendor: { owner: 'provider', cleanup: 'UNKNOWN account-specific procedure', before: [] },
  backup: { owner: 'operator+provider', cleanup: 'UNKNOWN retention/restore deletion policy', before: [] },
  export: { owner: 'operator', cleanup: 'UNKNOWN inventory and purge evidence', before: [] },
} as const;
export type DeletionLayer = keyof typeof DELETION_LAYERS;
export interface LayerProgress {
  state: DeletionState; attempts: number; evidence: string[]; errorCode?: string;
}
export interface DeletionReceipt {
  requestId: string; subjectId: string; layers: Record<DeletionLayer, LayerProgress>;
}
export interface DeletionAdapter {
  /** Only idempotent methods may participate in resume/retry. */
  idempotent: true;
  cleanup(receipt: DeletionReceipt): Promise<void>;
  verify(receipt: DeletionReceipt): Promise<{ complete: boolean; evidence: string[] }>;
}
const EXTERNAL = new Set<DeletionLayer>(['vendor', 'backup', 'export']);
// v1 protocol note: declarations use the existing UNKNOWN vendor evidence array;
// they never certify physical deletion or provider retention and never gate Auth.
export const DELETION_DECLARATIONS = ['UNKNOWN yüklemeler sweep ile silinir', 'sağlayıcı: politika gereği, doğrulanmadı'] as const;
const BACKUP_DECLARATION = 'yedek: saklama/geri yükleme politikası beyanı, doğrulanmadı';
const hasEvidence = (evidence: unknown): evidence is string[] => Array.isArray(evidence) && evidence.length > 0 &&
  evidence.every(value => typeof value === 'string' && value.trim().length > 0);
export function isDeletionReceipt(value: unknown): value is DeletionReceipt {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as DeletionReceipt;
  return typeof receipt.requestId === 'string' && !!receipt.requestId.trim() &&
    typeof receipt.subjectId === 'string' && !!receipt.subjectId.trim() && !!receipt.layers &&
    Object.keys(DELETION_LAYERS).every(layer => {
      const progress = receipt.layers[layer as DeletionLayer];
      return !!progress && ['PENDING', 'RUNNING', 'VERIFIED', 'RETRY_REQUIRED', 'UNKNOWN', 'BLOCKED'].includes(progress.state) &&
        Number.isSafeInteger(progress.attempts) && progress.attempts >= 0 && Array.isArray(progress.evidence) &&
        progress.evidence.every(item => typeof item === 'string') &&
        (progress.state !== 'VERIFIED' || hasEvidence(progress.evidence));
    });
}
export function createDeletionReceipt(requestId: string, subjectId: string): DeletionReceipt {
  if (!requestId.trim() || !subjectId.trim()) throw new Error('Deletion identity required');
  return { requestId, subjectId, layers: Object.fromEntries(Object.keys(DELETION_LAYERS).map(layer =>
    [layer, { state: EXTERNAL.has(layer as DeletionLayer) ? 'UNKNOWN' : 'PENDING', attempts: 0,
      evidence: layer === 'vendor' ? [...DELETION_DECLARATIONS] : [] }])) as unknown as DeletionReceipt['layers'] };
}
export function deletionCompletion(receipt: DeletionReceipt) {
  if (!isDeletionReceipt(receipt)) return { appControlledComplete: false, allLayersComplete: false };
  const verified = (layer: string) => receipt.layers[layer as DeletionLayer]?.state === 'VERIFIED' &&
    hasEvidence(receipt.layers[layer as DeletionLayer].evidence);
  return { appControlledComplete: Object.keys(DELETION_LAYERS).filter(layer => !EXTERNAL.has(layer as DeletionLayer)).every(verified),
    allLayersComplete: Object.keys(DELETION_LAYERS).every(verified) };
}

/** Caller supplies a durable checkpoint store; no polling/backoff or production binding here. */
export async function runDeletionFoundation(receipt: DeletionReceipt,
  adapters: Partial<Record<DeletionLayer, DeletionAdapter>>,
  checkpoint: (snapshot: DeletionReceipt) => Promise<void>): Promise<DeletionReceipt> {
  if (!isDeletionReceipt(receipt)) throw new Error('Deletion receipt invalid');
  receipt.layers.vendor.evidence = [...new Set([...receipt.layers.vendor.evidence, ...DELETION_DECLARATIONS])];
  receipt.layers.backup.evidence = [...new Set([...receipt.layers.backup.evidence, BACKUP_DECLARATION])];
  const save = () => checkpoint(JSON.parse(JSON.stringify(receipt)) as DeletionReceipt);
  for (const layer of Object.keys(DELETION_LAYERS) as DeletionLayer[]) {
    // External legal/vendor evidence is deliberately not automated in this pass.
    if (EXTERNAL.has(layer)) continue;
    const progress = receipt.layers[layer], adapter = adapters[layer];
    if (!adapter) { progress.state = 'UNKNOWN'; progress.evidence = []; await save(); continue; }
    if (DELETION_LAYERS[layer].before.some(required => receipt.layers[required as DeletionLayer].state !== 'VERIFIED' ||
      !hasEvidence(receipt.layers[required as DeletionLayer].evidence))) {
      progress.state = 'BLOCKED'; progress.evidence = []; await save(); continue;
    }
    // Never execute irreversible cleanup after an unpersisted RUNNING transition.
    progress.state = 'RUNNING'; progress.attempts++; progress.evidence = []; delete progress.errorCode;
    await save();
    try {
      if (adapter.idempotent !== true) throw new Error('Idempotent adapter required');
      const existing = await adapter.verify(receipt);
      if (!existing.complete || !hasEvidence(existing.evidence)) await adapter.cleanup(receipt);
      const proof = await adapter.verify(receipt);
      if (!proof.complete || !hasEvidence(proof.evidence)) throw new Error('Verification missing');
      progress.state = 'VERIFIED'; progress.evidence = proof.evidence;
    } catch {
      progress.state = 'RETRY_REQUIRED'; progress.errorCode = 'CLEANUP_OR_VERIFICATION_FAILED';
    }
    await save();
  }
  return receipt;
}

import { runAdmittedStorageUpload, type StorageAdmissionPort, type StorageOperation } from './accountStorageAdmission.ts';
import { MODEL_PHOTO_MAX_BYTES, MODEL_PHOTO_TOO_LARGE, MODEL_PHOTO_SIZE_MESSAGE } from './accountStorageUploadLimits.ts';
import { CUTOUT_V2_ENABLED, cutoutHash } from './cutoutV2Control.ts';
import { validCutoutPng } from './cutoutV2Png.ts';

export const UPLOAD_HANDLER_DEADLINE_MS = 60_000;

export interface UploadServerClient {
  auth: { getUser(token: string): Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: unknown }>;
  storage: { from(bucket: string): { upload(path: string, body: ArrayBuffer, options: { contentType: string; upsert: boolean }):
    Promise<{ data: { id?: string; path?: string; fullPath?: string } | null; error: unknown }>;
    remove(paths: string[]): PromiseLike<{ data: unknown; error: unknown }> } };
}
const protocol = 'vitrify.storage-upload.v1';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-upload-bucket, x-upload-path, x-upload-request', 'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS' };
const reply = (status: number, state: string, extra: object = {}) => new Response(JSON.stringify({ protocol, state, ...extra }),
  { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
export function validUploadPath(owner: string, bucket: string, path: string) {
  if (!uuid.test(owner)) return false;
  if (bucket === 'model-photos') return path === `${owner}/model.jpg`;
  // Keep encodeURIComponent(item.id) compatibility; disallow decoded separators/traversal.
  const parts = path.split('/');
  if (bucket !== 'wardrobe-cutouts' || parts.length !== 3 || parts[0] !== owner) return false;
  if (parts[2] !== 'cutout.png') return uuid.test(parts[1]) && /^original-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}[.]png$/i.test(parts[2]);
  try { const item = decodeURIComponent(parts[1]);
    return parts[1].length <= 300 && item.length > 0 && !/[\/\\\x00-\x1f]/.test(item) && !['.', '..'].includes(item);
  } catch { return false; }
}
async function bytes(request: Request, limit: number): Promise<ArrayBuffer> {
  if (!request.body) throw new Error('EMPTY_BODY');
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break;
    size += value.length; if (size > limit) throw new Error('BODY_TOO_LARGE'); chunks.push(value); }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error instanceof Error && error.message === 'BODY_TOO_LARGE' ? error : new Error('BODY_INVALID');
  }
  finally { reader.releaseLock(); }
  if (!size) throw new Error('EMPTY_BODY');
  const output = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output.buffer;
}
const args = (op: StorageOperation) => ({ p_operation: op.operation, p_lease: op.lease, p_subject: op.owner, p_bucket: op.bucket, p_path: op.path });
export function accountStorageUploadHandler(baseAdmin: UploadServerClient, userClient: (jwt: string, signal?: AbortSignal) => UploadServerClient,
  scopedAdmin?: (signal: AbortSignal) => UploadServerClient, cutoutV2Enabled = CUTOUT_V2_ENABLED) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST' && request.method !== 'DELETE') return reply(405, 'REJECTED');
    let dispatched = false;
    const controller = new AbortController();
    const admin = scopedAdmin?.(controller.signal) ?? baseAdmin;
    let confirmed: { bucket: string; path: string } | undefined;
    let terminalStarted = false;
    let cleanupPromise: Promise<void> | undefined;
    const cleanup = (): Promise<void> => {
      // UNKNOWN retains the existing unresolved-path exclusion. Never compensate
      // after terminal dispatch: a committed SUCCEEDED can admit a newer writer.
      if (!confirmed || terminalStarted) return Promise.resolve();
      const target = confirmed;
      return cleanupPromise ??= (async () => {
        try { const result = await baseAdmin.storage.from(target.bucket).remove([target.path]);
          if (result.error) console.error('ACCOUNT_STORAGE_UPLOAD_CLEANUP_FAILED');
        } catch { console.error('ACCOUNT_STORAGE_UPLOAD_CLEANUP_FAILED'); }
      })();
    };
    const expired = () => { if (controller.signal.aborted) throw new Error('UPLOAD_DEADLINE'); };
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<Response>(resolve => {
      timer = setTimeout(() => { controller.abort(); void cleanup(); resolve(reply(503, dispatched ? 'UNKNOWN' : 'BLOCKED')); }, UPLOAD_HANDLER_DEADLINE_MS);
    });
    const execute = async (): Promise<Response> => {
    try {
      const v2 = request.headers.get('x-cutout-protocol') === 'vitrify.cutout.v2';
      if (v2 && (!cutoutV2Enabled || request.method !== 'POST')) return reply(503, 'BLOCKED');
      let v2Admission: StorageOperation | undefined;
      let preparedBody: ArrayBuffer | undefined;
      let job: string | undefined;
      if (v2) {
        job = request.headers.get('x-cutout-job') ?? '';
        const token = request.headers.get('x-cutout-capability') ?? '';
        if (!uuid.test(job) || !/^[a-f0-9]{64}$/.test(token) || request.headers.get('content-type') !== 'image/png') return reply(403, 'BLOCKED');
        const checked = await admin.rpc('cutout_v2_command', { p_action: 'source', p_value: {
          job, tokenHash: await cutoutHash(new TextEncoder().encode(token)),
        } }); expired();
        if (checked.error || checked.data?.bucket !== 'wardrobe-cutouts') return reply(403, 'BLOCKED');
        preparedBody = await bytes(request, 12 * 1024 * 1024); expired();
        if (!validCutoutPng(preparedBody)) return reply(422, 'REJECTED');
        const admission = await admin.rpc('cutout_v2_command', { p_action: 'admit', p_value: {
          job, tokenHash: await cutoutHash(new TextEncoder().encode(token)), digest: await cutoutHash(preparedBody), bytes: preparedBody.byteLength,
        } }); expired();
        const op = admission.data;
        if (admission.error || !op || !uuid.test(op.owner ?? '') || !uuid.test(op.operation ?? '') || !uuid.test(op.lease ?? '') ||
          op.bucket !== 'wardrobe-cutouts' || typeof op.path !== 'string' || !new RegExp(`^${op.owner}/[a-f0-9-]{36}/cutout-${job}[.]png$`, 'i').test(op.path)) return reply(503, 'UNKNOWN');
        v2Admission = op;
      }
      const jwt = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
      if (!v2Admission && !jwt) return reply(401, 'REJECTED');
      const auth = v2Admission ? { data: { user: { id: v2Admission.owner } }, error: null } : await admin.auth.getUser(jwt!);
      expired();
      if (auth.error || !auth.data.user) return reply(401, 'REJECTED');
      const owner = auth.data.user.id;
      const bucket = v2Admission?.bucket ?? request.headers.get('x-upload-bucket') ?? '';
      const path = v2Admission?.path ?? request.headers.get('x-upload-path') ?? '';
      if (request.method === 'DELETE') {
        // Existing model-photo remove UX uses the sole privileged Storage path.
        // No upload admission/UNKNOWN transition or arbitrary bucket/path deletion.
        if (bucket !== 'model-photos' || !validUploadPath(owner, bucket, path)) return reply(400, 'REJECTED');
        const fence = await admin.rpc('deletion_is_fenced', { owner }); expired();
        if (fence.error || fence.data !== false) return reply(503, 'BLOCKED');
        const removed = await admin.storage.from(bucket).remove([path]); expired();
        if (removed.error) return reply(503, 'BLOCKED');
        return reply(200, 'REMOVED', { protocol: 'vitrify.storage-remove.v1' });
      }
      const contentType = request.headers.get('content-type') ?? '';
      if ((!v2Admission && !validUploadPath(owner, bucket, path)) || contentType !== (bucket === 'model-photos' ? 'image/jpeg' : 'image/png')) return reply(400, 'REJECTED');
      let body: ArrayBuffer;
      try { body = preparedBody ?? await bytes(request, bucket === 'model-photos' ? MODEL_PHOTO_MAX_BYTES : 12 * 1024 * 1024); }
      catch (error) {
        if (bucket === 'model-photos' && error instanceof Error && error.message === 'BODY_TOO_LARGE') {
          return reply(413, 'REJECTED', { code: MODEL_PHOTO_TOO_LARGE, maxBytes: MODEL_PHOTO_MAX_BYTES, detail: MODEL_PHOTO_SIZE_MESSAGE });
        }
        return reply(400, 'REJECTED');
      }
      expired();
      // Stable default identity prevents identical implicit retries after a lost reply.
      const digest = async (value: BufferSource) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))]
        .map(byte => byte.toString(16).padStart(2, '0')).join('');
      const requestId = request.headers.get('x-upload-request') ?? await digest(new TextEncoder().encode(
        JSON.stringify([owner, bucket, path, await digest(body)])));
      if (!/^[a-zA-Z0-9-]{1,100}$/.test(requestId)) return reply(400, 'REJECTED');
      expired();
      const user = v2Admission ? undefined : userClient(jwt!, controller.signal); // V1 remains JWT-scoped; V2 cap owner comes from locked job.
      let successProof = '';
      const port: StorageAdmissionPort = {
        admit: async () => {
          if (v2Admission) return v2Admission;
          const result = await user!.rpc('storage_upload_admit', { p_bucket: bucket, p_path: path, p_request: requestId });
          expired();
          const op = result.data;
          if (result.error || !op || !uuid.test(op.operation ?? '') || !uuid.test(op.lease ?? '')) throw new Error('ADMISSION_UNAVAILABLE');
          return op;
        },
        start: async op => { expired(); const result = await admin.rpc('storage_upload_start', args(op));
          expired();
          if (result.error) throw new Error('START_CHECKPOINT_UNAVAILABLE'); return result.data === true; },
        write: async () => {
          expired();
          dispatched = true;
          const result = await admin.storage.from(bucket).upload(path, body, { contentType, upsert: !v2Admission && !path.split('/').at(-1)?.startsWith('original-') });
          // Any error AFTER dispatch is ambiguous; HTTP 4xx/5xx is not pre-write proof.
          if (result.error || !result.data || !uuid.test(result.data.id ?? '') || result.data.path !== path || result.data.fullPath !== `${bucket}/${path}`) return { state: 'UNKNOWN' };
          confirmed = { bucket, path };
          if (controller.signal.aborted) { await cleanup(); throw new Error('UPLOAD_DEADLINE'); }
          let fence;
          try { fence = await admin.rpc('deletion_is_fenced', { owner }); }
          catch { await cleanup(); throw new Error('FENCE_CHECK_UNAVAILABLE'); }
          if (controller.signal.aborted || fence.error || typeof fence.data !== 'boolean') {
            await cleanup(); throw new Error('FENCE_CHECK_UNAVAILABLE');
          }
          if (fence.data) { await cleanup(); throw new Error('UPLOAD_FENCED'); }
          successProof = JSON.stringify({ objectId: result.data.id, bucket, path, response: 'STORAGE_SUCCESS' });
          return { state: 'COMMITTED', proof: successProof };
        },
        verifyTerminal: async (_, outcome) => outcome.state === 'COMMITTED' && !!successProof && outcome.proof === successProof,
        terminal: async (op, state, proof) => {
          expired();
          if (state !== 'SUCCEEDED') throw new Error('UNSUPPORTED_TERMINAL');
          terminalStarted = true;
          const result = await admin.rpc('storage_upload_succeed', { ...args(op), p_proof: JSON.parse(proof) });
          expired();
          if (result.error || result.data !== true) throw new Error('TERMINAL_CHECKPOINT_UNAVAILABLE');
        },
      };
      const op = await runAdmittedStorageUpload(port, owner, bucket, path);
      if (v2Admission) {
        const done = await admin.rpc('cutout_v2_command', { p_action: 'finalize', p_value: { job, operation: op.operation } }); expired();
        if (done.error || done.data?.state !== 'SUCCEEDED') return reply(503, 'UNKNOWN');
        return reply(200, 'SUCCEEDED', { protocol: 'vitrify.cutout.v2', ...done.data });
      }
      return reply(200, 'SUCCEEDED', { operation: op.operation, owner, bucket, path });
    } catch (error) {
      // No automatic replay, no token/provider error exposure. A missing RPC is fail-closed.
      return reply(503, error instanceof Error && error.message === 'UPLOAD_FENCED' ? 'BLOCKED' : dispatched ? 'UNKNOWN' : 'BLOCKED');
    }
    };
    try { return await Promise.race([execute(), deadline]); }
    finally { clearTimeout(timer!); }
  };
}

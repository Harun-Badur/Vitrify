import { createDeletionReceipt, deletionCompletion, isDeletionReceipt, runDeletionFoundation, type DeletionAdapter, type DeletionLayer, type DeletionReceipt } from './accountDeletionFoundation.ts';

export const DELETION_PROTOCOL = 'vitrify.deletion.v1';
export const DEVICE_LAYERS = ['queue', 'async_storage', 'local_files', 'memory_cache'] as const;
export interface DeletionLease { receipt: DeletionReceipt; lease: string; drainRemainingMs?: number }
export interface DeletionReadiness { ready: boolean; blockers: string[] }
export interface DeletionPort {
  readiness(): Promise<boolean | DeletionReadiness>;
  authenticate(token: string): Promise<string | null>;
  // begin atomically checks subject/request/capability and acquires a durable exclusive lease.
  begin(subject: string | null, requestId: string, recoveryToken: string): Promise<DeletionLease>;
  save(lease: DeletionLease, receipt: DeletionReceipt): Promise<void>;
  prepare?(lease:DeletionLease):Promise<void>;
  release(lease: DeletionLease): Promise<void>;
  adapters(lease: DeletionLease): Partial<Record<DeletionLayer, DeletionAdapter>>;
}
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-deletion-recovery', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const response = (body: object, status: number) => new Response(JSON.stringify({ protocol: DELETION_PROTOCOL, ...body }), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const deviceProof = (value: unknown): value is DeletionReceipt => {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as DeletionReceipt;
  return DEVICE_LAYERS.every(layer => receipt.layers?.[layer]?.state === 'VERIFIED' &&
    Number.isSafeInteger(receipt.layers[layer].attempts) && receipt.layers[layer].attempts >= 0 &&
    Array.isArray(receipt.layers[layer].evidence) && receipt.layers[layer].evidence.length > 0 &&
    receipt.layers[layer].evidence.every(item => typeof item === 'string' && item.trim().length > 0));
};

/** Initial JWT and recovery capability are separate credentials. Never trust client server-layer states. */
export function deletionHandler(port: DeletionPort) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!['GET', 'POST'].includes(request.method)) return response({ detail: 'Method unsupported' }, 405);
    let lease: DeletionLease | undefined;
    try {
      const recovery = request.headers.get('x-deletion-recovery');
      // Recovery is POST-only: a bare header must never authorize GET readiness.
      // GET has no request identity with which to validate a durable capability.
      if (request.method === 'GET' && recovery !== null) return response({ detail: 'Authentication required' }, 401);
      const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
      const subject = recovery ? null : bearer ? await port.authenticate(bearer) : null;
      if (!recovery && !subject) return response({ detail: 'Authentication required' }, 401);
      const readiness = await port.readiness();
      const ready = typeof readiness === 'boolean' ? readiness : readiness.ready === true;
      // Existing v1 fields/types remain unchanged. Only known infrastructure reasons
      // may leave the server; raw RPC messages must never become client output.
      const blockers = ready ? [] : typeof readiness === 'boolean' ? ['fence_unavailable'] :
        readiness.blockers.filter(code => ['fence_unavailable', 'lease_unavailable'].includes(code));
      if (!ready && !blockers.length) blockers.push('fence_unavailable');
      if (request.method === 'GET') return response({ ready, postAuthRecovery: ready, blockers }, 200);
      if (!ready) return response({ detail: blockers[0] }, 503);
      const body = await request.json();
      const token = recovery ?? body.recoveryToken;
      if (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(body.requestId) ||
        typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return response({ detail: 'Invalid deletion identity' }, 400);
      if (!recovery && (!deviceProof(body.deviceCheckpoint) || body.deviceCheckpoint.subjectId !== subject ||
        body.deviceCheckpoint.requestId !== body.requestId)) return response({ detail: 'Device evidence missing' }, 400);
      lease = await port.begin(subject, body.requestId, token);
      if (lease.receipt.requestId !== body.requestId || (subject && lease.receipt.subjectId !== subject)) throw new Error('Receipt identity mismatch');
      lease.receipt.layers = { ...createDeletionReceipt(lease.receipt.requestId, lease.receipt.subjectId).layers, ...lease.receipt.layers };
      if (!isDeletionReceipt(lease.receipt)) throw new Error('Durable receipt invalid');
      // A durable completion is replayed as-is under the same capability/lease.
      // Do not increment layer attempts or issue another Auth delete on duplicate POST.
      if (deletionCompletion(lease.receipt).appControlledComplete) return response({ receipt: lease.receipt, complete: true }, 200);
      // Only initial authenticated submissions may supply device proofs. Recovery uses durable proofs.
      if (subject) for (const layer of DEVICE_LAYERS) lease.receipt.layers[layer] = body.deviceCheckpoint.layers[layer];
      if (!deviceProof(lease.receipt)) throw new Error('Durable device proof missing');
      if (subject) await port.save(lease, lease.receipt);
      // Internal RPC duration uses DB time. Persist device proofs before returning
      // pending so the same capability can resume without another client checkpoint.
      if (lease.drainRemainingMs !== undefined) {
        if (!Number.isSafeInteger(lease.drainRemainingMs) || lease.drainRemainingMs < 0) throw new Error('Drain unavailable');
        if (lease.drainRemainingMs > 0) {
          if (!subject) await port.save(lease, lease.receipt);
          return response({ detail: 'Deletion pending; retry with the same recovery identity' }, 503);
        }
      }
      // Durable private handoff must succeed before any identity can be purged.
      if(port.prepare){
        try{await port.prepare(lease);}
        catch{
          lease.receipt.layers.db={state:'RETRY_REQUIRED',attempts:lease.receipt.layers.db.attempts+1,evidence:[],errorCode:'PREMIUM_CHECKPOINT_UNAVAILABLE'};
          await port.save(lease,lease.receipt);
          throw new Error('Private handoff unavailable');
        }
      }
      const adapters = port.adapters(lease);
      for (const layer of DEVICE_LAYERS) {
        const evidence = [...lease.receipt.layers[layer].evidence];
        adapters[layer] = { idempotent: true, cleanup: async () => { throw new Error('Device proof missing'); },
          verify: async () => ({ complete: true, evidence }) };
      }
      await runDeletionFoundation(lease.receipt, adapters, receipt => port.save(lease!, receipt));
      return response({ receipt: lease.receipt, complete: deletionCompletion(lease.receipt).appControlledComplete }, 200);
    } catch (error) {
      // Never leak SQL, tokens, user inventories or provider errors.
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
      if (typeof code === 'string' && ['lease_held_by_other', 'fence_unavailable', 'lease_unavailable'].includes(code)) {
        return response({ detail: code }, 503);
      }
      return response({ detail: 'Deletion pending; retry with the same recovery identity' }, 503);
    } finally {
      if (lease) { try { await port.release(lease); } catch { /* lease expiry controls retries */ } }
    }
  };
}
export { createDeletionReceipt };

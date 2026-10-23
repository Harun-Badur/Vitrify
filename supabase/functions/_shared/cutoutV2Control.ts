export const CUTOUT_V2_ENABLED = false; // Separate activation approval required.
export type CutoutRecord = Record<string, unknown>;
export interface CutoutControlPorts {
  enabled: boolean;
  auth(jwt: string): Promise<string | null>;
  rpc(action: string, value: CutoutRecord): Promise<CutoutRecord>;
  dispatch(job: string, capability: string): Promise<void>;
  source(bucket: string, path: string): Promise<ArrayBuffer>;
}
export const cutoutHash = async (bytes: BufferSource) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map(value => value.toString(16).padStart(2, '0')).join('');
const secret = () => [...crypto.getRandomValues(new Uint8Array(32))].map(value => value.toString(16).padStart(2, '0')).join('');
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const reply = (status: number, body: CutoutRecord) => new Response(JSON.stringify({ protocol: 'vitrify.cutout.v2', ...body }), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
const failureStatus: Record<string, number> = {
  CUTOUT_V2_DISABLED: 503, CUTOUT_V2_ORIGINAL_CHANGED: 409, CUTOUT_V2_REQUEST_CONFLICT: 409,
  CUTOUT_V2_REVISION_CONFLICT: 409, CUTOUT_V2_DISPATCH_UNCERTAIN: 409, CUTOUT_V2_CAPABILITY_INVALID: 403,
  CUTOUT_V2_COMPLETION_INVALID: 422, CUTOUT_V2_STORAGE_UNVERIFIED: 503,
};
export function cutoutRpcFailure(error: { message?: string }) {
  const code = error.message && failureStatus[error.message] ? error.message : 'CUTOUT_V2_UNVERIFIED';
  return Object.assign(new Error('Cutout operation unverified'), { code });
}
/** No Storage writes. Ports are injectable for offline tests; runtime flag is OFF. */
export function cutoutV2ControlHandler(ports: CutoutControlPorts) {
  return async (request: Request): Promise<Response> => {
    if (!ports.enabled) return reply(503, { code: 'CUTOUT_V2_DISABLED' });
    try {
      const url = new URL(request.url), route = url.pathname.split('/').at(-1)!;
      const read = ['status', 'result', 'source'].includes(route);
      if (request.method !== (read ? 'GET' : 'POST')) return reply(405, { code: 'METHOD_INVALID' });
      if (!['reserve', 'execute', 'claim', 'close', 'reconcile', 'status', 'result', 'source'].includes(route)) return reply(404, { code: 'ROUTE_UNKNOWN' });
      if (!read && Number(request.headers.get('content-length') ?? 0) > 2048) return reply(413, { code: 'BODY_TOO_LARGE' });
      const raw = read ? '' : await request.text();
      if (raw.length > 2048) return reply(413, { code: 'BODY_TOO_LARGE' });
      const body: CutoutRecord = read ? Object.fromEntries(url.searchParams) : JSON.parse(raw);
      if (!body || typeof body !== 'object' || Array.isArray(body) || 'owner' in body) return reply(400, { code: 'BODY_INVALID' });
      if (route === 'claim' || route === 'source') {
        const token = request.headers.get('x-cutout-capability') ?? '';
        if (!uuid(body.jobId) || !/^[a-f0-9]{64}$/.test(token)) return reply(403, { code: 'CAPABILITY_INVALID' });
        const next = secret();
        const data = await ports.rpc(route, { job: body.jobId, tokenHash: await cutoutHash(new TextEncoder().encode(token)),
          ...(route === 'claim' ? { nextHash: await cutoutHash(new TextEncoder().encode(next)) } : {}) });
        if (route === 'claim') {
          if (data.claimed !== true) return reply(409, { code: 'CLAIM_UNCERTAIN' });
          return reply(200, { claimed: true, jobId: body.jobId, completionCapability: next });
        }
        if (data.bucket !== 'wardrobe-cutouts' || typeof data.path !== 'string') return reply(503, { code: 'SOURCE_UNKNOWN' });
        const bytes = await ports.source(data.bucket, data.path);
        if (bytes.byteLength > 12582912) return reply(413, { code: 'SOURCE_TOO_LARGE' });
        return new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
      }
      const jwt = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
      const owner = jwt && await ports.auth(jwt);
      if (!owner) return reply(401, { code: 'AUTH_REQUIRED' });
      if (route === 'reserve') {
        if (!uuid(body.itemId) || !uuid(body.requestId) || typeof body.originalVersion !== 'string' || !/^[a-f0-9]{64}$/.test(body.originalVersion)) return reply(400, { code: 'IDENTITY_INVALID' });
        return reply(200, await ports.rpc('reserve', { owner, item: body.itemId, request: body.requestId, original: body.originalVersion }));
      }
      if ((!read && !uuid(body.jobId)) || (body.jobId !== undefined && !uuid(body.jobId)) || !uuid(body.requestId)) return reply(400, { code: 'IDENTITY_INVALID' });
      const value = { owner, job: body.jobId ?? null, request: body.requestId };
      if (route === 'status' || route === 'result') {
        const data = await ports.rpc('status', value);
        return reply(route === 'result' && data.state !== 'SUCCEEDED' ? 202 : 200, data);
      }
      if (route === 'reconcile') {
        // Explicit no-inference recovery. Read owner/alias first; never auto-send PNG.
        const current = await ports.rpc('status', value);
        if (current.state !== 'COMPLETING') return reply(200, current);
        await ports.rpc('reconcile', value);
        return reply(200, await ports.rpc('status', value));
      }
      if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0) return reply(400, { code: 'REVISION_INVALID' });
      const capability = secret();
      const data = await ports.rpc(route, { ...value, revision: body.revision, nextHash: await cutoutHash(new TextEncoder().encode(capability)) });
      const { dispatch, ...safe } = data;
      if (route === 'execute' && dispatch === true && uuid(body.jobId)) {
        // One attempt only after a committed ARMED checkpoint. Delivery uncertainty
        // never re-arms or retries. A provider timeout remains readable pending state.
        try { await ports.dispatch(body.jobId, capability); } catch { /* no resend */ }
      }
      return reply(route === 'execute' ? 202 : 200, safe);
    } catch (error) {
      // Never expose/log RPC text, credentials, body, URL or provider responses.
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : '';
      if (Object.prototype.hasOwnProperty.call(failureStatus, code)) return reply(failureStatus[code], { code });
      return reply(503, { code: 'CUTOUT_V2_UNVERIFIED' });
    }
  };
}

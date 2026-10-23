import { validUploadPath, type UploadServerClient } from './accountStorageUploadHandler.ts';

export const STORAGE_STATUS_PROTOCOL = 'vitrify.storage-status.v1';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const reply = (status: number, state: string, extra: object = {}) => new Response(JSON.stringify({ protocol: STORAGE_STATUS_PROTOCOL, state, ...extra }),
  { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** Read-only terminal lookup. No upload, expiry, reclaim or metadata-based resolution. */
export function accountStorageStatusHandler(admin: Pick<UploadServerClient, 'auth'>,
  userClient: (jwt: string) => Pick<UploadServerClient, 'rpc'>) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return reply(405, 'BLOCKED');
    try {
      const jwt = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') ?? '')?.[1];
      if (!jwt) return reply(401, 'BLOCKED');
      const auth = await admin.auth.getUser(jwt);
      if (auth.error || !auth.data.user) return reply(401, 'BLOCKED');
      const body = await request.json(), owner = auth.data.user.id;
      if (!body || typeof body.request !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(body.request) ||
        typeof body.bucket !== 'string' || typeof body.path !== 'string' || !validUploadPath(owner, body.bucket, body.path)) return reply(400, 'BLOCKED');
      const result = await userClient(jwt).rpc('storage_upload_status', { p_request: body.request });
      if (result.error) return reply(503, 'BLOCKED');
      const op = result.data;
      // NOT_FOUND is not non-dispatch proof; a lost/rolled-back admission ACK is ambiguous.
      if (!op) return reply(404, 'UNKNOWN');
      if (op.owner !== owner || op.request !== body.request || op.bucket !== body.bucket || op.path !== body.path ||
        !uuid.test(op.operation ?? '') || !['ADMITTED', 'UNKNOWN', 'SUCCEEDED', 'REJECTED_NO_DISPATCH'].includes(op.state)) return reply(503, 'BLOCKED');
      return reply(200, op.state, { owner, request: op.request, bucket: op.bucket, path: op.path, operation: op.operation });
    } catch { return reply(503, 'BLOCKED'); }
  };
}

import type { JanitorCounts } from './accountStorageJanitor.ts';

interface JanitorHandlerConfig {
  projectUrl?: string;
  targetProjectRef?: string;
  token?: string;
  deleteEnabled?: boolean;
  run(deleteEnabled: boolean): Promise<JanitorCounts>;
}
const DEFAULT_PROJECT_REF = 'sdjxseqfkturkfohkfni';
const APPROVED_PROJECT_REFS = new Set([DEFAULT_PROJECT_REF, 'hnujkabyyrlsxohjhxlg']);
async function sameToken(left: string, right: string) {
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let difference = 0; for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
export function storageJanitorHandler(config: JanitorHandlerConfig) {
  return async (request: Request): Promise<Response> => {
    const reply = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    // Production requires explicit server configuration; request input cannot choose a target.
    const target = config.targetProjectRef ?? DEFAULT_PROJECT_REF;
    if (!APPROVED_PROJECT_REFS.has(target) || config.projectUrl !== `https://${target}.supabase.co` || !config.token) return reply(503, { code: 'JANITOR_UNCONFIGURED' });
    if (request.method !== 'POST') return reply(405, { code: 'METHOD_NOT_ALLOWED' });
    const supplied = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
    if (!supplied || supplied.length > 4096 || !await sameToken(supplied, config.token)) return reply(401, { code: 'UNAUTHORIZED' });
    // Caller body cannot activate deletion or override scope/limits.
    try {
      const counts = await config.run(config.deleteEnabled === true);
      return reply(counts.errors ? 503 : 200, counts);
    } catch { return reply(503, { code: 'JANITOR_FAILED' }); }
  };
}

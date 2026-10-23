import type { CutoutV2Backend, CutoutV2Job, CutoutV2Response } from './wardrobeCutoutV2';

interface Options {
  enabled?: boolean; // OFF unless separately activated; no store imports this module.
  // Bind to existing authenticated Supabase SDK functions.invoke, not custom HTTP.
  invoke(route: string, method: 'GET' | 'POST', body?: Record<string, unknown>): Promise<unknown>;
  confirmed(job: CutoutV2Job): boolean; // exact item, cloud UUID, original + provenance
  canDispatch?: () => boolean;
}
const failure = () => new Error('CUTOUT_V2_API_UNVERIFIED');
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure();
  return value as Record<string, unknown>;
}
function correlated(value: unknown, job: CutoutV2Job) {
  const r = record(value);
  if (r.protocol !== 'vitrify.cutout.v2' || r.owner !== job.identity.owner || r.wardrobeItemId !== job.identity.wardrobeItemId ||
    r.originalVersion !== job.identity.originalVersion || r.request !== job.request) throw failure();
  return r;
}
function response(r: Record<string, unknown>, job: CutoutV2Job): CutoutV2Response {
  if (r.state !== 'SUCCEEDED' || typeof r.resultId !== 'string' || typeof r.pngSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(r.pngSha256)) throw failure();
  return { protocol: 'vitrify.cutout.v2', ...job.identity, request: job.request, resultId: r.resultId, pngSha256: r.pngSha256 };
}
/** Dormant adapter, no timers/polling/resend. Artifact download is a separate owned-file port. */
export function cutoutV2ApiBackend(options: Options): CutoutV2Backend {
  const assert = (job: CutoutV2Job) => { if (!options.enabled || !options.confirmed(job)) throw failure(); };
  const observe = async (job:CutoutV2Job,recover=false):ReturnType<CutoutV2Backend['status']> => {
    assert(job);
    let raw=record(await options.invoke(`status?requestId=${encodeURIComponent(job.request)}`,'GET'));
    if(raw.state==='UNKNOWN' && raw.owner===undefined)return{state:'UNKNOWN'};
    let reply=correlated(raw,job);
    if(recover && reply.state==='COMPLETING' && typeof reply.jobId==='string') {
      raw=record(await options.invoke('reconcile','POST',{jobId:reply.jobId,requestId:job.request}));
      reply=correlated(raw,job);
    }
    return reply.state==='SUCCEEDED'?{state:'RESPONSE_OBSERVED',response:response(reply,job)}:{state:'UNKNOWN'};
  };
  return {
    contract: 'vitrify.cutout.v2',
    prepare: async job => { assert(job); if(options.canDispatch?.()===false)throw failure(); return { value: null, cleanup: async () => {} }; },
    dispatch: async job => {
      assert(job);
      if(options.canDispatch?.()===false)throw failure();
      const reserved = correlated(await options.invoke('reserve', 'POST', { itemId: job.identity.wardrobeItemId, originalVersion: job.identity.originalVersion, requestId: job.request }), job);
      if (typeof reserved.jobId !== 'string' || !Number.isSafeInteger(reserved.revision)) throw failure();
      const reply = correlated(await options.invoke('execute', 'POST', { jobId: reserved.jobId, requestId: job.request, revision: reserved.revision }), job);
      if (reply.state === 'SUCCEEDED') return response(reply, job);
      if (!['ARMED', 'RUNNING', 'UNKNOWN', 'COMPLETING'].includes(String(reply.state))) throw failure();
      return { protocol: 'vitrify.cutout.v2', ...job.identity, request: job.request, state: 'DISPATCH_POSSIBLE' };
    },
    status: job=>observe(job),
    recoverCompletion: job=>observe(job,true),
  };
}

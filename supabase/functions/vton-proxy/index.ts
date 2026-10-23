import { withFashnTrial, readFashnTrialStatus } from '../_shared/fashnTrial.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { membershipPorts, readMembershipConfig } from '../_shared/premiumRuntime.ts';
import { reserveMembershipVton, settleMembershipVton } from '../_shared/premiumVton.ts';
import { beginProviderDispatch, providerDispatchRpcPort, type ProviderDispatchOperation } from '../_shared/accountProviderDispatch.ts';
import {
  buildFashnTryOnMaxRequest,
  parseFashnGenerationMode,
  parseFashnResolution,
} from './fashnTryonMax.ts';
import {
  FASHN_API_BASE_URL,
  FASHN_POLL_INTERVAL_MS,
  FASHN_POLL_TIMEOUT_MS,
  FASHN_TIMEOUT_ERROR,
  isPollContinueStatus,
  mapFashnHttpError,
  mapFashnRuntimeFailure,
  normalizePngDataUri,
  readVtonClientRequest,
  type MappedClientError,
} from './contract.ts';

const MINUTE_LIMIT = 3;
const DAY_LIMIT = 20;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-provider-request',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

interface QuotaResult {
  allowed: boolean;
  reason?: string;
  retry_after_seconds?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isQuotaResult = (value: unknown): value is QuotaResult =>
  isRecord(value) && typeof value.allowed === 'boolean';

const jsonResponse = (
  body: Record<string, unknown>,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      ...extraHeaders,
      'Content-Type': 'application/json',
    },
  });

const errorResponse = (mapped: MappedClientError): Response =>
  jsonResponse({ detail: mapped.detail }, mapped.status);

const getBearerToken = (request: Request): string | null => {
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

const pngDataUriFromOutput = async (output: string): Promise<string | null> => {
  const asDataUri = normalizePngDataUri(output);
  if (asDataUri) {
    return asDataUri;
  }
  try {
    const parsed = new URL(output);
    if (parsed.protocol !== 'https:') {
      return null;
    }
  } catch {
    return null;
  }
  try {
    const imageResponse = await fetch(output);
    if (!imageResponse.ok) {
      return null;
    }
    const buffer = new Uint8Array(await imageResponse.arrayBuffer());
    if (
      buffer.length < 8 ||
      buffer[0] !== 0x89 ||
      buffer[1] !== 0x50 ||
      buffer[2] !== 0x4e ||
      buffer[3] !== 0x47
    ) {
      return null;
    }
    return `data:image/png;base64,${bytesToBase64(buffer)}`;
  } catch {
    return null;
  }
};

const readFashnErrorName = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (isRecord(value) && typeof value.name === 'string') {
    return value.name;
  }
  return null;
};

const stripDataUriPayload = (value: string): string => {
  const comma = value.indexOf(',');
  return (comma >= 0 ? value.slice(comma + 1) : value).replace(/\s/g, '');
};

const estimateDataUriBytes = (dataUri: string): number => {
  const payload = stripDataUriPayload(dataUri);
  const padding =
    payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
};

const decodeDataUriBytes = (dataUri: string): Uint8Array => {
  const binary = atob(stripDataUriPayload(dataUri));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const readU16be = (bytes: Uint8Array, offset: number): number | null => {
  if (offset + 2 > bytes.length) {
    return null;
  }
  return (bytes[offset] << 8) | bytes[offset + 1];
};

const readU32be = (bytes: Uint8Array, offset: number): number | null => {
  if (offset + 4 > bytes.length) {
    return null;
  }
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
};

const readPersonImageSize = (
  bytes: Uint8Array,
): { width: number; height: number } | null => {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const width = readU32be(bytes, 16);
    const height = readU32be(bytes, 20);
    if (width && height) {
      return { width, height };
    }
    return null;
  }
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) {
      offset += 2;
      continue;
    }
    const length = readU16be(bytes, offset + 2);
    if (length === null || length < 2) {
      return null;
    }
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      const height = readU16be(bytes, offset + 5);
      const width = readU16be(bytes, offset + 7);
      if (width && height) {
        return { width, height };
      }
      return null;
    }
    offset += 2 + length;
  }
  return null;
};

interface FashnDebugLog {
  provider: 'fashn_tryon_max';
  resolution: string;
  generation_mode: string;
  prompt_used: boolean;
  person_base64_bytes: number;
  person_width: number | null;
  person_height: number | null;
  poll_count: number;
  latency_ms: number;
  fashn_status: string;
}

const logFashnDebug = (entry: FashnDebugLog): void => {
  console.log(JSON.stringify(entry));
};

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== 'POST' && request.method !== 'GET') {
    return jsonResponse({ detail: 'Yalnızca POST destekleniyor.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const fashnApiKey = Deno.env.get('FASHN_API_KEY')?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('vton-proxy yapılandırması eksik');
    return jsonResponse({ detail: 'Servis yapılandırılmamış.' }, 500);
  }

  if (!fashnApiKey) {
    console.error('vton-proxy FASHN yapılandırması eksik');
    return jsonResponse({ detail: 'Servis yapılandırılmamış.' }, 401);
  }

  const token = getBearerToken(request);
  if (!token) {
    return jsonResponse(
      { detail: 'Sanal deneme için giriş yapmalısın.' },
      401,
      { 'WWW-Authenticate': 'Bearer' },
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) {
    return jsonResponse(
      { detail: 'Oturumun geçersiz veya süresi dolmuş. Tekrar giriş yap.' },
      401,
      { 'WWW-Authenticate': 'Bearer' },
    );
  }

  // paused is a closed admission window for history capture / safe rollback.
  const trialFlag = Deno.env.get('VTON_TEST_TRIAL_ENABLED');
  if (trialFlag === 'paused') return jsonResponse({ detail: 'Sanal deneme geçici olarak kapalı.' }, 503);
  const trialEnabled = trialFlag === 'true';
  if (request.method === 'GET') {
    try {
      return jsonResponse(trialEnabled ? await readFashnTrialStatus(admin, user.id) : { enabled: false, used: false }, 200, { 'Cache-Control': 'no-store' });
    } catch { return jsonResponse({ detail: 'Deneme hakkı doğrulanamadı.' }, 503); }
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonResponse({ detail: 'Geçersiz sanal deneme isteği.' }, 400);
  }

  const payload = readVtonClientRequest(rawBody);
  if (!payload) {
    return jsonResponse({ detail: 'Geçersiz sanal deneme isteği.' }, 400);
  }

  const suppliedTrialRequest = request.headers.get('x-provider-request');
  const trialHash = trialEnabled ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([payload.model_image, payload.product_image]))))].map(byte => byte.toString(16).padStart(2, '0')).join('') : '';
  return withFashnTrial(admin, trialEnabled, user.id, suppliedTrialRequest, trialHash, async claimTrial => {
  // Explicit activation only after the separately approved schema/config package.
  const membershipEnabled = Deno.env.get('VTON_MEMBERSHIP_ENABLED') === 'true';
  const suppliedRequest = request.headers.get('x-provider-request');
  if (membershipEnabled && (!suppliedRequest || !/^[a-zA-Z0-9-]{1,100}$/.test(suppliedRequest))) {
    return jsonResponse({ detail: 'Geçersiz sanal deneme kimliği.' }, 400);
  }
  let quotaData: QuotaResult & { daily_limit?: number };
  let quotaError: unknown = null;
  if (membershipEnabled) {
    try {
      const config = readMembershipConfig(name => Deno.env.get(name));
      const ports = membershipPorts(admin, config);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([payload.model_image, payload.product_image])));
      const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      quotaData = await reserveMembershipVton({ ...ports, rpc: (name, args) => admin.rpc(name, args) }, user.id, suppliedRequest!, hash);
    } catch { return jsonResponse({ detail: 'Üyelik ve kota doğrulanamadı. Yeni deneme başlatılmadı.' }, 503); }
  } else {
    const legacyQuota = await admin.rpc(
    'consume_vton_quota',
    {
      p_user_id: user.id,
      p_minute_limit: MINUTE_LIMIT,
      p_day_limit: DAY_LIMIT,
    },
  );
    quotaData = legacyQuota.data;
    quotaError = legacyQuota.error;
  }

  if (quotaError || !isQuotaResult(quotaData)) {
    console.error('Kota kontrolü başarısız');
    return jsonResponse(
      { detail: 'Kota kontrolü yapılamadı. Biraz sonra tekrar dene.' },
      503,
    );
  }

  if (!quotaData.allowed) {
    if (membershipEnabled && !['daily_limit','minute_limit'].includes(quotaData.reason ?? '')) {
      return jsonResponse({ detail: 'İşlem zaten kayıtlı veya üyelik doğrulanamadı. Otomatik tekrar yapılmadı.', code: quotaData.reason ?? 'QUOTA_UNVERIFIED' }, quotaData.reason === 'membership_unverified' ? 503 : 409);
    }
    const retryAfter = quotaData.retry_after_seconds ?? 60;
    const detail =
      quotaData.reason === 'daily_limit'
        ? 'Günlük sanal deneme limitine ulaştın. Hakların 00.00 UTC’de yenilenir.'
        : `Çok hızlı deniyorsun. ${retryAfter} saniye sonra tekrar dene.`;
    return jsonResponse({ detail }, 429, {
      'Retry-After': String(retryAfter),
    });
  }

  let quotaOutcome: 'not_sent' | 'unknown' | 'completed' | 'failed' = 'not_sent';
  let quotaPrediction: string | null = null;
  try {
  const resolution = parseFashnResolution(Deno.env.get('FASHN_RESOLUTION'));
  const generationMode = parseFashnGenerationMode(
    Deno.env.get('FASHN_GENERATION_MODE'),
  );
  const runBody = buildFashnTryOnMaxRequest(
    payload.model_image,
    payload.product_image,
    {
      resolution,
      generationMode,
      prompt: Deno.env.get('FASHN_PROMPT'),
    },
  );
  const personSize = ((): { width: number; height: number } | null => {
    try {
      return readPersonImageSize(decodeDataUriBytes(payload.model_image));
    } catch {
      return null;
    }
  })();
  const debugBase = {
    provider: 'fashn_tryon_max' as const,
    resolution: runBody.inputs.resolution,
    generation_mode: runBody.inputs.generation_mode,
    prompt_used: typeof runBody.inputs.prompt === 'string',
    person_base64_bytes: estimateDataUriBytes(payload.model_image),
    person_width: personSize?.width ?? null,
    person_height: personSize?.height ?? null,
  };
  const invocationStartedAt = Date.now();
  let pollCount = 0;
  const fashnHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${fashnApiKey}`,
  };
  const emitDebug = (fashnStatus: string): void => {
    logFashnDebug({
      ...debugBase,
      poll_count: pollCount,
      latency_ms: Date.now() - invocationStartedAt,
      fashn_status: fashnStatus,
    });
  };

  const providerPort = providerDispatchRpcPort(admin);
  let providerOperation: ProviderDispatchOperation;
  try {
    const supplied = request.headers.get('x-provider-request');
    const requestId = supplied ?? [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(
      JSON.stringify([user.id, payload.model_image, payload.product_image]))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(requestId)) return jsonResponse({ detail: 'Geçersiz sanal deneme kimliği.' }, 400);
    providerOperation = await beginProviderDispatch(providerPort, user.id, 'fashn', requestId);
  } catch {
    return jsonResponse({ detail: 'Doğrulanabilir sağlayıcı işlem kaydı hazır değil.' }, 503);
  }
  let runResponse: Response;
  try {
    if (membershipEnabled) {
      // Durable uncertainty BEFORE network I/O. A crash cannot trigger a blind refund.
      quotaOutcome = 'unknown';
      await settleMembershipVton(admin, user.id, suppliedRequest!, 'dispatched');
    }
    await claimTrial();
    quotaOutcome = 'unknown';
    runResponse = await fetch(`${FASHN_API_BASE_URL}/run`, {
      method: 'POST',
      headers: fashnHeaders,
      body: JSON.stringify(runBody),
    });
  } catch {
    console.error('FASHN run çağrısı başarısız');
    emitDebug('run_unreachable');
    return jsonResponse(
      { detail: 'Sanal deneme servisine ulaşılamadı.' },
      502,
    );
  }

  if (!runResponse.ok) {
    console.error('FASHN run HTTP hatası', { status: runResponse.status });
    emitDebug(`run_http_${runResponse.status}`);
    return errorResponse(mapFashnHttpError(runResponse.status));
  }

  let runJson: unknown;
  try {
    runJson = await runResponse.json();
  } catch {
    return jsonResponse({ detail: 'Sanal deneme tamamlanamadı.' }, 502);
  }

  const predictionId =
    isRecord(runJson) && typeof runJson.id === 'string' ? runJson.id.trim() : '';
  if (predictionId.length === 0) {
    return jsonResponse({ detail: 'Sanal deneme tamamlanamadı.' }, 502);
  }
  quotaPrediction = predictionId;
  if (membershipEnabled) {
    try { await settleMembershipVton(admin, user.id, suppliedRequest!, 'unknown', predictionId); }
    catch { return jsonResponse({ detail: 'İşlem uzlaştırma için bekliyor; otomatik tekrar yapılmadı.' }, 503); }
  }
  try { await providerPort.observe(providerOperation, predictionId); }
  catch { return jsonResponse({ detail: 'Sağlayıcı yanıtı kalıcı olarak doğrulanamadı; otomatik tekrar durduruldu.' }, 503); }

  const startedAt = Date.now();
  while (Date.now() - startedAt < FASHN_POLL_TIMEOUT_MS) {
    await sleep(FASHN_POLL_INTERVAL_MS);
    pollCount += 1;
    let statusResponse: Response;
    try {
      statusResponse = await fetch(
        `${FASHN_API_BASE_URL}/status/${predictionId}`,
        { headers: { Authorization: `Bearer ${fashnApiKey}` } },
      );
    } catch {
      console.error('FASHN status çağrısı başarısız');
      return jsonResponse(
        { detail: 'Sanal deneme servisine ulaşılamadı.' },
        502,
      );
    }

    if (!statusResponse.ok) {
      console.error('FASHN status HTTP hatası', {
        status: statusResponse.status,
      });
      return errorResponse(mapFashnHttpError(statusResponse.status));
    }

    let statusJson: unknown;
    try {
      statusJson = await statusResponse.json();
    } catch {
      return jsonResponse({ detail: 'Sanal deneme tamamlanamadı.' }, 502);
    }

    if (!isRecord(statusJson) || typeof statusJson.status !== 'string') {
      return jsonResponse({ detail: 'Sanal deneme tamamlanamadı.' }, 502);
    }

    const pollStatus = statusJson.status;
    if (isPollContinueStatus(pollStatus)) {
      continue;
    }

    if (pollStatus === 'completed') {
      quotaOutcome = 'completed';
      const output = statusJson.output;
      const first =
        Array.isArray(output) && typeof output[0] === 'string' ? output[0] : null;
      if (!first) {
        return jsonResponse({ detail: 'Sanal deneme tamamlanamadı.' }, 502);
      }
      const imageDataUri = await pngDataUriFromOutput(first);
      if (!imageDataUri) {
        emitDebug('malformed_output');
        return jsonResponse({ detail: 'Sanal deneme tamamlanamadı.' }, 502);
      }
      emitDebug('completed');
      return jsonResponse({ image_data_uri: imageDataUri }, 200);
    }

    const errorName = readFashnErrorName(statusJson.error);
    if (pollStatus === 'failed') quotaOutcome = 'failed';
    emitDebug(pollStatus);
    return errorResponse(mapFashnRuntimeFailure(errorName));
  }

  emitDebug('timeout');
  return errorResponse(FASHN_TIMEOUT_ERROR);
  } finally {
    if (membershipEnabled) {
      try { await settleMembershipVton(admin, user.id, suppliedRequest!, quotaOutcome, quotaPrediction); }
      catch { return jsonResponse({ detail: 'İşlem kaydı doğrulanamadı; otomatik tekrar veya iade yapılmadı.' }, 503); }
    }
  }
  });
});

export const FASHN_API_BASE_URL = 'https://api.fashn.ai/v1';
export const FASHN_POLL_INTERVAL_MS = 2_000;
export const FASHN_POLL_TIMEOUT_MS = 90_000;

// Reuse the configured backend when no separate VTON endpoint was supplied.
// No hard-coded project fallback and no network access during resolution.
export function resolveVtonProxyUrl(explicit: string | undefined, supabaseUrl: string | undefined): string | null {
  const configured = explicit?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  if (!supabaseUrl) return null;
  try {
    const url = new URL(supabaseUrl.trim());
    if (url.protocol !== 'https:' || !/^[a-z]{20}[.]supabase[.]co$/.test(url.hostname) ||
      url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return `${url.origin}/functions/v1/vton-proxy`;
  } catch { return null; }
}

export const FASHN_POLL_CONTINUE_STATUSES = [
  'starting',
  'in_queue',
  'processing',
] as const;

export type FashnPollContinueStatus =
  (typeof FASHN_POLL_CONTINUE_STATUSES)[number];

export interface VtonClientRequest {
  model_image: string;
  product_image: string;
}

export interface VtonClientResponse {
  image_data_uri: string;
}

export interface MappedClientError {
  status: number;
  detail: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const DATA_URI_PATTERN = /^data:image\/(png|jpeg|jpg|webp);base64,[a-z0-9+/=\s]+$/i;

export const isPollContinueStatus = (
  status: string,
): status is FashnPollContinueStatus =>
  FASHN_POLL_CONTINUE_STATUSES.some((value) => value === status);

export const readVtonClientRequest = (value: unknown): VtonClientRequest | null => {
  if (!isRecord(value)) {
    return null;
  }
  const modelImage = value.model_image;
  const productImage = value.product_image;
  if (typeof modelImage !== 'string' || typeof productImage !== 'string') {
    return null;
  }
  const model = modelImage.trim();
  const product = productImage.trim();
  if (model.length === 0 || product.length === 0) {
    return null;
  }
  if (!DATA_URI_PATTERN.test(model)) {
    return null;
  }
  try {
    const parsed = new URL(product);
    if (parsed.protocol !== 'https:') {
      return null;
    }
  } catch {
    return null;
  }
  return {
    model_image: model,
    product_image: product,
  };
};

export const mapFashnHttpError = (status: number): MappedClientError => {
  if (status === 400) {
    return { status: 400, detail: 'Geçersiz sanal deneme isteği.' };
  }
  if (status === 401) {
    return { status: 401, detail: 'Servis yapılandırılmamış.' };
  }
  if (status === 422) {
    return { status: 422, detail: 'Görsel/deneme girdisi işlenemedi.' };
  }
  if (status === 429) {
    return { status: 429, detail: 'Sanal deneme servisi geçici olarak yoğun.' };
  }
  if (status >= 500) {
    return { status: 502, detail: 'Sanal deneme servisine ulaşılamadı.' };
  }
  return { status: 502, detail: 'Sanal deneme tamamlanamadı.' };
};

export const mapFashnRuntimeFailure = (
  errorName: string | null,
): MappedClientError => {
  if (
    errorName === 'InputValidationError' ||
    errorName === 'ImageLoadError'
  ) {
    return { status: 422, detail: 'Görsel/deneme girdisi işlenemedi.' };
  }
  return { status: 502, detail: 'Sanal deneme tamamlanamadı.' };
};

export const FASHN_TIMEOUT_ERROR: MappedClientError = {
  status: 504,
  detail: 'Sanal deneme zaman aşımına uğradı.',
};

export const normalizePngDataUri = (value: string): string | null => {
  const trimmed = value.trim();
  const match = /^data:image\/png;base64,([a-z0-9+/=\s]+)$/i.exec(trimmed);
  if (!match) {
    return null;
  }
  return `data:image/png;base64,${match[1].replace(/\s/g, '')}`;
};

export const buildVtonClientRequest = (
  modelImage: string,
  productImage: string,
): VtonClientRequest => ({
  model_image: modelImage,
  product_image: productImage,
});


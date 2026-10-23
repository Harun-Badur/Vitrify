import { captureOwnerPublication, trackOwnerWork } from '../lib/accountDeviceWork';
import { withAccountWriteGuard } from '../lib/accountWriteFence';
import { createOwnedFileUnderGuard } from './ownedDeviceFiles';
import { createUuid } from '../lib/analytics';
import { makeDirectoryAsync } from 'expo-file-system/legacy';
import { File } from 'expo-file-system';
import {
  cacheDirectory,
  EncodingType,
  readAsStringAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';
import { logger } from '../lib/logger';
import { withPreparedPersonJpeg } from '../lib/personPhotoPrepare';
import { getRequiredSupabaseClient } from '../lib/supabase';
import { buildVtonClientRequest, resolveVtonProxyUrl } from '../lib/vtonEdgeContract';
import {
  isHttpsProductImageUrl,
  preparePersonDataUriFromBase64,
} from '../lib/vtonPersonImage';
import { appendTryOnHistory } from './vtonHistoryService';
import { beginProviderDeviceIntentUnderGuard, observeProviderDeviceResponseUnderGuard } from './providerDeviceJournal';

const FETCH_TIMEOUT_MS = 180_000;
const BODY_SUMMARY_LIMIT = 240;
const RESULT_PNG_DATA_URI_PREFIX = /^data:image\/png;base64,/i;

export class VtonServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VtonServiceError';
  }
}

export interface TryOnPersistOptions {
  productId: string;
  productTitle: string;
  productUrl?: string;
  affiliateUrl?: string;
}

interface VtonClientResponseBody {
  image_data_uri?: string;
  detail?: unknown;
}

const summarizeBody = (body: string): string => {
  const compact = body.replace(/\s/g, ' ').trim();
  if (compact.length <= BODY_SUMMARY_LIMIT) {
    return compact;
  }
  return `${compact.slice(0, BODY_SUMMARY_LIMIT)}…`;
};

const getVtonProxyUrl = (): string => {
  const url = resolveVtonProxyUrl(process.env.EXPO_PUBLIC_VTON_PROXY_URL, process.env.EXPO_PUBLIC_SUPABASE_URL);
  if (!url) {
    throw new VtonServiceError(
      'Sanal deneme adresi eksik. .env içinde EXPO_PUBLIC_VTON_PROXY_URL tanımla.',
    );
  }
  return url;
};

const getAccessToken = async (): Promise<{ accessToken: string; userId: string }> => {
  const client = getRequiredSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error) {
    logger.error('Oturum tokenı okunamadı', { detail: error.message });
    throw new VtonServiceError(
      'Oturum doğrulanamadı. Çıkıp tekrar giriş yapmayı dene.',
    );
  }
  const token = data.session?.access_token?.trim();
  const userId = data.session?.user.id;
  if (!token || !userId) {
    throw new VtonServiceError('Sanal deneme için giriş yapmalısın.');
  }
  return { accessToken: token, userId };
};

const readImageAsBase64 = async (uri: string): Promise<string> => {
  try {
    const file = new File(uri);
    return await file.base64();
  } catch (error) {
    logger.warn('File API ile okunamadı, legacy okuyucuya düşülüyor', { error });
    return readAsStringAsync(uri, { encoding: EncodingType.Base64 });
  }
};

const persistResultPng = async (owner: string, dataUri: string): Promise<string> => {
  const directory = cacheDirectory;
  if (!directory) {
    throw new VtonServiceError(
      'Cihazda geçici alan bulunamadı. Uygulamayı yeniden başlatıp tekrar dene.',
    );
  }
  const payload = dataUri.replace(RESULT_PNG_DATA_URI_PREFIX, '');
  const folder = `${directory}vitrify-owned/${encodeURIComponent(owner)}/`;
  const uri = `${folder}${createUuid()}.png`;
  await createOwnedFileUnderGuard(owner, 'vton-result', uri, async () => {
    await makeDirectoryAsync(folder, { intermediates: true });
    await writeAsStringAsync(uri, payload, { encoding: EncodingType.Base64 });
  });
  return uri;
};

const rememberTryOnResult = async (
  userId: string,
  options: TryOnPersistOptions,
  imageUri: string,
): Promise<void> => {
  try {
    await appendTryOnHistory(userId, {
      productId: options.productId,
      title: options.productTitle,
      imageUri,
      ts: Date.now(),
      productUrl: options.productUrl,
      affiliateUrl: options.affiliateUrl,
    });
  } catch (error) {
    logger.warn('Sanal deneme geçmişi kaydedilemedi', { error });
  }
};

const extractDetail = (body: string): string => {
  try {
    const parsed: unknown = JSON.parse(body);
    if (isRecord(parsed) && typeof parsed.detail === 'string' && parsed.detail) {
      return parsed.detail;
    }
  } catch {
    return summarizeBody(body) || 'yanıt boş';
  }
  return summarizeBody(body) || 'yanıt boş';
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const throwHttpError = (status: number, body: string): never => {
  const detail = extractDetail(body);
  logger.error('Sanal deneme isteği başarısız', { status });
  if (status === 401 || status === 403) {
    throw new VtonServiceError(detail);
  }
  if (status === 429) {
    throw new VtonServiceError(detail);
  }
  throw new VtonServiceError(detail);
};

const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new VtonServiceError('Sanal deneme zaman aşımına uğradı.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

export { buildVtonClientRequest } from '../lib/vtonEdgeContract';

export interface VtonTrialStatus { enabled: boolean; used: boolean }

/** Authenticated read only. No reservation, provider dispatch, or local quota cache. */
export const getVtonTrialStatus = async (expectedOwner: string): Promise<VtonTrialStatus> => {
  const session = await getAccessToken();
  if (session.userId !== expectedOwner) throw new VtonServiceError('Oturum değişti.');
  const current = captureOwnerPublication(expectedOwner);
  return trackOwnerWork(expectedOwner, (async () => {
    const response = await fetchWithTimeout(getVtonProxyUrl(), {
      method: 'GET', headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (!response.ok || !current()) throw new VtonServiceError('Deneme hakkı doğrulanamadı.');
    const body: unknown = await response.json();
    if (!current() || !body || typeof body !== 'object' || !('enabled' in body) || !('used' in body) ||
      typeof body.enabled !== 'boolean' || typeof body.used !== 'boolean') throw new VtonServiceError('Deneme hakkı doğrulanamadı.');
    return { enabled: body.enabled, used: body.used };
  })());
};

export const tryOnGarment = async (
  personImageUri: string,
  productImageUrl: string,
  options: TryOnPersistOptions,
): Promise<string> => {
  try {
    if (!isHttpsProductImageUrl(productImageUrl)) {
      throw new VtonServiceError('Geçersiz sanal deneme isteği.');
    }

    const session = await getAccessToken();
    const current = captureOwnerPublication(session.userId);
    return await trackOwnerWork(session.userId, (async () => {
    const resultUri = await withAccountWriteGuard(session.userId, () => withPreparedPersonJpeg(session.userId, personImageUri, async jpegUri => {
    const personBase64 = await readImageAsBase64(jpegUri);
    const prepared = preparePersonDataUriFromBase64(personBase64);
    if (!prepared.ok) {
      throw new VtonServiceError(prepared.detail);
    }
    if (prepared.mimeType !== 'image/jpeg') {
      throw new VtonServiceError(
        'Fotoğraf JPEG olarak hazırlanamadı. Lütfen tekrar dene.',
      );
    }

    const payload = buildVtonClientRequest(
      prepared.dataUri,
      productImageUrl.trim(),
    );

    const providerIntent = await beginProviderDeviceIntentUnderGuard(session.userId, 'fashn');
    const response = await fetchWithTimeout(getVtonProxyUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        'x-provider-request': providerIntent.request,
      },
      body: JSON.stringify(payload),
    });
    const body = await response.text();
    if (!response.ok) {
      throwHttpError(response.status, body);
    }

    let parsed: VtonClientResponseBody;
    try {
      parsed = JSON.parse(body) as VtonClientResponseBody;
    } catch (error) {
      logger.error('Sanal deneme yanıtı JSON değil', {
        error,
        status: response.status,
      });
      throw new VtonServiceError('Sanal deneme tamamlanamadı.');
    }

    const dataUri = parsed.image_data_uri?.trim();
    if (!dataUri || !RESULT_PNG_DATA_URI_PREFIX.test(dataUri)) {
      throw new VtonServiceError('Sanal deneme sonucu görseli yok.');
    }

    await observeProviderDeviceResponseUnderGuard(providerIntent);
    return persistResultPng(session.userId, dataUri);
    }));
    if (!current()) throw new VtonServiceError('Oturum değişti veya hesap silme başladı.');
    await rememberTryOnResult(session.userId, options, resultUri);
    if (!current()) throw new VtonServiceError('Oturum değişti veya hesap silme başladı.');
    return resultUri;
    })());
  } catch (error) {
    if (error instanceof VtonServiceError) {
      throw error;
    }
    logger.error('Sanal deneme beklenmeyen hatayla düştü', { error });
    throw new VtonServiceError(
      'Sanal deneme sırasında beklenmeyen bir hata oluştu. İnternetini kontrol edip tekrar dene.',
    );
  }
};

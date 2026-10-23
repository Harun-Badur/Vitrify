import {
  beginWardrobeWait,
  measureWardrobeStage,
  measureWardrobeStageSync,
} from '../lib/wardrobeProgress';
import {
  createOwnedFileUnderGuard,
  withOwnedNativeFileUnderGuard,
} from './ownedDeviceFiles';
import { accountWriteBlockedNow, withAccountWriteGuard, withAccountWriteWorkflow } from '../lib/accountWriteFence';
import { captureOwnerPublication } from '../lib/accountDeviceWork';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { getRequiredSupabaseClient } from '../lib/supabase';
import {
  accountStorageUploadInventory,
  reconcileAccountStorageUpload,
  storageUploadJournalPrefix,
  uploadAccountStorage,
} from './accountStorageUpload';
import {
  beginProviderDeviceIntentUnderGuard,
  observeProviderDeviceResponseUnderGuard,
} from './providerDeviceJournal';
import type { WardrobeItem } from '../types/wardrobe';
import { createOnDeviceWardrobeCutout, onDeviceCutoutEnabled } from './wardrobeOnDeviceCutout';
import { recordWardrobeCutoutFailure, recordWardrobeNetworkFailure, wardrobeNetworkErrorMetadata } from '../lib/wardrobeNetworkDiagnostics';

const BUCKET = 'wardrobe-cutouts';
const MAX_PNG_BYTES = 12 * 1024 * 1024;
const SIGNED_URL_SECONDS = 7 * 24 * 60 * 60;
const endpoint = (): string | undefined =>
  process.env.EXPO_PUBLIC_WARDROBE_CUTOUT_URL?.trim();

export const wardrobeCutoutConfigured = (): boolean => onDeviceCutoutEnabled() || Boolean(endpoint());
const cutoutFailure = (code: string, message: string, source?: unknown) =>
  Object.assign(new Error(message), { code }, wardrobeNetworkErrorMetadata(source));

// React Native Storage uploads require bytes, rather than Blob/FormData.
export function decodeCutoutPng(value: unknown): Uint8Array {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil(MAX_PNG_BYTES / 3) * 4 ||
    value.length % 4 !== 0 ||
    /[^A-Za-z0-9+/=]/.test(value) ||
    value.slice(0, -2).includes('=') ||
    (value.endsWith('=') &&
      value[value.length - 2] === '=' &&
      value[value.length - 3] === '=') ||
    (value[value.length - 2] === '=' && !value.endsWith('=='))
  )
    throw new Error('Geçersiz cutout yanıtı.');
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array((value.length / 4) * 3 - padding);
  let offset = 0;
  for (let i = 0; i < value.length; i += 4) {
    const block =
      (alphabet.indexOf(value[i]) << 18) |
      (alphabet.indexOf(value[i + 1]) << 12) |
      (Math.max(0, alphabet.indexOf(value[i + 2])) << 6) |
      Math.max(0, alphabet.indexOf(value[i + 3]));
    for (const shift of [16, 8, 0])
      if (offset < bytes.length) bytes[offset++] = (block >> shift) & 255;
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  // The local processor always exports an RGBA PNG (IHDR color type 6).
  if (
    bytes.length < 33 ||
    signature.some((byte, index) => bytes[index] !== byte) ||
    bytes[25] !== 6
  )
    throw new Error('Cutout şeffaf PNG formatında değil.');
  return bytes;
}

async function ownerSession(userId: string) {
  const client = getRequiredSupabaseClient();
  const { data, error } = await client.auth.getSession();
  if (error || !data.session || data.session.user.id !== userId)
    throw cutoutFailure('CUTOUT_SESSION_UNVERIFIED', 'Cutout işlemi için geçerli oturum gerekli.');
  return { client, token: data.session.access_token };
}

async function createWardrobeCutoutUnlocked(
  userId: string,
  item: WardrobeItem,
): Promise<string> {
  const current = captureOwnerPublication(userId);
  if (onDeviceCutoutEnabled()) {
    await ownerSession(userId);
    return createOnDeviceWardrobeCutout(userId, item);
  }
  const url = endpoint();
  if (!url) throw cutoutFailure('CUTOUT_CONFIG_MISSING', 'Yerel arka plan silme servisi yapılandırılmamış.');
  if (!/^https:\/\//i.test(url) && !(__DEV__ && /^http:\/\//i.test(url)))
    throw cutoutFailure('CUTOUT_CONFIG_INVALID', 'Arka plan silme servisi HTTPS kullanmalı.');
  const { token } = await ownerSession(userId);
  if (!FileSystem.documentDirectory)
    throw cutoutFailure('CUTOUT_DIRECTORY_UNAVAILABLE', 'Fotoğraf klasörü kullanılamıyor.');

  // Normalize HEIC/orientation on a separate temporary copy; never alter the original.
  const source = item.imageLocalUri ?? item.imageUrl;
  return withOwnedNativeFileUnderGuard(
    userId,
    source,
    async () =>
      (
        await measureWardrobeStage('cutoutPrepare', () =>
          manipulateAsync(source, [], {
            format: SaveFormat.JPEG,
            compress: 0.9,
          }),
        )
      ).uri,
    async (inputUri) => {
      // Serialize UNKNOWN admission and dispatch, not the provider's response.
      // The enclosing workflow tracks the response AND native-file cleanup for drain.
      const { providerIntent, task, pending } = await withAccountWriteGuard(userId, async () => {
        const providerIntent = await measureWardrobeStage('cutoutCheckpoint', () => beginProviderDeviceIntentUnderGuard(userId, 'wardrobe-cutout'));
        if (accountWriteBlockedNow(userId) || !current()) throw new Error('Owner deletion pending or session changed');
        let task: ReturnType<typeof FileSystem.createUploadTask>;
        try { task = FileSystem.createUploadTask(url, inputUri, {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'image/jpeg',
            'x-provider-request': providerIntent.request,
          },
        }); } catch (error) { recordWardrobeCutoutFailure('cutoutProvider', error); throw error; }
        const pending = measureWardrobeStage('cutoutProvider', async () => {
          try { return await task.uploadAsync(); }
          catch (error) {
            recordWardrobeNetworkFailure('cutoutProvider', { code: 'CUTOUT_TRANSPORT_REJECTED', diagnosticTransport: 'native' }, 'CUTOUT_TRANSPORT_REJECTED');
            throw error;
          }
        });
        return { providerIntent, task, pending };
      });
      const timer = setTimeout(() => {
        void task.cancelAsync().catch(() => {});
      }, 90_000);
      try {
        const response = await pending;
        if (!response || response.status !== 200) {
          recordWardrobeNetworkFailure('cutoutProvider', { code: response ? 'CUTOUT_HTTP_REJECTED' : 'CUTOUT_NO_RESPONSE', diagnosticTransport: 'native', diagnosticHttpStatus: response?.status }, 'CUTOUT_NO_RESPONSE');
          const error = cutoutFailure(response ? 'CUTOUT_HTTP_REJECTED' : 'CUTOUT_NO_RESPONSE',
            'Arka plan silme işlemi doğrulanamadı; belirsiz işlem tekrarlanmayacak.', { diagnosticHttpStatus: response?.status });
          recordWardrobeCutoutFailure('cutoutProvider', error); throw error;
        }
        let body: { pngBase64?: unknown };
        try { body = JSON.parse(response.body) as { pngBase64?: unknown }; }
        catch {
          recordWardrobeNetworkFailure('cutoutProvider', { code: 'CUTOUT_RESPONSE_INVALID', diagnosticTransport: 'native', diagnosticHttpStatus: response.status }, 'CUTOUT_RESPONSE_INVALID');
          const error = cutoutFailure('CUTOUT_RESPONSE_INVALID', 'Geçersiz cutout yanıtı.', { diagnosticHttpStatus: response.status });
          recordWardrobeCutoutFailure('cutoutProvider', error);
          throw error;
        }
        try { measureWardrobeStageSync('cutoutDecode', () => {
          try { return decodeCutoutPng(body?.pngBase64); }
          catch { throw cutoutFailure('CUTOUT_PNG_INVALID', 'Geçersiz cutout PNG yanıtı.', { diagnosticHttpStatus: response.status }); }
        }); }
        catch (error) {
          recordWardrobeNetworkFailure('cutoutProvider', { code: 'CUTOUT_PNG_INVALID', diagnosticTransport: 'native', diagnosticHttpStatus: response.status }, 'CUTOUT_PNG_INVALID');
          throw error;
        }
        return await withAccountWriteGuard(userId, async () => {
          if (!current()) throw new Error('Owner session changed');
          await measureWardrobeStage('cutoutCheckpoint', () => observeProviderDeviceResponseUnderGuard(providerIntent));
          const directory = `${FileSystem.documentDirectory}wardrobe/${encodeURIComponent(userId)}/`;
          const uri = `${directory}${encodeURIComponent(item.id)}-cutout.png`;
          await measureWardrobeStage('cutoutWrite', async () => {
            await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
            return createOwnedFileUnderGuard(userId, 'cutout', uri, () =>
              FileSystem.writeAsStringAsync(uri, body.pngBase64 as string, {
                encoding: FileSystem.EncodingType.Base64,
              }),
            );
          });
          return uri;
        });
      } finally {
        clearTimeout(timer);
      }
    },
  );
}

async function uploadWardrobeCutoutUnlocked(
  userId: string,
  item: WardrobeItem,
): Promise<
  Pick<WardrobeItem, 'cutoutUrl' | 'cutoutStoragePath' | 'cutoutUrlExpiresAt'>
> {
  const { client } = await ownerSession(userId);
  const path = `${userId}/${encodeURIComponent(item.id)}/cutout.png`;
  if (item.cutoutStoragePath && item.cutoutStoragePath !== path)
    throw cutoutFailure('CUTOUT_STORAGE_OWNER_MISMATCH', 'Cutout dosyasının sahibi eşleşmiyor.');
  const bucket = client.storage.from(BUCKET);
  if (!item.cutoutStoragePath) {
    const input = { owner: userId, bucket: BUCKET, path } as const;
    const inventory = await measureWardrobeStage('storageCheck', () =>
      accountStorageUploadInventory(userId),
    );
    const key =
      storageUploadJournalPrefix(userId) +
      encodeURIComponent(BUCKET + '/' + path);
    let uploaded = false;
    if (inventory.keys.includes(key)) {
      const state = await measureWardrobeStage('storageCheck', () =>
        reconcileAccountStorageUpload(input),
      );
      if (state === 'UNKNOWN')
        throw cutoutFailure('CUTOUT_STORAGE_UNKNOWN',
          'Fotoğraf aktarımı henüz doğrulanamadı; aynı dosya yeniden gönderilmedi.',
        );
      uploaded = state === 'SUCCEEDED';
    }
    if (!uploaded) {
      if (!item.cutoutLocalUri)
        throw cutoutFailure('CUTOUT_ARTIFACT_MISSING', 'Cutout dosyası henüz hazır değil.');
      const bytes = await measureWardrobeStage('cutoutDecode', async () =>
        decodeCutoutPng(
          await FileSystem.readAsStringAsync(item.cutoutLocalUri!, {
            encoding: FileSystem.EncodingType.Base64,
          }),
        ),
      );
      await measureWardrobeStage('upload', () =>
        uploadAccountStorage({
          ...input,
          body: bytes.buffer as ArrayBuffer,
          contentType: 'image/png',
        }),
      );
    }
  }
  const data = await measureWardrobeStage('cutoutSign', async () => {
    const result = await bucket.createSignedUrl(path, SIGNED_URL_SECONDS);
    if (result.error || !result.data?.signedUrl)
      throw cutoutFailure('CUTOUT_SIGN_FAILED', 'Cutout adresi oluşturulamadı.', result.error);
    return result.data;
  });
  return {
    cutoutUrl: data.signedUrl,
    cutoutStoragePath: path,
    cutoutUrlExpiresAt: Date.now() + SIGNED_URL_SECONDS * 1000,
  };
}

export const createWardrobeCutout = (
  userId: string,
  item: WardrobeItem,
): Promise<string> => {
  const entered = beginWardrobeWait('writeGuardQueue');
  return withAccountWriteWorkflow(userId, () => {
    entered();
    return createWardrobeCutoutUnlocked(userId, item);
  });
};
export const uploadWardrobeCutout = (
  userId: string,
  item: WardrobeItem,
): ReturnType<typeof uploadWardrobeCutoutUnlocked> => {
  const entered = beginWardrobeWait('writeGuardQueue');
  return withAccountWriteGuard(userId, () => {
    entered();
    return uploadWardrobeCutoutUnlocked(userId, item);
  });
};

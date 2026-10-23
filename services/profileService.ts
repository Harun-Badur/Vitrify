import { createOwnedFileUnderGuard } from './ownedDeviceFiles';
import { captureOwnerPublication, trackOwnerWork } from '../lib/accountDeviceWork';
import { withAccountWriteGuard } from '../lib/accountWriteFence';
import { cacheDirectory, downloadAsync } from 'expo-file-system/legacy';
import { invalidateStyleProfileSnapshot } from '../lib/recsConfig';
import { logger } from '../lib/logger';
import { withPreparedPersonJpeg } from '../lib/personPhotoPrepare';
import {
  clampHeightCm,
  clampWeightKg,
  isGarmentSize,
  parseStyleTags,
  parseStudioPreferences,
} from '../lib/profileStudio';
import { getRequiredSupabaseClient } from '../lib/supabase';
import { uploadAccountStorage } from './accountStorageUpload';
import type { StudioProfilePatch, UserStudioProfile } from '../types/profile';

export const MODEL_PHOTOS_BUCKET = 'model-photos';
const MODEL_PHOTO_FILENAME = 'model.jpg';
const SIGNED_URL_TTL_SEC = 60 * 60;

interface ProfileRow {
  id: string;
  height_cm: number | null;
  weight_kg: number | null;
  top_size: string | null;
  bottom_size: string | null;
  style_tags: unknown;
  model_photo_path: string | null;
}

interface UploadProgressParams {
  onProgress: (progress: number) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isProfileRow = (value: unknown): value is ProfileRow => {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return false;
  }
  return (
    (typeof value.height_cm === 'number' || value.height_cm === null) &&
    (typeof value.weight_kg === 'number' || value.weight_kg === null) &&
    (typeof value.top_size === 'string' || value.top_size === null) &&
    (typeof value.bottom_size === 'string' || value.bottom_size === null) &&
    (typeof value.model_photo_path === 'string' ||
      value.model_photo_path === null)
  );
};

const modelPhotoPathFor = (userId: string): string =>
  `${userId}/${MODEL_PHOTO_FILENAME}`;

const emptyProfile = (userId: string): UserStudioProfile => ({
  userId,
  heightCm: null,
  weightKg: null,
  topSize: null,
  bottomSize: null,
  styleTags: [],
  modelPhotoPath: null,
});

const mapRow = (row: ProfileRow): UserStudioProfile => ({
  userId: row.id,
  heightCm: typeof row.height_cm === 'number' ? row.height_cm : null,
  weightKg: typeof row.weight_kg === 'number' ? row.weight_kg : null,
  topSize: isGarmentSize(row.top_size) ? row.top_size : null,
  bottomSize: isGarmentSize(row.bottom_size) ? row.bottom_size : null,
  styleTags: parseStyleTags(row.style_tags),
  modelPhotoPath: row.model_photo_path,
});

const fetchStudioProfileOwned = async (
  userId: string,
): Promise<UserStudioProfile> => {
  const client = getRequiredSupabaseClient();
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || auth.user?.id !== userId)
    throw new Error('Profil için geçerli oturum gerekli.');
  const preferences = parseStudioPreferences(
    auth.user.user_metadata.studio_preferences,
  );
  const { data, error } = await client
    .from('profiles')
    .select(
      'id, height_cm, weight_kg, top_size, bottom_size, style_tags, model_photo_path',
    )
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    logger.error('Profil okunamadı', { detail: error.message });
    throw new Error('Profil bilgileri yüklenemedi. Lütfen tekrar dene.');
  }

  if (data === null) {
    return { ...emptyProfile(userId), ...preferences };
  }

  if (!isProfileRow(data) || data.id !== userId) {
    logger.error('Profil satırı beklenen biçimde değil');
    throw new Error('Profil bilgileri yüklenemedi. Lütfen tekrar dene.');
  }

  return { ...mapRow(data), ...preferences };
};

const upsertStudioProfileUnlocked = async (
  userId: string,
  patch: StudioProfilePatch,
): Promise<UserStudioProfile> => {
  const current = captureOwnerPublication(userId);
  const client = getRequiredSupabaseClient();
  const { data: actor, error: actorError } = await client.auth.getUser();
  if (actorError || actor.user?.id !== userId) throw new Error('Profil için geçerli oturum gerekli.');
  const hasPreferences =
    patch.favoriteBrands !== undefined ||
    patch.preferredColors !== undefined ||
    patch.priceRange !== undefined;
  if (hasPreferences) {
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || auth.user?.id !== userId)
      throw new Error('Profil için geçerli oturum gerekli.');
    if (
      patch.priceRange !== undefined &&
      patch.priceRange !== null &&
      !parseStudioPreferences({ priceRange: patch.priceRange }).priceRange
    )
      throw new Error('Geçerli bir minimum ve maksimum fiyat seç.');
    const preferences = parseStudioPreferences({
      ...parseStudioPreferences(auth.user.user_metadata.studio_preferences),
      ...(patch.favoriteBrands !== undefined && {
        favoriteBrands: patch.favoriteBrands,
      }),
      ...(patch.preferredColors !== undefined && {
        preferredColors: patch.preferredColors,
      }),
      ...(patch.priceRange !== undefined && { priceRange: patch.priceRange }),
    });
    if (!current()) throw new Error('Owner session changed');
    const { error } = await client.auth.updateUser({
      data: { studio_preferences: preferences },
    });
    if (error) throw new Error('Değişiklik kaydedilemedi. Lütfen tekrar dene.');
    if (
      Object.keys(patch).every((key) =>
        ['favoriteBrands', 'preferredColors', 'priceRange'].includes(key),
      )
    )
      return fetchStudioProfile(userId);
  }
  const payload: Record<string, unknown> = {
    id: userId,
    updated_at: new Date().toISOString(),
  };

  if (patch.heightCm !== undefined) {
    payload.height_cm =
      patch.heightCm === null ? null : clampHeightCm(patch.heightCm);
  }
  if (patch.weightKg !== undefined) {
    payload.weight_kg =
      patch.weightKg === null ? null : clampWeightKg(patch.weightKg);
  }
  if (patch.topSize !== undefined) {
    payload.top_size = patch.topSize;
  }
  if (patch.bottomSize !== undefined) {
    payload.bottom_size = patch.bottomSize;
  }
  if (patch.styleTags !== undefined) {
    payload.style_tags = patch.styleTags;
  }
  if (patch.modelPhotoPath !== undefined) {
    payload.model_photo_path = patch.modelPhotoPath;
  }

  if (!current()) throw new Error('Owner session changed');
  const { data, error } = await client
    .from('profiles')
    .upsert(payload, { onConflict: 'id' })
    .select(
      'id, height_cm, weight_kg, top_size, bottom_size, style_tags, model_photo_path',
    )
    .single();

  if (error || !isProfileRow(data)) {
    logger.error('Profil kaydedilemedi', { detail: error?.message });
    throw new Error('Değişiklik kaydedilemedi. Lütfen tekrar dene.');
  }

  if (patch.styleTags !== undefined) {
    if (!current()) throw new Error('Owner session changed');
    await syncDeclaredStyleTags(patch.styleTags, userId);
  }

  return fetchStudioProfile(userId);
};

export const syncDeclaredStyleTags = async (tags: string[], expectedOwner?: string): Promise<void> => {
  const client = getRequiredSupabaseClient();
  const { data: actor, error: authError } = await client.auth.getUser();
  if (authError || !actor.user || (expectedOwner && actor.user.id !== expectedOwner)) throw new Error('Stil senkronizasyonu için geçerli oturum gerekli.');
  try {
    const { error } = await client.rpc('sync_declared_style_tags', { p_tags: tags });
    if (error) throw error;
  } catch {
    invalidateStyleProfileSnapshot(actor.user.id);
    throw new Error('Tercihler kaydedilmiş olabilir; stil senkronizasyonu tamamlanamadı. Kaydet ile tekrar dene.');
  }
  invalidateStyleProfileSnapshot(actor.user.id);
};

const uploadModelPhotoUnlocked = async (
  userId: string,
  localUri: string,
  { onProgress }: UploadProgressParams,
): Promise<UserStudioProfile> => {
  onProgress(0.08);
  return withPreparedPersonJpeg(userId, localUri, async jpegUri => {
  onProgress(0.18);
  const fileResponse = await fetch(jpegUri);
  const blob = await fileResponse.blob();
  const path = modelPhotoPathFor(userId);
  await uploadAccountStorage({ owner: userId, bucket: MODEL_PHOTOS_BUCKET,
    path, body: blob, contentType: 'image/jpeg' });
  onProgress(1);

  return upsertStudioProfileUnlocked(userId, { modelPhotoPath: path });
  });
};

const removeModelPhotoUnlocked = async (
  userId: string,
): Promise<UserStudioProfile> => {
  const client = getRequiredSupabaseClient();
  const path = modelPhotoPathFor(userId);
  const { data, error } = await client.functions.invoke('account-storage-upload', {
    method: 'DELETE',
    headers: { 'x-upload-bucket': MODEL_PHOTOS_BUCKET, 'x-upload-path': path },
  });

  if (error || data?.protocol !== 'vitrify.storage-remove.v1' || data.state !== 'REMOVED') {
    logger.error('Model fotoğrafı silinemedi', { code: 'MODEL_PHOTO_REMOVE_FAILED' });
    throw new Error('Fotoğraf kaldırılamadı. Lütfen tekrar dene.');
  }

  return upsertStudioProfileUnlocked(userId, { modelPhotoPath: null });
};

export const createModelPhotoSignedUrl = async (
  path: string,
): Promise<string | null> => {
  const owner = path.split('/')[0];
  const current = captureOwnerPublication(owner);
  if (!owner || !current()) return null;
  const client = getRequiredSupabaseClient();
  const { data, error } = await trackOwnerWork(owner, client.storage
    .from(MODEL_PHOTOS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SEC));

  if (!current()) return null;

  if (error || !data?.signedUrl) {
    logger.error('Model fotoğrafı adresi alınamadı', {
      detail: error?.message,
    });
    return null;
  }

  return data.signedUrl;
};

/**
 * VTON yerel dosya bekler; imzalı HTTPS URI File API ile okunmaz.
 * Kayıtlı fotoğrafı cache'e indirip file:// döner.
 */
const resolveSavedModelPhotoUriUnlocked = async (
  userId: string,
): Promise<string | null> => {
  const profile = await fetchStudioProfile(userId);
  if (!profile.modelPhotoPath) {
    return null;
  }

  const signedUrl = await createModelPhotoSignedUrl(profile.modelPhotoPath);
  const directory = cacheDirectory;
  if (!signedUrl || !directory) {
    return null;
  }

  const localUri = `${directory}kabin-model-${userId}.jpg`;
  await createOwnedFileUnderGuard(userId, 'model-cache', localUri, () => downloadAsync(signedUrl, localUri));
  return localUri;
};

export const upsertStudioProfile = (userId: string, patch: StudioProfilePatch): Promise<UserStudioProfile> =>
  withAccountWriteGuard(userId, () => upsertStudioProfileUnlocked(userId, patch));
export const uploadModelPhoto = (userId: string, localUri: string, progress: UploadProgressParams): Promise<UserStudioProfile> =>
  withAccountWriteGuard(userId, () => uploadModelPhotoUnlocked(userId, localUri, progress));
export const removeModelPhoto = (userId: string): Promise<UserStudioProfile> =>
  withAccountWriteGuard(userId, () => removeModelPhotoUnlocked(userId));
export const resolveSavedModelPhotoUri = (userId: string): Promise<string | null> =>
  withAccountWriteGuard(userId, () => resolveSavedModelPhotoUriUnlocked(userId));

export const fetchStudioProfile = (userId: string): Promise<UserStudioProfile> => {
  const current = captureOwnerPublication(userId);
  if (!current()) return Promise.reject(new Error('Owner session changed'));
  return trackOwnerWork(userId, fetchStudioProfileOwned(userId).then(value => { if (!current()) throw new Error('Owner session changed'); return value; }));
};

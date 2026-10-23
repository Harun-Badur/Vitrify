import type { WardrobeCutoutPatch } from '../lib/wardrobeCutoutState';
import { decodeWardrobePhotoBytes } from '../lib/wardrobePhotoBytes';
import { beginWardrobeWait, measureWardrobeStage, notifyWardrobeStage, type WardrobeProgress } from '../lib/wardrobeProgress';
import { createOwnedFileUnderGuard, withOwnedNativeFileUnderGuard } from './ownedDeviceFiles';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { isGarmentCategory } from '../types/product';
import { withAccountWriteGuard, withAccountWriteWorkflow } from '../lib/accountWriteFence';
import { getSupabaseClient } from '../lib/supabase';
import { createUuid } from '../lib/analytics';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { accountStorageUploadInventory, reconcileAccountStorageUpload, storageUploadJournalPrefix, uploadAccountStorage } from './accountStorageUpload';
import { validWardrobeOriginalPath } from '../types/wardrobe';
import { createWardrobePersistence, type WardrobeCloudPort, type CloudSnapshot, type WardrobeData } from './wardrobeCloudPersistence';
import { WARDROBE_CUTOUT_V2_ENABLED } from '../lib/wardrobeCutoutV2Gate';
import { validateWardrobeV2Snapshot } from './wardrobeCutoutV2Snapshot';
import { captureOwnerPublication } from '../lib/accountDeviceWork';
import { accountWriteBlockedNow } from '../lib/accountWriteFence';
export type { WardrobeData } from './wardrobeCloudPersistence';

type OriginalPhotoUrl = { url: string; expiresAt: number };
const originalPhotoUrls = new WeakMap<NonNullable<ReturnType<typeof getSupabaseClient>>, Map<string, OriginalPhotoUrl>>();
const cutoutV2PhotoUrls = new WeakMap<NonNullable<ReturnType<typeof getSupabaseClient>>, Map<string, OriginalPhotoUrl>>();
async function signV2Results(owner:string,paths:string[]):Promise<Map<string,OriginalPhotoUrl>>{
  const client=getSupabaseClient(),live=captureOwnerPublication(owner);
  if(!client||!live()||accountWriteBlockedNow(owner))throw new Error('CUTOUT_V2_OWNER_UNVERIFIED');
  let cache=cutoutV2PhotoUrls.get(client);if(!cache){cache=new Map();cutoutV2PhotoUrls.set(client,cache);}
  const now=Date.now(),missing=paths.filter(path=>!cache!.has(path)||cache!.get(path)!.expiresAt<now+60_000);
  if(missing.length){
    const auth=await client.auth.getUser();
    if(auth.error||auth.data.user?.id!==owner||!live())throw new Error('CUTOUT_V2_OWNER_UNVERIFIED');
    const {data,error}=await client.storage.from('wardrobe-cutouts').createSignedUrls(missing,3600);
    const after=await client.auth.getUser();
    if(error||!data||data.length!==missing.length||new Set(data.map(row=>row.path)).size!==missing.length||data.some(row=>row.error||!row.signedUrl||!row.path||!missing.includes(row.path))||after.error||after.data.user?.id!==owner||!live()||accountWriteBlockedNow(owner))throw new Error('CUTOUT_V2_SIGN_UNVERIFIED');
    for(const row of data)cache.set(row.path!,{url:row.signedUrl,expiresAt:now+3600_000});
  }
  if(!live()||accountWriteBlockedNow(owner))throw new Error('CUTOUT_V2_OWNER_UNVERIFIED');
  const result=new Map(paths.map(path=>[path,cache!.get(path)!]));
  while(cache.size>1000)cache.delete(cache.keys().next().value!);
  return result;
}
// Same authenticated, bounded signed-read cache for wardrobe snapshots and outfit covers.
export async function resolveWardrobeOriginalPhotos(input: string[]): Promise<Map<string, OriginalPhotoUrl>> {
  const source = getSupabaseClient();
  if (!source) throw new Error('Bulut yapılandırılmamış.');
  const { data: identity, error: identityError } = await source.auth.getUser();
  const owner = identity.user?.id;
  const paths = [...new Set(input)];
  if (identityError || !owner || paths.length > 1000 || paths.some(path => !validWardrobeOriginalPath(owner, path))) throw new Error('Fotoğraf sahibi doğrulanamadı.');
  let cache = originalPhotoUrls.get(source);
  if (!cache) { cache = new Map(); originalPhotoUrls.set(source, cache); }
  const now = Date.now();
  const missing = paths.filter(path => !cache!.has(path) || cache!.get(path)!.expiresAt <= now + 60_000);
  if (missing.length) {
    const { data, error } = await source.storage.from('wardrobe-cutouts').createSignedUrls(missing, 3600);
    const current = await source.auth.getUser();
    if (current.error || current.data.user?.id !== owner) throw new Error('Dolap oturumu değişti.');
    if (error || !data || data.length !== missing.length || new Set(data.map(row=>row.path)).size !== missing.length ||
      data.some(row => row.error || !row.signedUrl || !row.path || !missing.includes(row.path))) throw new Error('Fotoğraf adresi yenilenemedi.');
    for (const row of data) cache.set(row.path!, { url: row.signedUrl, expiresAt: now + 3600_000 });
  }
  const result = new Map(paths.map(path => [path, cache!.get(path)!]));
  while (cache.size > 1000) cache.delete(cache.keys().next().value!);
  return result;
}

// Existing client connection, authenticated RPCs; no service-role or new Edge.
interface WardrobeRpcClient {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
let persistenceClient: ReturnType<typeof getSupabaseClient> | undefined;
let persistence: ReturnType<typeof createWardrobePersistence> | undefined;
const wardrobePersistence = () => {
  const source = getSupabaseClient();
  if (!persistence || source !== persistenceClient) {
    const client = source as unknown as WardrobeRpcClient | null;
    const authenticate = async (owner: string) => {
      if (!client) throw new Error('Bulut yapılandırılmamış.');
      const { data, error } = await client.auth.getUser();
      if (error || data.user?.id !== owner) throw new Error('Dolap oturumu değişti.');
    };
    const rpc = async (name: string, args?: Record<string, unknown>) => {
      if (!client) throw new Error('Bulut yapılandırılmamış.');
      const { data, error } = await client.rpc(name, args);
      if (error) {
        const code = typeof error === 'object' && 'code' in error ? error.code : undefined;
        throw Object.assign(new Error('Dolap bulut işlemi doğrulanamadı.'), {
          code: code === 'PGRST202' || code === '42883' ? 'WARDROBE_RPC_MISSING' : 'WARDROBE_RPC_FAILED',
        });
      }
      return data;
    };
    const cloud: WardrobeCloudPort | null = client ? {
      authenticate,
      snapshot: async owner => {
        const result = await rpc(WARDROBE_CUTOUT_V2_ENABLED?'wardrobe_cloud_snapshot_v2':'wardrobe_cloud_snapshot', { p_owner: owner }) as CloudSnapshot & { owner?: string };
        if (!result || result.owner !== owner) throw new Error('Dolap bulut sahibi doğrulanamadı.');
        if (source && Array.isArray(result.items)) {
          const paths = [...new Set(result.items.flatMap(item => item.imageStoragePath ? [item.imageStoragePath] : []))];
          if (paths.some(path => !validWardrobeOriginalPath(owner, path))) throw new Error('Fotoğraf sahibi doğrulanamadı.');
          const signed = paths.length ? await resolveWardrobeOriginalPhotos(paths) : new Map<string, OriginalPhotoUrl>();
          await authenticate(owner);
          result.items = result.items.map(item => item.imageStoragePath ? { ...item, imageUrl: signed.get(item.imageStoragePath)!.url, imageUrlExpiresAt: signed.get(item.imageStoragePath)!.expiresAt } : item);
          if(WARDROBE_CUTOUT_V2_ENABLED){
            const cutouts=validateWardrobeV2Snapshot(owner,result);
            const signedCutouts=await signV2Results(owner,cutouts);
            await authenticate(owner);
            result.items=result.items.map(item=>item.cutoutProtocol===2 && item.cutoutStoragePath ? {...item,cutoutUrl:signedCutouts.get(item.cutoutStoragePath)!.url,cutoutUrlExpiresAt:signedCutouts.get(item.cutoutStoragePath)!.expiresAt}:item);
          }
        }
        return result;
      },
      apply: async (owner, operation) => {
        const v2Create=operation.kind==='item' && operation.expected===null && (operation.value as import('../types/wardrobe').WardrobeItem | null)?.cutoutProtocol===2;
        const result = await rpc(v2Create?'wardrobe_apply_change_v2':'wardrobe_apply_change', { p_owner: owner, p_kind: operation.kind, p_id: operation.id, p_expected: operation.expected, p_value: operation.value });
        if (result !== 'applied' && result !== 'conflict') throw new Error('Dolap sonucu doğrulanamadı.');
        return result;
      },
      photoPath: (owner, itemId) => `${owner}/${itemId}/original-${createUuid()}.png`,
      uploadPhoto: (owner, path, localUri, onStage) => withAccountWriteGuard(owner, async () => {
        if (!validWardrobeOriginalPath(owner, path) || !/^(file|content):\/\//.test(localUri)) throw new Error('Yerel fotoğraf doğrulanamadı.');
        await authenticate(owner);
        const input = { owner, bucket: 'wardrobe-cutouts' as const, path };
        const journal = await measureWardrobeStage('storageCheck', () => accountStorageUploadInventory(owner), onStage);
        const journalKey = storageUploadJournalPrefix(owner) + encodeURIComponent(input.bucket + '/' + path);
        if (journal.keys.includes(journalKey)) {
          const state = await measureWardrobeStage('storageCheck', () => reconcileAccountStorageUpload(input), onStage);
          if (state === 'SUCCEEDED') return;
          if (state === 'UNKNOWN') throw Object.assign(new Error('Fotoğraf yüklemesi belirsiz; kayıt korundu.'), { code: 'WARDROBE_STORAGE_UNKNOWN' });
        }
        await withOwnedNativeFileUnderGuard(owner, localUri,
          async () => (await measureWardrobeStage('prepare', () => manipulateAsync(localUri, [], { compress: 1, format: SaveFormat.PNG }), onStage)).uri,
          async uri => {
            const decoded = await measureWardrobeStage('encode', async () => {
              const value = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
              if (value.length > Math.ceil(12 * 1024 * 1024 / 3) * 4) throw new Error('Özgün PNG yükleme sınırını aşıyor; yerel fotoğraf korundu.');
              return decodeWardrobePhotoBytes(value);
            }, onStage);
            await measureWardrobeStage('upload', () => uploadAccountStorage({ ...input, body: decoded.buffer, contentType: 'image/png' }), onStage);
          });
        await authenticate(owner);
      }),
    } : null;
    persistence = createWardrobePersistence(AsyncStorage, cloud); persistenceClient = source;
  }
  return persistence;
};
const validate = (data: WardrobeData): WardrobeData => {
  if (
    !Array.isArray(data.wardrobeItems) ||
    !Array.isArray(data.savedOutfits) ||
    !data.wardrobeItems.every(
      (item) =>
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        typeof item.imageUrl === 'string' &&
        typeof item.brand === 'string' &&
        typeof item.createdAt === 'string' &&
        isGarmentCategory(item.category),
    ) ||
    !data.savedOutfits.every(
      (item) =>
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        Array.isArray(item.wardrobeItemIds) &&
        Array.isArray(item.catalogProductIds),
    )
  ) {
    throw new Error('Dolap kayıtları okunamadı.');
  }
  return data;
};
export async function loadWardrobe(userId: string): Promise<WardrobeData> {
  return validate(await wardrobePersistence().load(userId));
}
export const saveWardrobe = (
  userId: string,
  data: WardrobeData,
  onStage?: WardrobeProgress,
): Promise<WardrobeData> => {
  const entered = beginWardrobeWait('writeGuardQueue');
  notifyWardrobeStage('writeGuardQueue', onStage);
  return withAccountWriteWorkflow(userId, () => { entered(); return wardrobePersistence().save(userId, validate(data), onStage); });
};

export async function storeWardrobePhoto(
  userId: string,
  id: string,
  uri: string,
  onStage?: WardrobeProgress,
): Promise<string> {
  const entered = beginWardrobeWait('writeGuardQueue');
  notifyWardrobeStage('writeGuardQueue', onStage);
  return withAccountWriteGuard(userId, () => {
    entered(); return measureWardrobeStage('copy', () => storeWardrobePhotoOwned(userId, id, uri), onStage);
  });
}
async function storeWardrobePhotoOwned(userId: string, id: string, uri: string): Promise<string> {
  if (!FileSystem.documentDirectory)
    throw new Error('Fotoğraf klasörü kullanılamıyor.');
  const directory = `${FileSystem.documentDirectory}wardrobe/${encodeURIComponent(userId)}/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const extension =
    uri.split(/[?#]/)[0].match(/\.(png|jpe?g|heic|webp)$/i)?.[1] ?? 'jpg';
  const destination = `${directory}${encodeURIComponent(id)}-${createUuid()}.${extension}`;
  await createOwnedFileUnderGuard(userId, 'wardrobe-photo', destination, () => FileSystem.copyAsync({ from: uri, to: destination }));
  return destination;
}

// Same fence and durable journal as wardrobe writes; no cloud mutation is needed
// for fields that the current cloud payload does not persist.
export const saveWardrobeCutoutCheckpoint = (owner: string, id: string, original: string, patch: WardrobeCutoutPatch): Promise<boolean> =>
  {
    const entered = beginWardrobeWait('writeGuardQueue');
    return withAccountWriteWorkflow(owner, () => { entered(); return wardrobePersistence().patchCutout(owner, id, original, patch); });
  };

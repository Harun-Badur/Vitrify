import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'react-native';
import { tryOnGarment } from '../services/vtonService';
import { uploadModelPhoto, resolveSavedModelPhotoUri } from '../services/profileService';
import { createWardrobeCutout } from '../services/wardrobeCutoutService';
import { storeWardrobePhoto, resolveWardrobeOriginalPhotos } from '../services/wardrobeService';
import { readOwnedFileLedger } from '../services/ownedDeviceFiles';
import { fenceAccountWrites, resetAccountWriteFenceMemoryForTests } from '../lib/accountWriteFence';
import { resetDeviceWorkForTests, setDeviceSessionOwner } from '../lib/accountDeviceWork';
import { useAppStore } from '../store/useAppStore';
import type { Product } from '../types/product';
const mockFiles = new Set<string>(); let mockSequence = 0;
let mockSessionOwner = 'A';
const mockSignedUrls = jest.fn();
const mockJpeg = Buffer.from([255,216,255,192,0,17,8,2,88,1,44,3,1,17,0,2,17,0,3,17,0,255,217]).toString('base64');
const mockPng = (() => { const bytes = new Uint8Array(33); bytes.set([137,80,78,71,13,10,26,10]); bytes[25] = 6; return Buffer.from(bytes).toString('base64'); })();
const mockLiked = jest.fn(); const mockFeed = jest.fn(); const mockInsertLiked = jest.fn();
jest.mock('../services/likeService', () => ({ fetchLikedProducts: (...args: unknown[]) => mockLiked(...args), fetchPassedProductIds: async () => [],
  insertLikedProduct: (...args: unknown[]) => mockInsertLiked(...args), insertPassedProduct: async () => {}, deleteLikedProduct: async () => {}, updateLikedProductAlert: async () => {} }));
jest.mock('../services/productService', () => ({ fetchFeedProducts: (...args: unknown[]) => mockFeed(...args) }));
jest.mock('expo-file-system', () => ({ File: class { async base64() { return mockJpeg; } } }));
jest.mock('expo-image-manipulator', () => ({ SaveFormat: { JPEG: 'jpeg' }, manipulateAsync: jest.fn(async () => {
  const uri = `file:///cache/ImageManipulator/new-${++mockSequence}.jpg`; mockFiles.add(uri); return { uri, width: 300, height: 600 };
}) }));
jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: 'file:///cache/', documentDirectory: 'file:///docs/',
  EncodingType: { Base64: 'base64' }, FileSystemUploadType: { BINARY_CONTENT: 0 }, makeDirectoryAsync: async () => {},
  getInfoAsync: async (uri: string) => ({ exists: mockFiles.has(uri), isDirectory: false }),
  readDirectoryAsync: async () => [], readAsStringAsync: async () => mockJpeg,
  deleteAsync: async (uri: string) => { mockFiles.delete(uri); },
  writeAsStringAsync: async (uri: string) => { mockFiles.add(uri); },
  copyAsync: async ({ to }: { to: string }) => { mockFiles.add(to); },
  downloadAsync: async (_url: string, uri: string) => { mockFiles.add(uri); return { uri }; },
  createUploadTask: () => ({ uploadAsync: async () => ({ status: 200, body: JSON.stringify({ pngBase64: mockPng }) }), cancelAsync: async () => {} }) }));
jest.mock('../lib/supabase', () => {
  const profile = { id: 'A', height_cm: null, weight_kg: null, top_size: null, bottom_size: null, style_tags: [], model_photo_path: 'A/model.jpg' };
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'fixture-token', user: { id: 'A' } } }, error: null }),
    getUser: async () => ({ data: { user: { id: mockSessionOwner, user_metadata: {} } }, error: null }) },
    from: () => { const query = { select: () => query, eq: () => query, upsert: () => query,
      single: async () => ({ data: profile, error: null }), maybeSingle: async () => ({ data: profile, error: null }) }; return query; },
    functions: { invoke: async (_name: string, options: { headers: Record<string, string> }) => ({ error: null,
      data: { protocol: 'vitrify.storage-upload.v1', state: 'SUCCEEDED', operation: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        owner: 'A', bucket: options.headers['x-upload-bucket'], path: options.headers['x-upload-path'] } }) },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://fixture.invalid/model.jpg' }, error: null }), createSignedUrls: (...args: unknown[]) => mockSignedUrls(...args) }) } };
  return { getRequiredSupabaseClient: () => client, getSupabaseClient: () => client };
});
const product = { id: 'product', title: 'p', imageUrl: 'https://fixture.invalid/p.jpg', price: 1, brand: 'b', category: 'upper_body', garmentDescription: '' } as Product;
let originalFetch: typeof fetch, originalXhr: typeof XMLHttpRequest;
beforeEach(async () => {
  mockSessionOwner='A'; mockSignedUrls.mockReset();
  useAppStore.getState().resetSession(); await AsyncStorage.clear(); resetDeviceWorkForTests(); resetAccountWriteFenceMemoryForTests(); setDeviceSessionOwner('A');
  mockFiles.clear(); mockSequence = 0; mockLiked.mockReset().mockResolvedValue([]); mockFeed.mockReset(); mockInsertLiked.mockReset().mockResolvedValue(undefined);
  jest.spyOn(Image, 'getSize').mockImplementation((_uri, success) => { success?.(300, 600); });
  originalFetch = global.fetch; originalXhr = global.XMLHttpRequest;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ image_data_uri: `data:image/png;base64,${mockPng}` }), blob: async () => new Blob(['fixture']) })) as unknown as typeof fetch;
  global.XMLHttpRequest = class { upload = {}; status = 200; onload?: () => void; open() {} setRequestHeader() {} send() { void Promise.resolve().then(() => this.onload?.()); } } as unknown as typeof XMLHttpRequest;
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://fixture.invalid'; process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'fixture';
  process.env.EXPO_PUBLIC_VTON_PROXY_URL = 'https://fixture.invalid/vton-proxy'; process.env.EXPO_PUBLIC_WARDROBE_CUTOUT_URL = 'https://fixture.invalid/cutout';
});

it('private originals batch signed reads, reuse valid cache, renew expiry and reject another account', async () => {
  const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; mockSessionOwner=owner;
  const path=owner+'/cccccccc-cccc-4ccc-8ccc-cccccccccccc/original-dddddddd-dddd-4ddd-8ddd-dddddddddddd.png';
  let time=100_000; jest.spyOn(Date,'now').mockImplementation(()=>time);
  mockSignedUrls.mockImplementation(async (paths:string[])=>({error:null,data:paths.map(p=>({path:p,signedUrl:'https://fixture.invalid/read/'+time}))}));
  const first=await resolveWardrobeOriginalPhotos([path,path]);
  expect(first.get(path)?.url).toContain('100000'); expect(mockSignedUrls).toHaveBeenCalledWith([path],3600);
  await resolveWardrobeOriginalPhotos([path]); expect(mockSignedUrls).toHaveBeenCalledTimes(1);
  time+=3600_000; const renewed=await resolveWardrobeOriginalPhotos([path]);
  expect(renewed.get(path)?.url).not.toBe(first.get(path)?.url); expect(mockSignedUrls).toHaveBeenCalledTimes(2);
  mockSessionOwner='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await expect(resolveWardrobeOriginalPhotos([path])).rejects.toThrow();
  expect(mockSignedUrls).toHaveBeenCalledTimes(2);
});
afterEach(() => { global.fetch = originalFetch; global.XMLHttpRequest = originalXhr; jest.restoreAllMocks();
  for (const key of ['EXPO_PUBLIC_SUPABASE_URL','EXPO_PUBLIC_SUPABASE_ANON_KEY','EXPO_PUBLIC_VTON_PROXY_URL','EXPO_PUBLIC_WARDROBE_CUTOUT_URL']) delete process.env[key]; });

it('real VTON service journals owner-scoped result, releases manipulator temp and keeps gallery original', async () => {
  const source = 'file:///gallery/input.jpg'; mockFiles.add(source);
  const uri = await tryOnGarment(source, product.imageUrl, { productId: product.id, productTitle: product.title });
  expect(uri.startsWith('file:///cache/vitrify-owned/A/')).toBe(true); expect(mockFiles.has(uri)).toBe(true); expect(mockFiles.has(source)).toBe(true);
  expect([...mockFiles].some(path => path.includes('ImageManipulator'))).toBe(false);
  expect((await readOwnedFileLedger('A')).intents.some(item => item.kind === 'vton-result' && item.paths.includes(uri))).toBe(true);
  expect(await AsyncStorage.getItem('kabin.vton.history.v1.A')).toContain(uri);
});
it('model upload/cache, local wardrobe and cutout bindings all record ownership and release temps', async () => {
  await uploadModelPhoto('A', 'file:///gallery/original.jpg', { onProgress: () => {} });
  const model = await resolveSavedModelPhotoUri('A');
  const wardrobe = await storeWardrobePhoto('A', 'item', 'file:///gallery/original.jpg');
  const cutout = await createWardrobeCutout('A', { id: 'item', imageUrl: wardrobe } as never);
  const intents = (await readOwnedFileLedger('A')).intents;
  expect(intents.map(item => item.kind)).toEqual(['model-cache', 'wardrobe-photo', 'cutout']);
  expect(intents.flatMap(item => item.paths)).toEqual([model, wardrobe, cutout]);
  expect([...mockFiles].some(path => path.includes('ImageManipulator'))).toBe(false);
});
it('late A hydration cannot contaminate B or resurrect when A logs in again', async () => {
  let resolveA!: (value: unknown[]) => void;
  mockLiked.mockImplementationOnce(() => new Promise(resolve => { resolveA = resolve; }));
  const old = useAppStore.getState().hydrateSession('A');
  for (let i = 0; i < 20 && !resolveA; i++) await Promise.resolve();
  await useAppStore.getState().hydrateSession('B'); expect(useAppStore.getState().sessionUserId).toBe('B');
  await useAppStore.getState().hydrateSession('A'); resolveA([{ product: { ...product, id: 'old-A' } }]); await old;
  expect(useAppStore.getState().sessionUserId).toBe('A'); expect(useAppStore.getState().likedProducts).toEqual([]);
});
it('late feed completion and optimistic-like rollback cannot repopulate reset/fenced store', async () => {
  await useAppStore.getState().hydrateSession('A');
  let resolveFeed!: (value: object) => void, rejectLike!: (error: Error) => void;
  mockFeed.mockImplementationOnce(() => new Promise(resolve => { resolveFeed = resolve; }));
  mockInsertLiked.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectLike = reject; }));
  const feed = useAppStore.getState().loadFeed('A'); useAppStore.getState().swipeRight(product);
  let complete = false; const fence = fenceAccountWrites('A').then(() => { complete = true; });
  await Promise.resolve(); expect(complete).toBe(false);
  resolveFeed({ products: [product], source: 'fixture', isPersonalized: true }); rejectLike(new Error('late failure'));
  await feed; await fence;
  expect(useAppStore.getState().sessionUserId).toBeNull(); expect(useAppStore.getState().currentProducts).toEqual([]); expect(useAppStore.getState().likedProducts).toEqual([]);
});

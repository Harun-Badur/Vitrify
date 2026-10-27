import { create } from 'zustand';
import { createWardrobeSlice } from '../store/wardrobeSlice';
import type { AppState } from '../store/useAppStore';
import type { WardrobeData } from '../services/wardrobeService';
import { loadWardrobe, saveWardrobe, storeWardrobePhoto } from '../services/wardrobeService';
import { createWardrobePersistence, type CloudSnapshot, type WardrobeCloudPort } from '../services/wardrobeCloudPersistence';
import type { WardrobeItem } from '../types/wardrobe';

jest.mock('../services/wardrobeService', () => ({ loadWardrobe: jest.fn(), saveWardrobe: jest.fn(), storeWardrobePhoto: jest.fn() }));
jest.mock('../services/wardrobeCutoutService', () => ({ wardrobeCutoutConfigured: () => false, createWardrobeCutout: jest.fn(), uploadWardrobeCutout: jest.fn() }));
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../lib/logger', () => ({ logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const input = {
  title: 'Lacivert gömlek', brand: '', category: 'upper_body' as const, imageUrl: 'local-fixture',
  subcategory: 'gomlek', color: 'navy',
};
const makeStore = () => create<AppState>()((set, get, api) => ({
  ...createWardrobeSlice(set, get, api), sessionUserId: 'A',
}) as AppState);

describe('local store keeps subtype and color', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(loadWardrobe).mockResolvedValue({ wardrobeItems: [], savedOutfits: [], wardrobeSync: { state: 'synced', pending: 0 } });
    jest.mocked(storeWardrobePhoto).mockResolvedValue('local-copy');
    jest.mocked(saveWardrobe).mockImplementation(async (_owner, data) => ({ ...data, wardrobeSync: { state: 'synced', pending: 0 } }));
  });

  it('adds an item with subcategory and color and hands both to local persistence', async () => {
    const store = makeStore(); await store.getState().hydrateWardrobe('A');
    await store.getState().addWardrobeItem(input);
    expect(store.getState().wardrobeItems[0]).toMatchObject({ subcategory: 'gomlek', color: 'navy', title: 'Lacivert gömlek' });
    const saved = jest.mocked(saveWardrobe).mock.calls[0][1] as WardrobeData;
    expect(saved.wardrobeItems[0]).toMatchObject({ subcategory: 'gomlek', color: 'navy' });
  });

  it('edits subtype and color, and an edit without them keeps what was stored', async () => {
    const store = makeStore(); await store.getState().hydrateWardrobe('A');
    await store.getState().addWardrobeItem({ ...input, subcategory: undefined, color: undefined });
    const id = store.getState().wardrobeItems[0].id;
    expect(store.getState().wardrobeItems[0].subcategory).toBeUndefined();
    await store.getState().updateWardrobeItem(id, { title: 'Yeni', category: 'upper_body', brand: '', subcategory: 'polo', color: 'siyah' });
    expect(store.getState().wardrobeItems[0]).toMatchObject({ title: 'Yeni', subcategory: 'polo', color: 'siyah' });
    await store.getState().updateWardrobeItem(id, { title: 'Sadece ad', category: 'upper_body', brand: '' });
    expect(store.getState().wardrobeItems[0]).toMatchObject({ title: 'Sadece ad', subcategory: 'polo', color: 'siyah' });
  });
});

describe('cloud sync neither carries nor erases the local fields', () => {
  const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const legacyId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const base = { title: 'Gömlek', brand: '', category: 'upper_body' as const, imageUrl: 'https://images.example/a.jpg', createdAt: '2026-10-01T00:00:00Z' };
  // Mirrors the real RPC contract: only the fields the payload carries are stored.
  const cloudFields = ['id', 'title', 'category', 'brand', 'imageUrl', 'createdAt', 'imageStoragePath', 'cutoutProtocol'] as const;
  function setup() {
    const snapshot: CloudSnapshot = { items: [], outfits: [], photoVersion: 1 };
    let revision = 0;
    const port: WardrobeCloudPort = {
      authenticate: async () => {},
      snapshot: async () => structuredClone(snapshot),
      apply: async (_user, op) => {
        if (op.kind !== 'item' || op.value === null) return 'applied';
        const value = op.value as unknown as Record<string, unknown>;
        const row = Object.fromEntries(cloudFields.filter(key => key in value).map(key => [key, value[key]]));
        const index = snapshot.items.findIndex(existing => existing.id === op.id);
        const stored = { ...row, id: op.id, updatedAt: String(++revision) } as unknown as CloudSnapshot['items'][number];
        if (index >= 0) snapshot.items[index] = stored; else snapshot.items.push(stored);
        return 'applied';
      },
    };
    const disk = new Map<string, string>();
    const storage = { getItem: async (key: string) => disk.get(key) ?? null, setItem: async (key: string, value: string) => { disk.set(key, value); } };
    return { snapshot, service: createWardrobePersistence(storage, port) };
  }

  it('does not send subtype or color to the cloud but keeps them locally across save and reload', async () => {
    const { snapshot, service } = setup();
    const withFields: WardrobeItem = { ...base, id, subcategory: 'gomlek', color: 'navy' };
    const saved = await service.save(owner, { wardrobeItems: [withFields], savedOutfits: [] });
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0]).not.toHaveProperty('subcategory');
    expect(snapshot.items[0]).not.toHaveProperty('color');
    expect(saved.wardrobeItems[0]).toMatchObject({ subcategory: 'gomlek', color: 'navy' });
    expect(saved.wardrobeSync).toMatchObject({ state: 'synced', pending: 0 });
    expect(saved.wardrobeConfirmedItems?.[id]).toBeDefined();
    const reloaded = await service.load(owner);
    expect(reloaded.wardrobeItems[0]).toMatchObject({ subcategory: 'gomlek', color: 'navy' });
  });

  it('keeps items without the fields untouched next to items that have them', async () => {
    const { service } = setup();
    const legacy: WardrobeItem = { ...base, id: legacyId, title: 'Eski' };
    const fresh: WardrobeItem = { ...base, id, subcategory: 'polo', color: 'siyah' };
    const saved = await service.save(owner, { wardrobeItems: [legacy, fresh], savedOutfits: [] });
    const byId = new Map(saved.wardrobeItems.map(row => [row.id, row]));
    expect(byId.get(legacyId)).not.toHaveProperty('subcategory');
    expect(byId.get(legacyId)).not.toHaveProperty('color');
    expect(byId.get(id)).toMatchObject({ subcategory: 'polo', color: 'siyah' });
    const reloaded = await service.load(owner);
    expect(reloaded.wardrobeItems.find(row => row.id === id)).toMatchObject({ subcategory: 'polo', color: 'siyah' });
    expect(reloaded.wardrobeItems.find(row => row.id === legacyId)).not.toHaveProperty('subcategory');
  });
});

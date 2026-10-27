import { createWardrobePersistence, type CloudSnapshot, type WardrobeCloudPort } from '../services/wardrobeCloudPersistence';
import type { WardrobeItem, SavedOutfit } from '../types/wardrobe';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fenceAccountWrites, resetAccountWriteFenceMemoryForTests, withAccountWriteGuard, withAccountWriteWorkflow } from '../lib/accountWriteFence';
import { ownerWorkEvidence, resetDeviceWorkForTests, setDeviceSessionOwner } from '../lib/accountDeviceWork';
const item = { id: 'legacy-top', title: 'Gömlek', brand: 'Marka', category: 'upper_body' as const, imageUrl: 'https://images.example/top.jpg', createdAt: '2026-10-01T00:00:00Z' };
function fakeCloud() {
  const records = new Map<string, CloudSnapshot>(); let revision = 0; let online = true;
  const snapshot = (user: string) => records.get(user) ?? { items: [], outfits: [], photoVersion: 1 };
  const port: WardrobeCloudPort = {
    authenticate: async user => { if (!online) throw new Error('offline'); if (user === 'wrong-session') throw new Error('owner'); },
    snapshot: async user => structuredClone(snapshot(user)),
    apply: async (user, op) => {
      if (!online) throw new Error('offline');
      const data = snapshot(user); records.set(user, data);
      const rows = op.kind === 'item' ? data.items : data.outfits;
      const previous = rows.find(row => row.id === op.id);
      if (previous ? previous.updatedAt !== op.expected : op.expected !== null) return 'conflict';
      if (op.value === null) {
        const index = rows.findIndex(row => row.id === op.id); if (index >= 0) rows.splice(index, 1);
        if (op.kind === 'item') for (const outfit of data.outfits) {
          if (outfit.wardrobeItemIds.includes(op.id)) { outfit.wardrobeItemIds = outfit.wardrobeItemIds.filter(id => id !== op.id); outfit.updatedAt = String(++revision); }
        }
      } else if (op.kind === 'item') {
        const value = op.value as WardrobeItem;
        if (!value.imageUrl.startsWith('https://') && !value.imageStoragePath) throw new Error('device URI');
        const row = { ...value, id: op.id, updatedAt: String(++revision) };
        if (previous) Object.assign(previous, row); else data.items.push(row);
      } else {
        const value = op.value as SavedOutfit;
        if (value.wardrobeItemIds.some((id: string) => !data.items.some(row => row.id === id))) throw new Error('foreign reference');
        const row = { ...value, id: op.id, updatedAt: String(++revision) };
        if (previous) Object.assign(previous, row); else data.outfits.push(row);
      }
      return 'applied';
    },
  };
  return { port, records, snapshot, setOnline: (value: boolean) => { online = value; } };
}
function device(cloud: WardrobeCloudPort | null) {
  const disk = new Map<string, string>();
  const storage = { getItem: async (key: string) => disk.get(key) ?? null, setItem: async (key: string, value: string) => { disk.set(key, value); } };
  const service = createWardrobePersistence(storage, cloud);
  return { disk, storage, service };
}

describe('isolated Storage replay', () => {
  const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const old = { ...item, id: 'old-photo', imageUrl: 'file:///old.png' };
  const fresh = { ...item, id: 'new-photo', imageUrl: 'file:///new.png' };
  const unavailable = () => Object.assign(new Error('controlled'), {
    code: 'STORAGE_RECONCILIATION_UNAVAILABLE', diagnosticTransport: 'http', diagnosticHttpStatus: 404,
  });
  function setup() {
    const cloud = fakeCloud();
    cloud.port.photoPath = (_owner, id) => `${owner}/${id}/original-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png`;
    const upload = jest.fn(async (_owner: string, _path: string, source: string) => {
      if (source === old.imageUrl) throw unavailable();
    });
    const apply = jest.fn(cloud.port.apply);
    cloud.port.uploadPhoto = upload; cloud.port.apply = apply;
    const d = device(cloud.port);
    const journal = () => JSON.parse(d.disk.get(`vitrify.wardrobe.sync.v1.${owner}`)!);
    return { cloud, upload, apply, ...d, journal };
  }
  beforeEach(async () => { resetDeviceWorkForTests(); resetAccountWriteFenceMemoryForTests(); });

  test('preserves old UNKNOWN while independent new photo applies; dependent outfit waits and reopen is idempotent', async () => {
    const f = setup();
    await f.service.save(owner, { wardrobeItems: [old], savedOutfits: [] });
    const before = f.journal().pending[0];
    const outfit = { id: 'dependent', title: 'Kombin', wardrobeItemIds: [old.id, fresh.id], catalogProductIds: [], createdAt: item.createdAt };
    const result = await f.service.save(owner, { wardrobeItems: [old, fresh], savedOutfits: [outfit] });
    expect(f.cloud.snapshot(owner).items).toHaveLength(1);
    expect(f.cloud.snapshot(owner).items[0].title).toBe(fresh.title);
    expect(f.cloud.snapshot(owner).outfits).toHaveLength(0);
    expect(f.apply).toHaveBeenCalledTimes(1);
    expect(f.apply.mock.calls[0][1].expected).toBeNull();
    expect(result.wardrobeSync?.state).toBe('pending');
    expect(f.journal().pending).toHaveLength(2);
    expect(f.journal().pending[0]).toEqual(before);
    await createWardrobePersistence(f.storage, f.cloud.port).load(owner);
    expect(f.upload.mock.calls.filter(call => call[2] === fresh.imageUrl)).toHaveLength(1);
    expect(f.apply).toHaveBeenCalledTimes(1);
    expect(f.journal().pending[0]).toEqual(before);
  });

  test('blocks later operations for the same item and outfits even when the referenced row already exists', async () => {
    const f = setup();
    // A queued photo replacement for an existing row uses that row's frozen version.
    const initial = await f.service.save(owner, { wardrobeItems: [{ ...old, imageUrl: item.imageUrl }], savedOutfits: [] });
    await f.service.save(owner, { ...initial, wardrobeItems: [old] });
    const j = f.journal();
    const first = structuredClone(j.pending[0]);
    j.pending.push({ ...structuredClone(first), value: { ...first.value, title: 'later same item', imageUrl: item.imageUrl } });
    const outfit = { id: 'dependent-existing', title: 'Kombin', wardrobeItemIds: [old.id], catalogProductIds: [], createdAt: item.createdAt };
    j.pending.push({ kind: 'outfit', id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', localId: outfit.id, expected: null, value: outfit, dispatched: false });
    f.disk.set(`vitrify.wardrobe.sync.v1.${owner}`, JSON.stringify(j));
    f.apply.mockClear(); f.upload.mockClear();
    await f.service.load(owner);
    expect(f.apply).not.toHaveBeenCalled();
    expect(f.upload).toHaveBeenCalledTimes(1);
    expect(f.journal().pending[0]).toEqual(first);
    expect(f.journal().pending).toHaveLength(3);
  });

  test('still detects an independent stale expected version instead of overwriting', async () => {
    const f = setup();
    const other = { ...item, id: 'versioned' };
    await f.service.save(owner, { wardrobeItems: [other], savedOutfits: [] });
    await f.service.save(owner, { wardrobeItems: [old, other], savedOutfits: [] });
    const row = f.cloud.snapshot(owner).items[0]; row.updatedAt = 'concurrent-version'; row.title = 'remote title';
    f.apply.mockClear();
    await f.service.save(owner, { wardrobeItems: [old, { ...other, title: 'local title' }, fresh], savedOutfits: [] });
    expect(row.title).toBe('remote title');
    expect(f.journal().pending.find((op: { localId: string }) => op.localId === other.id).conflict).toBe(true);
    expect(f.apply).toHaveBeenCalledTimes(1);
    expect(f.cloud.snapshot(owner).items).toHaveLength(2);
  });

  test.each([
    ['STORAGE_RECONCILIATION_UNAVAILABLE', 401], ['STORAGE_RECONCILIATION_UNAVAILABLE', 403],
    ['STORAGE_RECONCILIATION_UNAVAILABLE', 500], ['STORAGE_OWNER_UNVERIFIED', 404],
    ['STORAGE_JOURNAL_INVALID', 404], ['STORAGE_JOURNAL_CHANGED', 404],
    ['STORAGE_JOURNAL_UNVERIFIED', 404], ['STORAGE_UPLOAD_UNCONFIRMED', 404], ['unknown', 404],
  ])('does not skip unclassified/security failure %s/%s', async (code, diagnosticHttpStatus) => {
    const f = setup(); await f.service.save(owner, { wardrobeItems: [old], savedOutfits: [] });
    f.upload.mockClear().mockRejectedValue(Object.assign(new Error('controlled'), { code, diagnosticTransport: 'http', diagnosticHttpStatus }));
    await f.service.save(owner, { wardrobeItems: [old, fresh], savedOutfits: [] });
    expect(f.upload).toHaveBeenCalledTimes(1); expect(f.apply).not.toHaveBeenCalled();
    expect(f.journal().pending).toHaveLength(2);
  });

  test('also isolates a validated UNKNOWN status, without treating it as success', async () => {
    const f = setup(); await f.service.save(owner, { wardrobeItems: [old], savedOutfits: [] });
    f.upload.mockImplementation(async (_owner, _path, source) => {
      if (source === old.imageUrl) throw Object.assign(new Error('controlled'), { code: 'WARDROBE_STORAGE_UNKNOWN' });
    });
    await f.service.save(owner, { wardrobeItems: [old, fresh], savedOutfits: [] });
    expect(f.apply).toHaveBeenCalledTimes(1); expect(f.journal().pending).toHaveLength(1);
    expect(f.journal().pending[0].photo.uploaded).toBe(false);
  });

  test('account change after a skipped status prevents any later upload or apply', async () => {
    const f = setup(); await f.service.save(owner, { wardrobeItems: [old], savedOutfits: [] });
    let changed = false;
    f.upload.mockImplementation(async () => { changed = true; throw unavailable(); });
    f.cloud.port.authenticate = async () => { if (changed) throw new Error('owner changed'); };
    f.upload.mockClear();
    await f.service.save(owner, { wardrobeItems: [old, fresh], savedOutfits: [] });
    expect(f.upload).toHaveBeenCalledTimes(1); expect(f.apply).not.toHaveBeenCalled();
  });

  test('checkpoint failure stops before later operations', async () => {
    const f = setup(); await f.service.save(owner, { wardrobeItems: [old], savedOutfits: [] });
    let writes = 0;
    const setItem = f.storage.setItem;
    f.storage.setItem = async (key, value) => { if (++writes === 3) throw new Error('checkpoint failed'); await setItem(key, value); };
    f.upload.mockClear();
    await f.service.save(owner, { wardrobeItems: [old, fresh], savedOutfits: [] });
    expect(f.upload).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled();
  });

  test('deletion drains the original workflow and fences the next independent photo', async () => {
    const f = setup(); await f.service.save(owner, { wardrobeItems: [old], savedOutfits: [] });
    setDeviceSessionOwner(owner);
    let release!: () => void, started!: () => void;
    const response = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    const dispatch = jest.fn();
    f.upload.mockImplementation((u, _path, source) => withAccountWriteGuard(u, async () => {
      if (source === old.imageUrl) { started(); await response; throw unavailable(); }
      dispatch();
    }));
    const work = withAccountWriteWorkflow(owner, () => f.service.save(owner, { wardrobeItems: [old, fresh], savedOutfits: [] }));
    await entered;
    let drained = false;
    const fence = fenceAccountWrites(owner).then(() => { drained = true; });
    expect(ownerWorkEvidence(owner).pending).toBe(1); expect(drained).toBe(false);
    release(); await work; await fence;
    expect(dispatch).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); expect(f.journal().pending).toHaveLength(2);
    expect(ownerWorkEvidence(owner)).toEqual({ fenced: true, pending: 0, nonempty: 0 });
  });
});
test('first save creates cloud row; retry/reopen does not duplicate and legacy IDs stay stable', async () => {
  const cloud = fakeCloud(), d = device(cloud.port);
  await d.service.save('alice', { wardrobeItems: [item], savedOutfits: [] });
  expect(cloud.snapshot('alice').items).toHaveLength(1);
  await d.service.save('alice', { wardrobeItems: [item], savedOutfits: [] });
  const reopened = createWardrobePersistence(d.storage, cloud.port);
  expect((await reopened.load('alice')).wardrobeItems[0]).toMatchObject(item);
  expect(cloud.snapshot('alice').items).toHaveLength(1);
});
test('legacy bytes are backed up and imported with outfit references using persisted UUID mapping', async () => {
  const cloud = fakeCloud(), d = device(cloud.port);
  const outfit = { id: 'legacy-outfit', title: 'Kombin', wardrobeItemIds: [item.id], catalogProductIds: ['product-1'], createdAt: item.createdAt };
  const original = JSON.stringify({ wardrobeItems: [item], savedOutfits: [outfit] });
  d.disk.set('vitrify.wardrobe.v1.alice', original);
  const result = await d.service.load('alice');
  expect([...d.disk.values()]).toContain(original);
  expect(result.savedOutfits[0].wardrobeItemIds).toEqual([item.id]);
  expect(cloud.snapshot('alice').outfits[0].wardrobeItemIds).toEqual([cloud.snapshot('alice').items[0].id]);
  expect(cloud.snapshot('alice').items[0].id).toMatch(/^[a-f0-9-]{36}$/);
});
test('offline retains local data and pending; reconnect reconciles without replacing another device row', async () => {
  const cloud = fakeCloud(), a = device(cloud.port), b = device(cloud.port);
  cloud.setOnline(false); const pending = await a.service.save('alice', { wardrobeItems: [item], savedOutfits: [] });
  expect(pending.wardrobeSync?.state).toBe('pending'); expect((await a.service.load('alice')).wardrobeItems).toHaveLength(1);
  cloud.setOnline(true); await b.service.save('alice', { wardrobeItems: [{ ...item, id: 'other', title: 'Diğer' }], savedOutfits: [] });
  const result = await a.service.load('alice'); expect(result.wardrobeItems).toHaveLength(2);
  expect((await b.service.load('alice')).wardrobeItems).toHaveLength(2);
});
test('update/update conflict preserves pending and displays authoritative cloud value', async () => {
  const cloud = fakeCloud(), a = device(cloud.port), b = device(cloud.port);
  await a.service.save('alice', { wardrobeItems: [item], savedOutfits: [] }); const remote = await b.service.load('alice');
  cloud.setOnline(false); await a.service.save('alice', { wardrobeItems: [{ ...item, title: 'Offline' }], savedOutfits: [] });
  cloud.setOnline(true); await b.service.save('alice', { ...remote, wardrobeItems: [{ ...remote.wardrobeItems[0], title: 'Bulut' }] });
  const result = await a.service.load('alice'); expect(result.wardrobeSync?.state).toBe('conflict'); expect(result.wardrobeItems[0].title).toBe('Bulut');
  expect([...a.disk.values()].join('')).toContain('Offline');
});
test('remote delete beats stale offline update: no automatic resurrection', async () => {
  const cloud = fakeCloud(), a = device(cloud.port), b = device(cloud.port);
  await a.service.save('alice', { wardrobeItems: [item], savedOutfits: [] }); await b.service.load('alice');
  cloud.setOnline(false); await a.service.save('alice', { wardrobeItems: [{ ...item, title: 'Offline' }], savedOutfits: [] });
  cloud.setOnline(true); await b.service.save('alice', { wardrobeItems: [], savedOutfits: [] });
  expect((await a.service.load('alice')).wardrobeSync?.state).toBe('conflict'); expect(cloud.snapshot('alice').items).toHaveLength(0);
  expect([...a.disk.values()].join('')).toContain('Offline');
});
test('lost create acknowledgement then remote delete does not recreate on retry', async () => {
  const cloud = fakeCloud(), a = device({ ...cloud.port, apply: async (u, op) => { await cloud.port.apply(u, op); throw new Error('lost ack'); } });
  await a.service.save('alice', { wardrobeItems: [item], savedOutfits: [] }); cloud.snapshot('alice').items.splice(0);
  const retry = createWardrobePersistence(a.storage, cloud.port);
  expect((await retry.load('alice')).wardrobeSync?.state).toBe('conflict'); expect(cloud.snapshot('alice').items).toHaveLength(0);
});
test('missing schema and device-only photo leave data pending, not fake remote image URLs', async () => {
  const cloud = fakeCloud(), d = device(cloud.port);
  const local = { ...item, imageUrl: 'file:///photo.jpg' };
  const result = await d.service.save('alice', { wardrobeItems: [local], savedOutfits: [] });
  expect(result.wardrobeSync?.state).toBe('pending'); expect(result.wardrobeItems[0].imageUrl).toBe(local.imageUrl); expect(cloud.snapshot('alice').items).toHaveLength(0);
  const failing = createWardrobePersistence(d.storage, { ...cloud.port, snapshot: async () => { throw new Error('schema missing'); } });
  expect((await failing.load('alice')).wardrobeItems[0].imageUrl).toBe(local.imageUrl);
});
test('accounts are isolated and invalid current session never calls snapshot or mutation', async () => {
  const cloud = fakeCloud(), d = device(cloud.port); await d.service.save('alice', { wardrobeItems: [item], savedOutfits: [] });
  expect((await d.service.load('bob')).wardrobeItems).toHaveLength(0);
  const snapshot = jest.fn(cloud.port.snapshot), apply = jest.fn(cloud.port.apply);
  const guarded = createWardrobePersistence(d.storage, { ...cloud.port, snapshot, apply });
  expect((await guarded.load('wrong-session')).wardrobeSync?.state).toBe('pending'); expect(snapshot).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
});
test('foreign wardrobe reference does not create an outfit and remains pending', async () => {
  const cloud = fakeCloud(), d = device(cloud.port); await d.service.save('alice', { wardrobeItems: [item], savedOutfits: [] });
  const result = await d.service.save('bob', { wardrobeItems: [], savedOutfits: [{ id: 'bad-outfit', title: 'Yabancı', wardrobeItemIds: [cloud.snapshot('alice').items[0].id], catalogProductIds: [], createdAt: item.createdAt }] });
  expect(result.wardrobeSync?.state).toBe('conflict'); expect(cloud.snapshot('bob').outfits).toHaveLength(0);
});
test('delete clears cloud outfit relations and local references without deleting saved outfit', async () => {
  const cloud = fakeCloud(), d = device(cloud.port);
  await d.service.save('alice', { wardrobeItems: [item], savedOutfits: [{ id: 'outfit', title: 'Kombin', wardrobeItemIds: [item.id], catalogProductIds: [], createdAt: item.createdAt }] });
  const loaded = await d.service.load('alice');
  const result = await d.service.save('alice', { ...loaded, wardrobeItems: [] });
  expect(result.savedOutfits[0].wardrobeItemIds).toEqual([]); expect(cloud.snapshot('alice').outfits[0].wardrobeItemIds).toEqual([]);
});
test('disk write fails before dispatch: no cloud mutation; original local bytes remain', async () => {
  const cloud = fakeCloud(), d = device(cloud.port), apply = jest.fn(cloud.port.apply);
  const failing = createWardrobePersistence({ ...d.storage, setItem: async () => { throw new Error('disk full'); } }, { ...cloud.port, apply });
  await expect(failing.save('alice', { wardrobeItems: [item], savedOutfits: [] })).rejects.toThrow('disk full'); expect(apply).not.toHaveBeenCalled();
});
test('legacy additions written after initialization are not silently ignored', async () => {
  const d = device(null); await d.service.load('alice');
  const original = JSON.stringify({ wardrobeItems: [item], savedOutfits: [] });
  d.disk.set('vitrify.wardrobe.v1.alice', original);
  expect((await d.service.load('alice')).wardrobeItems[0]).toMatchObject(item);
  expect([...d.disk.values()].join('')).toContain(item.title);
});
test('malformed cloud snapshot cannot erase known local data', async () => {
  const cloud = fakeCloud(), d = device(cloud.port); await d.service.save('alice', { wardrobeItems: [item], savedOutfits: [] });
  const invalid = createWardrobePersistence(d.storage, { ...cloud.port, snapshot: async () => ({ items: [{}], outfits: [] }) as unknown as CloudSnapshot });
  const result = await invalid.load('alice'); expect(result.wardrobeItems[0]).toMatchObject(item); expect(result.wardrobeSync?.state).toBe('pending');
});
test('same legacy record on two devices maps to one cloud UUID', async () => {
  const cloud = fakeCloud(), a = device(cloud.port), b = device(cloud.port);
  const raw = JSON.stringify({ wardrobeItems: [item], savedOutfits: [] });
  a.disk.set('vitrify.wardrobe.v1.alice', raw); b.disk.set('vitrify.wardrobe.v1.alice', raw);
  await a.service.load('alice'); await b.service.load('alice'); expect(cloud.snapshot('alice').items).toHaveLength(1);
});
test('portable legacy UUID matches SHA-1 identity bytes and separates owner/kind', async () => {
  const cloud = fakeCloud(), d = device(cloud.port); await d.service.save('alice', { wardrobeItems: [item], savedOutfits: [] });
  const bytes = createHash('sha1').update(JSON.stringify(['vitrify.wardrobe','alice','item',item.id])).digest().subarray(0,16);
  bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
  expect(cloud.snapshot('alice').items[0].id.replaceAll('-','')).toBe(bytes.toString('hex'));
  await d.service.save('bob', { wardrobeItems: [item], savedOutfits: [] });
  expect(cloud.snapshot('bob').items[0].id).not.toBe(cloud.snapshot('alice').items[0].id);
});
test('SQL uses existing tables, invoker RLS, owner and row-version checks, transaction-local outfit references', () => {
  const sql = readFileSync('reports/backend/proposals/20261012_wardrobe_cloud_persistence.sql', 'utf8');
  expect(sql).not.toMatch(/create\s+table|security\s+definer/i);
  expect(sql).toContain('security invoker'); expect(sql).toContain('auth.uid()');
  expect(sql).toContain('p_expected'); expect(sql).toContain('for update');
  expect(sql).toContain('outfit_items'); expect(sql).toContain('wardrobe_items');
  expect(sql).toContain('from public,anon'); expect(sql).toContain('to authenticated');
});

test('original photo checkpoints immutable path before upload; cloud never receives local or signed URL', async () => {
  const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', cloud = fakeCloud();
  const d = device(cloud.port); let path = '';
  cloud.port.photoPath = (_owner, id) => `${owner}/${id}/original-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png`;
  cloud.port.uploadPhoto = jest.fn(async (_owner, assigned, localUri) => {
    path = assigned; expect(localUri).toBe('file:///original.jpg');
    expect([...d.disk.values()].join('')).toContain(assigned);
  });
  const result = await d.service.save(owner, { wardrobeItems: [{ ...item, imageUrl: 'file:///original.jpg' }], savedOutfits: [] });
  expect(cloud.port.uploadPhoto).toHaveBeenCalledTimes(1);
  expect(cloud.snapshot(owner).items[0]).toMatchObject({ imageStoragePath: path, imageUrl: '' });
  expect(result.wardrobeSync?.state).toBe('synced');
  expect(result.wardrobeItems[0].imageLocalUri).toBe('file:///original.jpg');
  await createWardrobePersistence(d.storage, cloud.port).load(owner);
  expect(cloud.port.uploadPhoto).toHaveBeenCalledTimes(1);
});

test('unknown photo upload preserves original and retries same path through existing upload reconciliation', async () => {
  const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', cloud = fakeCloud();
  cloud.port.photoPath = (_owner, id) => `${owner}/${id}/original-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png`;
  const upload = jest.fn().mockRejectedValueOnce(new Error('UNKNOWN')).mockResolvedValue(undefined);
  cloud.port.uploadPhoto = upload; const d = device(cloud.port);
  const first = await d.service.save(owner, { wardrobeItems: [{ ...item, imageUrl: 'file:///original.jpg' }], savedOutfits: [] });
  expect(first.wardrobeItems[0].imageUrl).toBe('file:///original.jpg'); expect(first.wardrobeSync?.state).toBe('pending');
  expect(cloud.snapshot(owner).items).toHaveLength(0);
  await createWardrobePersistence(d.storage, cloud.port).load(owner);
  expect(upload.mock.calls[0][1]).toBe(upload.mock.calls[1][1]);
  expect(cloud.snapshot(owner).items).toHaveLength(1);
});

test('foreign original path is rejected without mutation or local data loss', async () => {
  const cloud = fakeCloud(), d = device(cloud.port);
  const result = await d.service.save('alice', { wardrobeItems: [{ ...item, imageStoragePath: 'bob/id/original.png' }], savedOutfits: [] });
  expect(result.wardrobeSync?.state).toBe('pending'); expect(cloud.snapshot('alice').items).toHaveLength(0);
  expect(result.wardrobeItems[0].title).toBe(item.title);
});

test('photo SQL extends existing RPCs without weakening owner RLS or persisting signed URLs', () => {
  const sql = readFileSync('reports/backend/proposals/20261014_wardrobe_original_photo.sql','utf8');
  expect(sql).toContain('image_storage_path'); expect(sql).toContain('imageStoragePath');
  expect(sql).toContain('security invoker'); expect(sql).toContain('p_expected');
  expect(sql).toContain('original-'); expect(sql).toContain('auth.uid()');
  expect(sql).toContain('RPC fingerprint mismatch'); expect(sql).toContain('-- ROLLBACK');
  expect(sql).not.toMatch(/delete from public\.(users|products)|create table/i);
});

test('old snapshot contract never activates photo writes before SQL installation', async () => {
  const cloud=fakeCloud();
  cloud.port.snapshot=async ()=>({items:[],outfits:[]});
  cloud.port.photoPath=jest.fn(); cloud.port.uploadPhoto=jest.fn();
  const d=device(cloud.port);
  const result=await d.service.save('alice',{wardrobeItems:[{...item,imageUrl:'file:///old.jpg'}],savedOutfits:[]});
  expect(result.wardrobeSync?.state).toBe('pending'); expect(result.wardrobeItems[0].imageUrl).toBe('file:///old.jpg');
  expect(cloud.port.photoPath).not.toHaveBeenCalled(); expect(cloud.port.uploadPhoto).not.toHaveBeenCalled();
});

test('pre-dispatch auth failure does not mark an unsent DB mutation as dispatched or prevent safe recovery', async () => {
  const cloud = fakeCloud(); let calls = 0;
  const authenticate = jest.fn(async (owner: string) => {
    if (++calls === 2) throw new Error('temporary auth transport failure');
    await cloud.port.authenticate(owner);
  });
  const apply = jest.fn(cloud.port.apply);
  const d = device({ ...cloud.port, authenticate, apply });
  const first = await d.service.save('alice', { wardrobeItems: [item], savedOutfits: [] });
  expect(first.wardrobeSync?.state).toBe('pending');
  expect(apply).not.toHaveBeenCalled();
  const journal = JSON.parse(d.disk.get('vitrify.wardrobe.sync.v1.alice')!);
  expect(journal.pending[0].dispatched).toBe(false);
  const recovered = await createWardrobePersistence(d.storage, { ...cloud.port, authenticate, apply }).load('alice');
  expect(recovered.wardrobeSync?.state).toBe('synced');
  expect(apply).toHaveBeenCalledTimes(1);
  expect(cloud.snapshot('alice').items).toHaveLength(1);
});

test('missing photo capability is diagnosed without upload, apply, data loss or false cloud success', async () => {
  const log = jest.spyOn(console, 'info').mockImplementation(() => {});
  try {
    const cloud = fakeCloud();
    const uploadPhoto = jest.fn(), apply = jest.fn(cloud.port.apply);
    const d = device({ ...cloud.port, snapshot: async () => ({ items: [], outfits: [] }), uploadPhoto });
    const result = await d.service.save('alice', { wardrobeItems: [{ ...item, imageUrl: 'file:///private-original.jpg' }], savedOutfits: [] });
    expect(result.wardrobeSync?.state).toBe('pending');
    expect(result.wardrobeItems[0].imageUrl).toBe('file:///private-original.jpg');
    expect(uploadPhoto).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
    expect(log.mock.calls).toContainEqual([JSON.stringify({ type: 'wardrobe_sync_diagnostic', phase: 'media', reason: 'PHOTO_CONTRACT_UNAVAILABLE' })]);
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-original');
  } finally { log.mockRestore(); }
});

test.each(['WARDROBE_RPC_MISSING', 'private-unknown-error'])('sync diagnostics never expose raw server details for %s', async code => {
  const log = jest.spyOn(console, 'info').mockImplementation(() => {});
  try {
    const cloud = fakeCloud();
    const d = device({ ...cloud.port, snapshot: async () => { throw Object.assign(new Error('private-token-and-photo'), { code }); } });
    const result = await d.service.save('alice', { wardrobeItems: [item], savedOutfits: [] });
    expect(result.wardrobeSync?.state).toBe('pending');
    expect(log.mock.calls).toContainEqual([JSON.stringify({ type: 'wardrobe_sync_diagnostic', phase: 'snapshot', reason: code === 'WARDROBE_RPC_MISSING' ? 'RPC_MISSING' : 'UNVERIFIED' })]);
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-');
  } finally { log.mockRestore(); }
});

test('another device photo version never reuses the previous local original as its fallback', async () => {
  const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', cloud=fakeCloud();
  cloud.port.photoPath=(_owner,id)=>owner+'/'+id+'/original-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png';
  cloud.port.uploadPhoto=async()=>{};
  const d=device(cloud.port);
  await d.service.save(owner,{wardrobeItems:[{...item,imageUrl:'file:///previous.jpg'}],savedOutfits:[]});
  const row=cloud.snapshot(owner).items[0];
  row.imageStoragePath=owner+'/'+row.id+'/original-cccccccc-cccc-4ccc-8ccc-cccccccccccc.png';
  row.imageUrl='https://fixture.invalid/new-original'; row.updatedAt='next';
  const result=await d.service.load(owner);
  expect(result.wardrobeItems[0].imageLocalUri).toBeUndefined();
  expect(result.wardrobeItems[0].imageUrl).toBe(row.imageUrl);
});


test('stage observation preserves successful cloud request counts and data', async () => {
  const cloud = fakeCloud();
  const snapshot = jest.fn(cloud.port.snapshot);
  const apply = jest.fn(cloud.port.apply);
  const d = device({ ...cloud.port, snapshot, apply });
  const onStage = jest.fn();
  const result = await d.service.save('alice', { wardrobeItems: [item], savedOutfits: [] }, onStage);
  expect(result.wardrobeSync?.state).toBe('synced');
  expect(snapshot).toHaveBeenCalledTimes(2);
  expect(apply).toHaveBeenCalledTimes(1);
  expect(onStage.mock.calls.map(([stage]) => stage)).toEqual(expect.arrayContaining(['checkpoint', 'authenticate', 'snapshot', 'database']));
});


test('cutout checkpoints are durable without another cloud snapshot, apply or upload', async () => {
  const cloud = fakeCloud();
  const authenticate = jest.fn(cloud.port.authenticate), snapshot = jest.fn(cloud.port.snapshot), apply = jest.fn(cloud.port.apply);
  const d = device({ ...cloud.port, authenticate, snapshot, apply });
  await d.service.save('alice', { wardrobeItems: [{ ...item, cutoutStatus: 'pending' }], savedOutfits: [] });
  const counts = [authenticate.mock.calls.length, snapshot.mock.calls.length, apply.mock.calls.length];
  expect(await d.service.patchCutout('alice', item.id, item.imageUrl, { cutoutStatus: 'blocked' })).toBe(true);
  expect(await d.service.patchCutout('alice', item.id, item.imageUrl, { cutoutLocalUri: 'file:///processed.png' })).toBe(true);
  expect(await d.service.patchCutout('alice', item.id, item.imageUrl, { cutoutStatus: 'ready', cutoutUrl: 'https://images.example/cutout.png' })).toBe(true);
  expect([authenticate.mock.calls.length, snapshot.mock.calls.length, apply.mock.calls.length]).toEqual(counts);
  expect((await d.service.load('alice')).wardrobeItems[0]).toMatchObject({ cutoutStatus: 'ready', cutoutLocalUri: 'file:///processed.png' });
  expect(await d.service.patchCutout('alice', item.id, 'different.jpg', { cutoutStatus: 'pending' })).toBe(false);
});

test('local cutout checkpoints update pending values too, so offline projection cannot revive pending inference', async () => {
  const d = device(null);
  await d.service.save('alice', { wardrobeItems: [{ ...item, cutoutStatus: 'pending' }], savedOutfits: [] });
  await d.service.patchCutout('alice', item.id, item.imageUrl, { cutoutStatus: 'blocked', cutoutLocalUri: 'file:///processed.png' });
  const reopened = createWardrobePersistence(d.storage, null);
  expect((await reopened.load('alice')).wardrobeItems[0]).toMatchObject({ cutoutStatus: 'blocked', cutoutLocalUri: 'file:///processed.png' });
  expect([...d.disk.values()].filter(value => value.includes('pending')).join('')).toContain('processed.png');
});


test('compares the previous full-sync cutout checkpoints with local-only checkpoints', async () => {
  const results: Record<string, number[]> = {};
  for (const mode of ['before', 'after']) {
    const cloud = fakeCloud();
    const authenticate = jest.fn(cloud.port.authenticate), snapshot = jest.fn(cloud.port.snapshot), apply = jest.fn(cloud.port.apply);
    const d = device({ ...cloud.port, authenticate, snapshot, apply });
    let data = await d.service.save('alice', { wardrobeItems: [{ ...item, cutoutStatus: 'pending' }], savedOutfits: [] });
    const patches = [{ cutoutStatus: 'blocked' as const }, { cutoutLocalUri: 'file:///processed.png' }, { cutoutStatus: 'ready' as const, cutoutUrl: 'https://images.example/cutout.png' }];
    for (const patch of patches) {
      if (mode === 'before') data = await d.service.save('alice', { ...data, wardrobeItems: data.wardrobeItems.map(row => ({ ...row, ...patch })) });
      else await d.service.patchCutout('alice', item.id, item.imageUrl, patch);
    }
    results[mode] = [authenticate.mock.calls.length, snapshot.mock.calls.length, apply.mock.calls.length];
  }
  expect(results).toEqual({ before: [5, 5, 1], after: [2, 2, 1] });
});

describe('subcategory and color cloud sync', () => {
  const styled = { ...item, subcategory: 'gomlek', color: 'siyah' };
  // Simulates the live RPCs before the style-fields migration: unknown keys ignored, never returned.
  function oldServer(cloud: ReturnType<typeof fakeCloud>, nulls = false): WardrobeCloudPort {
    return { ...cloud.port,
      apply: async (user, op) => {
        const value = op.value && op.kind === 'item' ? (({ subcategory: _s, color: _c, ...rest }) => rest)(op.value as WardrobeItem) : op.value;
        return cloud.port.apply(user, { ...op, value: value as WardrobeItem | null });
      },
      snapshot: async user => {
        const remote = await cloud.port.snapshot(user);
        return nulls ? { ...remote, items: remote.items.map(row => ({ ...row, subcategory: null, color: null }) as unknown as typeof row) } : remote;
      } };
  }

  test('writes both fields and another device reads them back', async () => {
    const cloud = fakeCloud(), a = device(cloud.port), b = device(cloud.port);
    await a.service.save('alice', { wardrobeItems: [styled], savedOutfits: [] });
    expect(cloud.snapshot('alice').items[0]).toMatchObject({ subcategory: 'gomlek', color: 'siyah' });
    expect((await b.service.load('alice')).wardrobeItems[0]).toMatchObject({ subcategory: 'gomlek', color: 'siyah' });
  });

  test('a color-only or subtype-only edit is a change that reaches the cloud', async () => {
    const cloud = fakeCloud(), d = device(cloud.port);
    const first = await d.service.save('alice', { wardrobeItems: [styled], savedOutfits: [] });
    await d.service.save('alice', { ...first, wardrobeItems: [{ ...first.wardrobeItems[0], color: 'mavi' }] });
    expect(cloud.snapshot('alice').items[0].color).toBe('mavi');
    const second = await d.service.load('alice');
    await d.service.save('alice', { ...second, wardrobeItems: [{ ...second.wardrobeItems[0], subcategory: 'polo' }] });
    expect(cloud.snapshot('alice').items[0].subcategory).toBe('polo');
  });

  test('off-palette color and wrong-category subtype are not sent, but stay local', async () => {
    const cloud = fakeCloud(), d = device(cloud.port);
    const result = await d.service.save('alice', { wardrobeItems: [{ ...item, subcategory: 'jean', color: 'neon' }], savedOutfits: [] });
    expect(cloud.snapshot('alice').items[0]).not.toHaveProperty('color');
    expect(cloud.snapshot('alice').items[0]).not.toHaveProperty('subcategory');
    expect(result.wardrobeItems[0]).toMatchObject({ subcategory: 'jean', color: 'neon' });
    expect(result.wardrobeSync?.state).toBe('synced');
  });

  test('old items without the fields still sync and load unchanged', async () => {
    const cloud = fakeCloud(), a = device(cloud.port), b = device(cloud.port);
    await a.service.save('alice', { wardrobeItems: [item], savedOutfits: [] });
    const loaded = (await b.service.load('alice')).wardrobeItems[0];
    const { id: _id, ...rest } = item; expect(loaded).toMatchObject(rest); expect(loaded).not.toHaveProperty('color'); expect(loaded).not.toHaveProperty('subcategory');
  });

  test.each([false, true])('pre-migration server (null fields: %s) never erases local values', async nulls => {
    const cloud = fakeCloud(), d = device(oldServer(cloud, nulls));
    await d.service.save('alice', { wardrobeItems: [styled], savedOutfits: [] });
    const result = await d.service.load('alice');
    expect(result.wardrobeItems[0]).toMatchObject({ subcategory: 'gomlek', color: 'siyah' });
    expect(result.wardrobeSync?.state).toBe('synced');
  });

  test('malformed style fields in a snapshot are dropped instead of failing the sync', async () => {
    const cloud = fakeCloud(), d = device(cloud.port);
    await d.service.save('alice', { wardrobeItems: [styled], savedOutfits: [] });
    cloud.records.get('alice')!.items[0] = { ...cloud.snapshot('alice').items[0], color: 42, subcategory: 'x'.repeat(41) } as never;
    const result = await createWardrobePersistence(d.storage, cloud.port).load('alice');
    expect(result.wardrobeSync?.state).toBe('synced');
    expect(result.wardrobeItems[0]).toMatchObject({ subcategory: 'gomlek', color: 'siyah' });
  });

  test('migration keeps live bodies, adds key-preserving fields and checks its contracts', () => {
    const sql = readFileSync('supabase/migrations/202610270001_wardrobe_style_fields_sync.sql', 'utf8');
    expect(sql).toMatch(/^begin;/m); expect(sql).toMatch(/^commit;/m);
    expect(sql.match(/create or replace function public\.wardrobe_apply_change\(/g)).toHaveLength(1);
    expect(sql.match(/create or replace function public\.wardrobe_cloud_snapshot\(/g)).toHaveLength(1);
    expect(sql).not.toMatch(/security\s+definer/i);
    expect(sql).toContain("p_value ? 'subcategory'"); expect(sql).toContain("p_value ? 'color'");
    expect(sql).toContain('^[a-z0-9_]{1,40}$');
    for (const check of ['WARDROBE_STYLE_FIELDS_FENCE', 'WARDROBE_STYLE_FIELDS_ACL', 'WARDROBE_STYLE_FIELDS_V2_WRAPPER',
      'WARDROBE_STYLE_FIELDS_SECURITY', 'WARDROBE_STYLE_FIELDS_COLUMNS', 'WARDROBE_STYLE_FIELDS_SOURCE']) expect(sql).toContain(check);
    expect(sql).not.toMatch(/\b(drop|alter)\s+(table|function|trigger)\b/i);
    expect(sql).not.toMatch(/^\s*(grant|revoke)\b/im);
  });
});

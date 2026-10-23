import { wardrobeOriginalIdentity, type WardrobeCutoutPatch } from '../lib/wardrobeCutoutState';
import { measureWardrobeStage, notifyWardrobeStage, recordWardrobeSyncDiagnostic, type WardrobeProgress, type WardrobeSyncPhase } from '../lib/wardrobeProgress';
// Persistence helper for the EXISTING wardrobe service, not an independent API.
import type { WardrobeItem, SavedOutfit, WardrobeItemConfirmation } from '../types/wardrobe';
import { validWardrobeOriginalPath } from '../types/wardrobe';
import { isGarmentCategory } from '../types/product';
export interface WardrobeSync { state: 'synced' | 'pending' | 'conflict'; pending: number; message?: string }
export interface WardrobeData { wardrobeItems: WardrobeItem[]; savedOutfits: SavedOutfit[]; wardrobeSync?: WardrobeSync; wardrobeConfirmedItems?: Record<string, WardrobeItemConfirmation>; wardrobeCutoutV2Available?: boolean; wardrobeCutoutV2Ready?: boolean }
export interface CloudItem extends WardrobeItem { updatedAt: string }
export interface CloudOutfit extends SavedOutfit { updatedAt: string }
export interface CloudSnapshot { items: CloudItem[]; outfits: CloudOutfit[]; photoVersion?: number; cutoutVersion?: 2; cutoutReady?: boolean }
type Value = WardrobeItem | SavedOutfit;
export interface WardrobeMutation { kind: 'item' | 'outfit'; id: string; expected: string | null; value: Value | null }
export interface WardrobeCloudPort {
  authenticate(user: string): Promise<void>;
  snapshot(user: string): Promise<CloudSnapshot>;
  apply(user: string, mutation: WardrobeMutation): Promise<'applied' | 'conflict'>;
  photoPath?(owner: string, itemId: string): string;
  uploadPhoto?(owner: string, path: string, localUri: string, onStage?: WardrobeProgress): Promise<void>;
}
interface Storage { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> }
interface Pending extends WardrobeMutation { localId: string; before?: Value; dispatched: boolean; conflict?: boolean; history?: Value[]; photo?: { path: string; source: string; uploaded: boolean } }
interface Journal { version: 1; owner?: string; ids: Record<string, string>; base: CloudSnapshot; cache: WardrobeData; pending: Pending[]; externalBackups?: string[]; externalConflict?: boolean }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
// These describe a read-only status check for this photo, never an upload result.
// Auth, fence, transport ambiguity, malformed journal/protocol and checkpoint
// failures are deliberately not operation-local and must still stop replay.
function photoReconciliationPending(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return error.code === 'WARDROBE_STORAGE_UNKNOWN' ||
    (error.code === 'STORAGE_RECONCILIATION_UNAVAILABLE' &&
      'diagnosticTransport' in error && error.diagnosticTransport === 'http' &&
      'diagnosticHttpStatus' in error && error.diagnosticHttpStatus === 404);
}
// Deterministic name UUID (SHA-1, UUID v5 layout). Identity, not a credential.
// Same owner/kind/legacy ID on two devices must not create two cloud rows.
const mappedId = (owner: string, kind: string, id: string): string => {
  const input = Array.from(new TextEncoder().encode(JSON.stringify(['vitrify.wardrobe', owner, kind, id])));
  const size = input.length * 8; input.push(128); while (input.length % 64 !== 56) input.push(0);
  input.push(0,0,0,0,(size>>>24)&255,(size>>>16)&255,(size>>>8)&255,size&255);
  const state = [0x67452301,0xefcdab89,0x98badcfe,0x10325476,0xc3d2e1f0];
  const rotate = (value: number, bits: number) => (value << bits) | (value >>> (32-bits));
  for (let offset=0;offset<input.length;offset+=64) {
    const words = Array<number>(80).fill(0);
    for(let i=0;i<16;i++) words[i]=(input[offset+i*4]<<24)|(input[offset+i*4+1]<<16)|(input[offset+i*4+2]<<8)|input[offset+i*4+3];
    for(let i=16;i<80;i++) words[i]=rotate(words[i-3]^words[i-8]^words[i-14]^words[i-16],1);
    let [a,b,c,d,e]=state;
    for(let i=0;i<80;i++) {
      const f=i<20?(b&c)|(~b&d):i<40?b^c^d:i<60?(b&c)|(b&d)|(c&d):b^c^d;
      const k=i<20?0x5a827999:i<40?0x6ed9eba1:i<60?0x8f1bbcdc:0xca62c1d6;
      const temp=(rotate(a,5)+f+e+k+words[i])|0; e=d;d=c;c=rotate(b,30);b=a;a=temp;
    }
    for(const [i,value] of [a,b,c,d,e].entries()) state[i]=(state[i]+value)|0;
  }
  const bytes=state.flatMap(value=>[(value>>>24)&255,(value>>>16)&255,(value>>>8)&255,value&255]).slice(0,16);
  bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
  const hex=bytes.map(value=>value.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};
const key = (owner: string) => `vitrify.wardrobe.v1.${encodeURIComponent(owner)}`;
const syncKey = (owner: string) => `vitrify.wardrobe.sync.v1.${encodeURIComponent(owner)}`;
const remoteImage = (value?: string) => {
  try { const url = new URL(value ?? ''); return url.protocol === 'https:' && !url.username && !url.password && !url.pathname.includes('/object/sign/'); }
  catch { return false; }
};
const fields = (kind: Pending['kind'], value: Value) => kind === 'item'
  ? { title: value.title, imageUrl: (value as WardrobeItem).imageStoragePath ?? (value as WardrobeItem).imageUrl, category: (value as WardrobeItem).category, brand: (value as WardrobeItem).brand }
  : { title: value.title, wardrobeItemIds: (value as SavedOutfit).wardrobeItemIds, catalogProductIds: (value as SavedOutfit).catalogProductIds,
      imageUrl: remoteImage(value.imageUrl) ? value.imageUrl : undefined };
const same = (kind: Pending['kind'], left: Value, right: Value) => JSON.stringify(fields(kind, left)) === JSON.stringify(fields(kind, right));
const validateData = (data: WardrobeData) => {
  if (!data || !Array.isArray(data.wardrobeItems) || !Array.isArray(data.savedOutfits) ||
    data.wardrobeItems.some(item => !item || typeof item.id !== 'string' || !item.id || typeof item.title !== 'string' || typeof item.imageUrl !== 'string' || typeof item.brand !== 'string' || typeof item.createdAt !== 'string' || !isGarmentCategory(item.category)) ||
    data.savedOutfits.some(item => !item || typeof item.id !== 'string' || !item.id || typeof item.title !== 'string' || typeof item.createdAt !== 'string' || !Array.isArray(item.wardrobeItemIds) || !item.wardrobeItemIds.every(id=>typeof id==='string') || !Array.isArray(item.catalogProductIds) || !item.catalogProductIds.every(id=>typeof id==='string'))) throw new Error('Dolap kayıtları okunamadı.');
};
const validateSnapshot = (snapshot: CloudSnapshot, owner: string) => {
  if (!snapshot || !Array.isArray(snapshot.items) || !Array.isArray(snapshot.outfits) || snapshot.items.length>1000 || snapshot.outfits.length>1000) throw new Error('Bulut envanteri okunamadı.');
  validateData({ wardrobeItems: snapshot.items, savedOutfits: snapshot.outfits });
  for (const rows of [snapshot.items,snapshot.outfits]) {
    if (new Set(rows.map(row=>row.id)).size!==rows.length || rows.some(row=>!uuid.test(row.id)||typeof row.updatedAt!=='string'||!row.updatedAt)) throw new Error('Bulut sürümü doğrulanamadı.');
  }
  if (snapshot.items.some(row=>row.imageStoragePath ? !validWardrobeOriginalPath(owner,row.imageStoragePath) || row.imageStoragePath.split('/')[1] !== row.id : !remoteImage(row.imageUrl)) || snapshot.outfits.some(row=>row.wardrobeItemIds.some(id=>!snapshot.items.some(item=>item.id===id)))) throw new Error('Bulut referansı doğrulanamadı.');
};
export function createWardrobePersistence(storage: Storage, cloud: WardrobeCloudPort | null) {
  const queues = new Map<string, Promise<unknown>>();
  const serial = <T>(owner: string, work: () => Promise<T>): Promise<T> => {
    const result = (queues.get(owner) ?? Promise.resolve()).catch(() => {}).then(work);
    queues.set(owner, result); void result.finally(() => { if (queues.get(owner) === result) queues.delete(owner); }).catch(() => {});
    return result;
  };
  const persist = async (owner: string, journal: Journal, onStage?: WardrobeProgress) => measureWardrobeStage('checkpoint', async () => {
    const value = JSON.stringify(journal); await storage.setItem(syncKey(owner), value);
    if (await storage.getItem(syncKey(owner)) !== value) throw new Error('Dolap pending checkpoint doğrulanamadı.');
    const cache = JSON.stringify(journal.cache); await storage.setItem(key(owner), cache);
    if (await storage.getItem(key(owner)) !== cache) throw new Error('Dolap checkpoint doğrulanamadı.');
  }, onStage);
  const idFor = (j: Journal, kind: Pending['kind'], id: string) => j.ids[`${kind}:${id}`] ??= uuid.test(id) ? id : mappedId(j.owner ?? '', kind, id);
  const read = async (owner: string): Promise<Journal> => {
    if (!owner.trim()) throw new Error('Dolap için kullanıcı gerekli.');
    const rawJournal = await storage.getItem(syncKey(owner));
    if (rawJournal) {
      const j = JSON.parse(rawJournal) as Journal;
      if (j.version !== 1 || !Array.isArray(j.pending) || !j.ids || !Array.isArray(j.base?.items) || !Array.isArray(j.base?.outfits) || !Array.isArray(j.cache?.wardrobeItems) || !Array.isArray(j.cache?.savedOutfits)) throw new Error('Dolap senkronizasyon kaydı okunamadı.');
      j.owner=owner; validateData(j.cache);
      const rawCache = await storage.getItem(key(owner));
      if (rawCache && rawCache!==JSON.stringify(j.cache)) {
        const external=JSON.parse(rawCache) as WardrobeData; validateData(external);
        // Old clients may still write the v1 key. Preserve exact bytes and
        // import additions; absence is NOT evidence of an intentional delete.
        j.externalBackups ??=[]; if(!j.externalBackups.includes(rawCache)) j.externalBackups.push(rawCache);
        for(const [kind,values,rows] of [['item',external.wardrobeItems,j.cache.wardrobeItems],['outfit',external.savedOutfits,j.cache.savedOutfits]] as const) for(const value of values) {
          const old=rows.find(row=>row.id===value.id);
          if(!old) {
            const previouslyMapped=!!j.ids[`${kind}:${value.id}`];
            rows.push(clone(value) as WardrobeItem & SavedOutfit);
            j.pending.push({kind,id:idFor(j,kind,value.id),localId:value.id,expected:null,value:clone(value),dispatched:false,...(previouslyMapped?{conflict:true}:{})});
          } else if(!same(kind,old,value)) j.externalConflict=true;
          else Object.assign(old,{...value,...old});
        }
        await persist(owner,j);
      }
      return j;
    }
    const raw = await storage.getItem(key(owner));
    const data: WardrobeData = raw ? JSON.parse(raw) : { wardrobeItems: [], savedOutfits: [] };
    validateData(data);
    // Exact legacy bytes are retained before any projection/mapping replaces them.
    if (raw && await storage.getItem(`${syncKey(owner)}.legacy`) === null) await storage.setItem(`${syncKey(owner)}.legacy`, raw);
    const j: Journal = { version: 1, owner, ids: {}, base: { items: [], outfits: [] }, cache: clone(data), pending: [] };
    for (const [kind, values] of [['item', data.wardrobeItems], ['outfit', data.savedOutfits]] as const)
      for (const value of values) j.pending.push({ kind, id: idFor(j, kind, value.id), localId: value.id, expected: null, value: clone(value), dispatched: false });
    await persist(owner, j); return j;
  };
  const payload = (j: Journal, op: Pending, snapshot: CloudSnapshot): Value | null | 'media' | 'references' => {
    if (op.value === null) return null;
    if (op.kind === 'item') {
      const value = op.value as WardrobeItem;
      if (value.imageStoragePath && !validWardrobeOriginalPath(j.owner ?? '', value.imageStoragePath)) throw new Error('Fotoğraf sahibi doğrulanamadı.');
      if (!value.imageStoragePath && !remoteImage(value.imageUrl)) return 'media';
      if (op.expected===null && value.cutoutProtocol===2 && snapshot.cutoutVersion!==2) return 'media';
      return { id: op.id, title: value.title, category: value.category, brand: value.brand,
        imageUrl: value.imageStoragePath ? '' : value.imageUrl, createdAt: value.createdAt,
        ...(value.imageStoragePath ? { imageStoragePath: value.imageStoragePath } : {}),
        ...(op.expected===null && value.cutoutProtocol===2 ? {cutoutProtocol:2} : {}) };
    }
    const value = op.value as SavedOutfit;
    const refs = value.wardrobeItemIds.map(id => idFor(j, 'item', id));
    if (refs.some(id => !snapshot.items.some(row => row.id === id))) return 'references';
    return { id: op.id, title: value.title, createdAt: value.createdAt, wardrobeItemIds: refs, catalogProductIds: value.catalogProductIds,
      ...(remoteImage(value.imageUrl) ? { imageUrl: value.imageUrl } : {}) };
  };
  const project = (j: Journal, remote: CloudSnapshot) => {
    const localId = (kind: Pending['kind'], id: string) => Object.keys(j.ids).find(key => key.startsWith(kind + ':') && j.ids[key] === id)?.slice(kind.length + 1) ?? id;
    const local = new Map(j.cache.wardrobeItems.map(item => [item.id, item]));
    const localOutfits = new Map(j.cache.savedOutfits.map(item=>[item.id,item]));
    const data: WardrobeData = {
      wardrobeItems: remote.items.map(({ updatedAt: _version, ...item }) => {
        const id = localId('item', item.id), prior = local.get(id);
        const sameOriginal=!prior || (prior.imageStoragePath ?? prior.imageUrl)===(item.imageStoragePath ?? item.imageUrl);
        // Drop OLD photo metadata before merging the new authoritative result.
        const merged = { ...(sameOriginal?prior:undefined), ...item, id };
        if(remote.cutoutVersion===2 && item.cutoutProtocol!==2 && prior?.cutoutProtocol===2){
          delete merged.cutoutProtocol;delete merged.cutoutResult;delete merged.originalVersion;
          delete merged.cutoutUrl;delete merged.cutoutLocalUri;delete merged.cutoutStoragePath;delete merged.cutoutUrlExpiresAt;
          merged.cutoutStatus='blocked'; // never downgrade an old V2 request into V1 inference
        }
        return merged;
      }),
      savedOutfits: remote.outfits.map(({ updatedAt: _version, ...outfit }) => ({ ...outfit, id: localId('outfit', outfit.id), imageUrl: outfit.imageUrl ?? localOutfits.get(localId('outfit',outfit.id))?.imageUrl, wardrobeItemIds: outfit.wardrobeItemIds.map(id => localId('item', id)) })),
    };
    for (const op of j.pending) {
      if (op.conflict) continue; // cloud projection wins; full local value stays in journal.
      const rows = op.kind === 'item' ? data.wardrobeItems : data.savedOutfits;
      const index = rows.findIndex(row => row.id === op.localId);
      if (index >= 0) rows.splice(index, 1);
      if (op.value) rows.push(clone(op.value) as WardrobeItem & SavedOutfit);
    }
    return data;
  };
  const status = (j: Journal) => {
    const conflict = j.externalConflict || j.pending.some(op => op.conflict);
    j.cache.wardrobeSync = { state: conflict ? 'conflict' : j.pending.length || !cloud ? 'pending' : 'synced', pending: j.pending.length,
      ...(conflict ? { message: 'Bulutla çakışma var. Yerel veri ve bekleyen işlem korundu; otomatik üzerine yazılmadı.' } :
        j.pending.length ? { message: 'Değişiklikler cihazda korundu; bulut senkronizasyonu bekliyor. Yerel fotoğraf yüklemesi A1_DEPENDENCY olabilir.' } : {}) };
  };
  const confirmItems = (owner: string, j: Journal, snapshot?: CloudSnapshot) => {
    const confirmed: Record<string, WardrobeItemConfirmation> = {};
    if (snapshot) for (const item of j.cache.wardrobeItems) {
      const id = j.ids[`item:${item.id}`] ?? item.id;
      const row = snapshot.items.find(value => value.id === id);
      if (!row || j.pending.some(op => op.kind === 'item' && (op.id === id || op.localId === item.id)) || !same('item', item, row)) continue;
      confirmed[item.id] = { owner, cloudItemId: id, originalPath: wardrobeOriginalIdentity(row),
        ...(snapshot.cutoutVersion === 2 && row.cutoutProtocol === 2 ? { cutoutProtocol: 2, originalVersion: row.originalVersion } : {}) };
    }
    // Authorization is derived ONLY from this invocation's authenticated snapshot,
    // never from a persisted cache/map or a global synced/pending count.
    j.cache.wardrobeConfirmedItems = confirmed;
    j.cache.wardrobeCutoutV2Available=snapshot?.cutoutVersion===2;
    j.cache.wardrobeCutoutV2Ready=snapshot?.cutoutVersion===2 && snapshot.cutoutReady===true;
  };
  const reconcile = async (owner: string, j: Journal, onStage?: WardrobeProgress): Promise<WardrobeData> => {
    if (!cloud) { recordWardrobeSyncDiagnostic('configuration', 'CONFIG_MISSING'); confirmItems(owner,j); status(j); await persist(owner, j, onStage); return clone(j.cache); }
    let phase: WardrobeSyncPhase = 'authenticate';
    let confirmedSnapshot: CloudSnapshot | undefined;
    try {
      await measureWardrobeStage('authenticate', () => cloud.authenticate(owner), onStage);
      phase = 'snapshot';
      let remote = await measureWardrobeStage('snapshot', () => cloud.snapshot(owner), onStage);
      validateSnapshot(remote, owner);
      confirmedSnapshot = remote;
      const operations = [...j.pending].sort((a, b) => Number(a.kind === 'outfit') - Number(b.kind === 'outfit'));
      const blockedItems = new Set<string>(), blockedLocalItems = new Set<string>();
      for (const op of operations) {
        if (op.conflict) continue;
        if (op.kind === 'item' && blockedItems.has(op.id)) continue;
        if (op.kind === 'outfit') {
          // Existing cloud references matter too: a pending replacement may
          // still have an older row in the snapshot. Do not mutate its relations.
          const localRefs = [op.value, op.before].flatMap(value => (value as SavedOutfit | undefined | null)?.wardrobeItemIds ?? []);
          const cloudRefs = remote.outfits.find(row => row.id === op.id)?.wardrobeItemIds ?? [];
          if (localRefs.some(id => blockedLocalItems.has(id)) || cloudRefs.some(id => blockedItems.has(id))) continue;
        }
        if (op.kind === 'item' && op.value && !remoteImage(op.value.imageUrl) && !(op.value as WardrobeItem).imageStoragePath && remote.photoVersion === 1 && cloud.photoPath && cloud.uploadPhoto) {
          const current = remote.items.find(row => row.id === op.id);
          if ((op.expected === null && current) || (op.expected !== null && (!current || current.updatedAt !== op.expected))) {
            op.conflict = true; await persist(owner, j, onStage); continue;
          }
          // Assign and checkpoint the immutable path before any possible upload.
          // A failed/UNKNOWN upload never gets a fresh version path on reopen.
          op.photo ??= { path: cloud.photoPath(owner, op.id), source: op.value.imageUrl!, uploaded: false };
          if (!validWardrobeOriginalPath(owner, op.photo.path) || op.photo.path.split('/')[1] !== op.id) throw new Error('Fotoğraf yolu doğrulanamadı.');
          await persist(owner, j, onStage); phase = 'authenticate'; await measureWardrobeStage('authenticate', () => cloud.authenticate(owner), onStage);
          phase = 'upload';
          try { await cloud.uploadPhoto(owner, op.photo.path, op.photo.source, onStage); }
          catch (error) {
            if (!photoReconciliationPending(error)) throw error;
            // Keep this exact operation/path and its Storage request untouched.
            // Only different rows may advance, with their original expected
            // versions, normal auth/fence boundaries and journal checkpoints.
            blockedItems.add(op.id); blockedLocalItems.add(op.localId);
            recordWardrobeSyncDiagnostic('upload', 'STORAGE_UNKNOWN');
            continue;
          }
          phase = 'authenticate';
          await measureWardrobeStage('authenticate', () => cloud.authenticate(owner), onStage);
          op.photo.uploaded = true;
          Object.assign(op.value, { imageStoragePath: op.photo.path, imageLocalUri: op.photo.source });
          const cached = j.cache.wardrobeItems.find(row => row.id === op.localId);
          if (cached) Object.assign(cached, { imageStoragePath: op.photo.path, imageLocalUri: op.photo.source });
          await persist(owner, j, onStage);
        }
        const value = payload(j, op, remote);
        if (value === 'media') {
          recordWardrobeSyncDiagnostic('media', remote.photoVersion !== 1 ? 'PHOTO_CONTRACT_UNAVAILABLE' : 'MEDIA_PENDING');
          continue;
        }
        if (value === 'references') {
          // A referenced local photo may still be pending; keep dependent outfit.
          const refs = (op.value as SavedOutfit).wardrobeItemIds;
          if (!refs.some(id => j.pending.some(p => p.kind === 'item' && p.localId === id && !p.conflict))) op.conflict = true;
          continue;
        }
        const row = (op.kind === 'item' ? remote.items : remote.outfits).find(row => row.id === op.id);
        const v2Create=op.kind==='item' && op.expected===null && (op.value as WardrobeItem | null)?.cutoutProtocol===2;
        if ((value === null && !row) || (value !== null && row && same(op.kind, value, row) && (!v2Create || (row as WardrobeItem).cutoutProtocol===2))) {
          j.pending = j.pending.filter(p => p !== op); await persist(owner, j, onStage); continue;
        }
        if ((op.expected === null && (row || op.dispatched)) || (op.expected !== null && (!row || row.updatedAt !== op.expected))) {
          op.conflict = true; await persist(owner, j, onStage); continue;
        }
        // Auth failure here proves no apply was dispatched. Do not poison safe
        // retry with a dispatched marker before this preflight succeeds.
        phase = 'authenticate';
        await measureWardrobeStage('authenticate', () => cloud.authenticate(owner), onStage);
        // Journal before dispatch. A lost create ack + later remote delete must
        // never be retried as a fresh INSERT. It remains an explicit conflict.
        op.dispatched = true; await persist(owner, j, onStage);
        phase = 'database';
        const result = await measureWardrobeStage('database', () => cloud.apply(owner, { kind: op.kind, id: op.id, expected: op.expected, value }), onStage);
        if (result === 'conflict') op.conflict = true;
        else if (result === 'applied') j.pending = j.pending.filter(p => p !== op);
        else throw new Error('Bulut sonucu doğrulanamadı.');
        await persist(owner, j, onStage);
        phase = 'snapshot';
        remote = await measureWardrobeStage('snapshot', () => cloud.snapshot(owner), onStage);
        validateSnapshot(remote, owner);
        confirmedSnapshot = remote;
      }
      // Always pull authoritative data; never replace the cloud with a whole cache.
      j.cache = project(j, remote); j.base = clone(remote);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      recordWardrobeSyncDiagnostic(phase,
        code === 'WARDROBE_RPC_MISSING' ? 'RPC_MISSING' : code === 'WARDROBE_RPC_FAILED' ? 'RPC_FAILED' :
          typeof code === 'string' && ['WARDROBE_STORAGE_UNKNOWN', 'STORAGE_UPLOAD_UNRESOLVED', 'STORAGE_UPLOAD_UNCONFIRMED'].includes(code) ? 'STORAGE_UNKNOWN' : 'UNVERIFIED');
      // Transport/schema/auth failure is not an empty cloud or deletion instruction.
      j.cache.wardrobeSync = { state: 'pending', pending: j.pending.length, message: 'Bulut doğrulanamadı. Mevcut kayıtlar cihazda korundu.' };
      confirmItems(owner, j, confirmedSnapshot);
      await persist(owner, j, onStage); return clone(j.cache);
    }
    confirmItems(owner,j,confirmedSnapshot); status(j); await persist(owner, j, onStage); return clone(j.cache);
  };
  return {
    // Cutout metadata is device-local in the current cloud contract. Checkpoint
    // it in the SAME serialized journal without replaying unrelated cloud writes.
    patchCutout: (owner: string, id: string, original: string, patch: WardrobeCutoutPatch) => serial(owner, async () => {
      const allowed = ['cutoutStatus', 'cutoutLocalUri', 'cutoutUrl', 'cutoutStoragePath', 'cutoutUrlExpiresAt'];
      if (Object.keys(patch).some(key => !allowed.includes(key))) throw new Error('Geçersiz cutout checkpoint alanı.');
      const j = await read(owner);
      const item = j.cache.wardrobeItems.find(row => row.id === id);
      if (!item || wardrobeOriginalIdentity(item) !== original) return false;
      Object.assign(item, patch);
      for (const op of j.pending) {
        if (op.kind === 'item' && op.localId === id && op.value && wardrobeOriginalIdentity(op.value as WardrobeItem) === original)
          Object.assign(op.value, patch);
      }
      await persist(owner, j);
      return true;
    }),
    load: (owner: string) => serial(owner, async () => reconcile(owner, await read(owner))),
    save: (owner: string, desired: WardrobeData, onStage?: WardrobeProgress) => serial(owner, async () => {
      notifyWardrobeStage('checkpoint', onStage);
      const j = await read(owner), data = clone(desired);
      validateData(data);
      for (const next of data.wardrobeItems) {
        const prior = j.cache.wardrobeItems.find(row => row.id === next.id);
        if (prior?.imageStoragePath && next.imageUrl !== prior.imageUrl) {
          delete next.imageStoragePath; delete next.imageUrlExpiresAt; delete next.imageLocalUri;
        }
      }
      const removed = new Set(j.cache.wardrobeItems.filter(old => !data.wardrobeItems.some(item => item.id === old.id)).map(item => item.id));
      data.savedOutfits = data.savedOutfits.map(outfit => ({ ...outfit, wardrobeItemIds: outfit.wardrobeItemIds.filter(id => !removed.has(id)) }));
      for (const [kind, before, after] of [['item', j.cache.wardrobeItems, data.wardrobeItems], ['outfit', j.cache.savedOutfits, data.savedOutfits]] as const) {
        const all = new Set([...before, ...after].map(value => value.id));
        for (const localId of all) {
          const prior = before.find(value => value.id === localId), next = after.find(value => value.id === localId);
          if (prior && next && same(kind, prior, next)) continue;
          const pending = j.pending.find(op => op.kind === kind && op.localId === localId);
          if (pending && !pending.dispatched && !pending.conflict) {
            if (!next && pending.expected === null) j.pending = j.pending.filter(op => op !== pending);
            else pending.value = next ? clone(next) : null;
          } else {
            const id = idFor(j, kind, localId);
            const base = (kind === 'item' ? j.base.items : j.base.outfits).find(row => row.id === id);
            if (pending) j.pending = j.pending.filter(op => op !== pending);
            j.pending.push({ kind, id, localId, expected: base?.updatedAt ?? null, value: next ? clone(next) : null, before: prior ? clone(prior) : undefined,
              dispatched: false, ...(pending ? { conflict: true, history: [...(pending.history ?? []), ...(pending.value ? [clone(pending.value)] : [])] } : {}) });
          }
        }
      }
      j.cache = data; status(j); await persist(owner, j, onStage);
      return reconcile(owner, j, onStage);
    }),
  };
}

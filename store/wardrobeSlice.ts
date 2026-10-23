import { autoResumeWardrobeCutout, hasCutoutArtifact, resumableWardrobeCutout, wardrobeOriginalIdentity, type WardrobeCutoutJob, type WardrobeCutoutPatch } from '../lib/wardrobeCutoutState';
import { measureWardrobeStage, notifyWardrobeStage, recordWardrobeTiming, type WardrobeProgress, type WardrobeAddOptions } from '../lib/wardrobeProgress';
import { captureOwnerPublication, trackOwnerWork } from '../lib/accountDeviceWork';
import type { StateCreator } from 'zustand';
import { Alert } from 'react-native';
import type { WardrobeSync } from '../services/wardrobeCloudPersistence';
import {
  loadWardrobe,
  saveWardrobe,
  saveWardrobeCutoutCheckpoint,
  storeWardrobePhoto,
  type WardrobeData,
} from '../services/wardrobeService';
import {
  wardrobeImage,
  type WardrobeItem,
  type SavedOutfit,
} from '../types/wardrobe';
import {
  createWardrobeCutout,
  uploadWardrobeCutout,
  wardrobeCutoutConfigured,
} from '../services/wardrobeCutoutService';
import { recordWardrobeCutoutFailure } from '../lib/wardrobeNetworkDiagnostics';
import { createWardrobeResumeDiagnostic } from '../lib/wardrobeResumeDiagnostic';
import { createWardrobeV2Coordinator, WARDROBE_CUTOUT_V2_ENABLED, itemCutoutV2Confirmed } from '../services/wardrobeCutoutV2Integration';
import { cutoutV2ApiBackend } from '../services/wardrobeCutoutV2Api';
import { invokeWardrobeCutoutV2, wardrobeV2Artifacts, restoreWardrobeV2Result } from '../services/wardrobeCutoutV2Artifacts';
import type { WardrobeItemConfirmation } from '../types/wardrobe';
import { track } from '../lib/analytics';
import { createAnalyticsAction } from '../lib/analyticsAction';
import type { AppState } from './useAppStore';
import {
  selectedOutfitCandidate,
  type OutfitSelection,
} from '../lib/outfitSelection';

export interface WardrobeSlice {
  invalidateWardrobeWork: () => void;
  wardrobeCutoutJobs: Record<string, WardrobeCutoutJob>;
  resumeWardrobeCutouts: () => void;
  observeWardrobeCutoutV2Hint:(cloudId:string,originalVersion:string,jobId:string)=>void;
  wardrobeItems: WardrobeItem[];
  savedOutfits: SavedOutfit[];
  wardrobeSync?: WardrobeSync;
  wardrobeConfirmedItems?: Record<string,WardrobeItemConfirmation>;
  wardrobeCutoutV2Available?: boolean;
  wardrobeCutoutV2Ready?: boolean;
  wardrobeStatus: 'idle' | 'loading' | 'ready' | 'error';
  hydrateWardrobe: (userId: string) => Promise<void>;
  refreshWardrobe: () => Promise<void>;
  addWardrobeItem: (
    item: Pick<WardrobeItem, 'title' | 'imageUrl' | 'category' | 'brand'>,
    options?: WardrobeAddOptions,
  ) => Promise<void>;
  updateWardrobeItem: (
    id: string,
    patch: Pick<WardrobeItem, 'title' | 'category' | 'brand'>,
    onStage?: WardrobeProgress,
  ) => Promise<void>;
  removeWardrobeItem: (id: string) => Promise<void>;
  createOutfit: (selection: OutfitSelection) => Promise<void>;
}

export const createWardrobeSlice: StateCreator<
  AppState,
  [],
  [],
  WardrobeSlice
> = (set, get) => {
  let queue: Promise<void> = Promise.resolve();
  let cutoutQueue: Promise<void> = Promise.resolve();
  const cutoutTasks = new Map<string, Promise<void>>();
  const cutoutAttempts = new Map<string, number>();
  const cloudConfirmed = () => get().wardrobeSync?.state === 'synced' && get().wardrobeSync?.pending === 0;
  let generation = 0;
  const v2=createWardrobeV2Coordinator({
    enabled:WARDROBE_CUTOUT_V2_ENABLED,
    backendReady:()=>get().wardrobeCutoutV2Available===true,
    current:(owner,id)=>{
      const state=get(),item=state.wardrobeItems.find(i=>i.id===id);
      return state.sessionUserId===owner && state.wardrobeStatus==='ready' && item ? {item,confirmation:state.wardrobeConfirmedItems?.[id]}:undefined;
    },
    backend:(confirmed,owner)=>cutoutV2ApiBackend({enabled:WARDROBE_CUTOUT_V2_ENABLED,confirmed,
      canDispatch:()=>get().wardrobeCutoutV2Ready===true,
      invoke:(route,method,body)=>invokeWardrobeCutoutV2(owner,route,method,body)}),
    artifacts:wardrobeV2Artifacts(),
    restoreResult:restoreWardrobeV2Result,
    publish:async(owner,id,patch)=>{
      const version=generation, live=captureOwnerPublication(owner);
      const item=get().wardrobeItems.find(i=>i.id===id), original=item && wardrobeOriginalIdentity(item);
      const valid=()=>{
        const state=get(),now=state.wardrobeItems.find(i=>i.id===id);
        return !!now && !!original && live() && version===generation && state.sessionUserId===owner &&
          wardrobeOriginalIdentity(now)===original && itemCutoutV2Confirmed(owner,now,state.wardrobeConfirmedItems?.[id]);
      };
      const task=queue.then(async()=>{
        if(!valid())return;
        const written=await saveWardrobeCutoutCheckpoint(owner,id,original!,patch);
        if(written && valid())set(state=>({wardrobeItems:state.wardrobeItems.map(i=>i.id===id?{...i,...patch}:i)}));
      });
      queue=task.catch(()=>{});await trackOwnerWork(owner,task);
    },
  });
  const observeResume = createWardrobeResumeDiagnostic();
  const diagnoseResume = (): Promise<void> => {
    if (!__DEV__) return Promise.resolve();
    const state = get(), owner = state.sessionUserId, version = generation;
    if (!owner) return Promise.resolve();
    const current = captureOwnerPublication(owner);
    return observeResume({ owner, generation: version, wardrobeStatus: state.wardrobeStatus,
      wardrobeSync: state.wardrobeSync, wardrobeItems: state.wardrobeItems,
      cutoutEndpointConfigured: wardrobeCutoutConfigured(),
      current: () => current() && version === generation && get().sessionUserId === owner });
  };
  const mutate = (
    change: (data: WardrobeData, userId: string) => Promise<WardrobeData>,
    onSaved?: (saved: WardrobeData, owner: string) => void,
    onStage?: WardrobeProgress,
  ): Promise<void> => {
    const userId = get().sessionUserId;
    const version = generation;
    const current = captureOwnerPublication(userId);
    const queuedAt = __DEV__ ? performance.now() : 0;
    notifyWardrobeStage('queue', onStage);
    const task = queue.then(async () => {
      if (__DEV__) recordWardrobeTiming('queue', performance.now() - queuedAt);
      if (
        !current() || !userId ||
        version !== generation ||
        get().sessionUserId !== userId ||
        get().wardrobeStatus !== 'ready'
      ) {
        throw new Error('Dolabın yüklenmesini bekleyip tekrar dene.');
      }
      const data = await change(
        {
          wardrobeItems: get().wardrobeItems,
          savedOutfits: get().savedOutfits,
        },
        userId,
      );
      if (!current() || version !== generation || get().sessionUserId !== userId) {
        throw new Error('Oturum değişti. Kıyafeti yeniden eklemeyi dene.');
      }
      const saved = await saveWardrobe(userId, data, onStage);
      onSaved?.(saved, userId);
      if (current() && version === generation && get().sessionUserId === userId) {
        notifyWardrobeStage('ui', onStage);
        const uiAt = __DEV__ ? performance.now() : 0;
        set(saved);
        resumeCutouts();
        if (__DEV__) recordWardrobeTiming('ui', performance.now() - uiAt);
        if (saved.wardrobeSync?.state === 'conflict') Alert.alert('Dolap senkronizasyonu', saved.wardrobeSync.message);
      }
    });
    queue = task.catch(() => {});
    return userId ? trackOwnerWork(userId, task) : task;
  };
  const enqueueCutout = (userId: string, id: string, version: number): Promise<void> => {
    const taskKey = `${userId}:${id}:${version}`;
    const running = cutoutTasks.get(taskKey);
    if (running) return running;
    const current = captureOwnerPublication(userId);
    const existing = get().wardrobeItems.find(item => item.id === id);
    if (!cloudConfirmed() || !existing || !resumableWardrobeCutout(existing) ||
      (!hasCutoutArtifact(existing) && !wardrobeCutoutConfigured())) return Promise.resolve();
    const original = wardrobeOriginalIdentity(existing);
    const attemptKey = `${taskKey}:${original}:${existing.cutoutUrlExpiresAt ?? 0}`;
    if ((cutoutAttempts.get(attemptKey) ?? 0) >= 2) return Promise.resolve();
    const currentItem = (): WardrobeItem | undefined => {
      if (!current() || version !== generation || get().sessionUserId !== userId) return;
      const item = get().wardrobeItems.find(item => item.id === id);
      return item && wardrobeOriginalIdentity(item) === original ? item : undefined;
    };
    const job = (value?: WardrobeCutoutJob) => {
      if (!current() || version !== generation || get().sessionUserId !== userId) return;
      set(state => { const jobs = { ...state.wardrobeCutoutJobs }; if (value) jobs[id] = value; else delete jobs[id]; return { wardrobeCutoutJobs: jobs }; });
    };
    const persist = (patch: WardrobeCutoutPatch): Promise<void> => {
      const queuedAt = __DEV__ ? performance.now() : 0;
      const task = queue.then(() => measureWardrobeStage('cutoutCheckpoint', async () => {
        if (__DEV__) recordWardrobeTiming('cutoutCheckpointQueue', performance.now() - queuedAt);
        if (!currentItem()) throw new Error('Cutout kaydı veya oturumu değişti.');
        const written = await saveWardrobeCutoutCheckpoint(userId, id, original, patch);
        if (!written) throw new Error('Cutout fotoğraf sürümü değişti.');
        if (!currentItem()) return;
        set(state => ({ wardrobeItems: state.wardrobeItems.map(item => item.id === id ? { ...item, ...patch } : item) }));
      }));
      queue = task.catch(() => {});
      return trackOwnerWork(userId, task);
    };
    const queuedAt = __DEV__ ? performance.now() : 0;
    job('queued');
    const task = cutoutQueue.catch(() => {}).then(async () => {
      if (__DEV__) recordWardrobeTiming('cutoutQueue', performance.now() - queuedAt);
      let checkpointed = false;
      let recoverArtifact = false;
      try {
        let item = currentItem();
        if (!item || !cloudConfirmed()) return;
        cutoutAttempts.set(attemptKey, (cutoutAttempts.get(attemptKey) ?? 0) + 1);
        await persist({ cutoutStatus: 'blocked' });
        item = currentItem();
        if (!item || item.cutoutStatus !== 'blocked') return;
        checkpointed = true;
        if (!hasCutoutArtifact(item)) {
          job('processing');
          const cutoutLocalUri = await measureWardrobeStage('cutout', () => createWardrobeCutout(userId, item!));
          await persist({ cutoutLocalUri, cutoutStatus: 'blocked' });
        }
        item = currentItem();
        if (!item) return;
        job('uploading');
        const remote = await measureWardrobeStage('cutoutUpload', () => uploadWardrobeCutout(userId, item!));
        await persist({ ...remote, cutoutStatus: 'ready' });
      } catch (error) {
        recordWardrobeCutoutFailure('cutout', error);
        try { if (checkpointed && currentItem()) await persist({ cutoutStatus: 'blocked' }); } catch { /* Keep the durable pre-dispatch marker. */ }
        const item = currentItem();
        recoverArtifact = checkpointed && !!item && hasCutoutArtifact(item);
        if (currentItem()) throw new Error('Arka plan işlemi tamamlanamadı. Orijinal fotoğraf korundu.', { cause: error });
      } finally {
        cutoutTasks.delete(taskKey); job();
        // At most one automatic recovery after failure per photo/session. No timer
        // or polling; an existing PNG never re-enters the paid provider path.
        if (recoverArtifact && currentItem()) void enqueueCutout(userId, id, version).catch(() => {});
      }
    });
    cutoutQueue = trackOwnerWork(userId, task);
    cutoutTasks.set(taskKey, cutoutQueue);
    // Automatic recovery must not create unhandled rejections.
    void cutoutQueue.catch(() => {});
    return cutoutQueue;
  };
  const resumeCutouts = () => {
    if (__DEV__) void diagnoseResume();
    const owner = get().sessionUserId;
    if (!owner || get().wardrobeStatus !== 'ready') return;
    for (const item of get().wardrobeItems) {
      if(item.cutoutProtocol===2){void v2.resume(owner,item.id);continue;} // never fall back to V1
      if (autoResumeWardrobeCutout(item))void enqueueCutout(owner, item.id, generation).catch(() => {});
    }
  };
  return {
    observeWardrobeCutoutV2Hint:(cloudId,originalVersion,jobId)=>{
      const state=get(),owner=state.sessionUserId;if(!owner||!WARDROBE_CUTOUT_V2_ENABLED)return;
      for(const item of state.wardrobeItems){
        const c=state.wardrobeConfirmedItems?.[item.id];
        if(c?.cloudItemId!==cloudId||c.originalVersion!==originalVersion||!itemCutoutV2Confirmed(owner,item,c))continue;
        if(item.cutoutStatus==='ready' && (item.cutoutLocalUri||item.cutoutUrl) && item.cutoutStoragePath===`${owner}/${cloudId}/cutout-${jobId}.png`)continue;
        void v2.resume(owner,item.id,true);
      }
    },
    invalidateWardrobeWork: () => { generation++; v2.invalidate(); cutoutTasks.clear(); cutoutAttempts.clear(); cutoutQueue = Promise.resolve(); set({ wardrobeCutoutJobs: {},wardrobeConfirmedItems:undefined,wardrobeCutoutV2Available:false,wardrobeCutoutV2Ready:false }); },
    wardrobeCutoutJobs: {},
    resumeWardrobeCutouts: resumeCutouts,
    wardrobeItems: [],
    savedOutfits: [],
    wardrobeStatus: 'idle',
    refreshWardrobe: () => {
      const owner = get().sessionUserId;
      const version = generation;
      const current = captureOwnerPublication(owner);
      const valid = () => !!owner && current() && version === generation && get().sessionUserId === owner;
      // Use the existing mutation queue: a pull cannot replace an in-flight edit.
      // loadWardrobe reconciles the durable journal and never overwrites conflicts.
      const task = queue.then(async () => {
        if (!valid() || get().wardrobeStatus !== 'ready') return;
        try {
          const data = await loadWardrobe(owner!);
          if (valid()) { set(data); resumeCutouts(); }
        } catch {
          if (valid()) set({wardrobeConfirmedItems:{},wardrobeCutoutV2Available:false,wardrobeCutoutV2Ready:false, wardrobeSync: {
            state: 'pending', pending: get().wardrobeSync?.pending ?? 0,
            message: 'Bulut doğrulanamadı. Mevcut kayıtlar cihazda korundu.',
          } });
        }
      });
      queue = task.catch(() => {});
      return owner ? trackOwnerWork(owner, task) : task;
    },
    hydrateWardrobe: async (userId) => {
      v2.invalidate();
      const version = ++generation;
      const current = captureOwnerPublication(userId);
      set({ wardrobeItems: [], savedOutfits: [], wardrobeCutoutJobs: {}, wardrobeSync: undefined,wardrobeConfirmedItems:undefined,wardrobeCutoutV2Available:false,wardrobeCutoutV2Ready:false, wardrobeStatus: 'loading' });
      try {
        const data = await trackOwnerWork(userId, loadWardrobe(userId));
        if (current() && version === generation && get().sessionUserId === userId) {
          set({ ...data, wardrobeStatus: 'ready' });
          // Observe the pre-resume snapshot once, before a normal job can create
          // its own UNKNOWN intent. Reads only; no auth/network/replay is added.
          if (__DEV__) await diagnoseResume();
          if (!current() || version !== generation || get().sessionUserId !== userId) return;
          if (data.wardrobeSync?.state === 'conflict') Alert.alert('Dolap senkronizasyonu', data.wardrobeSync.message);
          resumeCutouts();
        }
      } catch {
        if (current() && version === generation && get().sessionUserId === userId) {
          set({ wardrobeStatus: 'error' });
          if (__DEV__) await diagnoseResume();
        }
      }
    },
    addWardrobeItem: async (input, options) => {
      const id = options?.requestId ?? `wardrobe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const userId = get().sessionUserId;
      const action = userId ? createAnalyticsAction(userId, 'wardrobe') : null;
      let created = false;
      await mutate(async (data, userId) => {
        const existing = data.wardrobeItems.find(item => item.id === id);
        if (existing) {
          if (existing.title !== input.title || existing.brand !== input.brand || existing.category !== input.category)
            throw new Error('Bu ekleme zaten kaydedildi. Değişiklikler için dolabındaki kıyafeti düzenle.');
          return data;
        }
        const imageUrl = await storeWardrobePhoto(userId, id, input.imageUrl, options?.onStage);
        const item = {
          ...input,
          imageUrl,
          id,
          createdAt: new Date().toISOString(),
          cutoutStatus: 'pending' as const,
          ...(WARDROBE_CUTOUT_V2_ENABLED && get().wardrobeCutoutV2Ready ? {cutoutProtocol:2 as const}:{}),
        };
        created = true;
        return { ...data, wardrobeItems: [...data.wardrobeItems, item] };
      }, (saved, owner) => {
        // Local offline/conflict persistence is not proof of a cloud commit.
        if (created && action && owner === action.userId && saved.wardrobeSync?.state === 'synced'
          && saved.wardrobeSync.pending === 0 && saved.wardrobeItems.some(item => item.id === id)) {
          track('dolap_add', id, { source: 'wardrobe' }, action);
        }
      }, options?.onStage);
    },
    updateWardrobeItem: (id, patch, onStage) =>
      mutate(async (data) => ({
        ...data,
        wardrobeItems: data.wardrobeItems.map((item) =>
          item.id === id ? { ...item, ...patch } : item,
        ),
      }), undefined, onStage),
    removeWardrobeItem: (id) =>
      mutate(async (data) => ({
        ...data,
        wardrobeItems: data.wardrobeItems.filter((item) => item.id !== id),
      })),
    createOutfit: (selection) =>
      mutate(async (data) => {
        const candidate = selectedOutfitCandidate(selection);
        const wardrobeItemIds = candidate.items
          .filter((item) => item.sourceType === 'wardrobe')
          .map((item) => item.sourceId);
        if (
          wardrobeItemIds.some(
            (id) => !data.wardrobeItems.some((item) => item.id === id),
          )
        ) {
          throw new Error(
            'Seçilen kıyafetlerden biri dolabından kaldırılmış. Yeniden seçmelisin.',
          );
        }
        const core = selection.dresses ?? selection.upper_body!;
        const outfit: SavedOutfit = {
          id: `outfit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          title: `Kombin ${data.savedOutfits.length + 1}`,
          imageUrl:
            core.source === 'wardrobe'
              ? wardrobeImage(core.item)
              : core.item.imageUrl,
          wardrobeItemIds,
          catalogProductIds: candidate.items
            .filter((item) => item.sourceType === 'catalog')
            .map((item) => item.sourceId),
          createdAt: new Date().toISOString(),
        };
        return { ...data, savedOutfits: [...data.savedOutfits, outfit] };
      }),
  };
};

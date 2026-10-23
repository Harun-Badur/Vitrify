import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WardrobeSync } from '../services/wardrobeCloudPersistence';
import type { WardrobeItem } from '../types/wardrobe';
import { hasCutoutArtifact, resumableWardrobeCutout } from './wardrobeCutoutState';

interface Observation {
  owner: string; generation: number; current(): boolean;
  wardrobeStatus: 'idle' | 'loading' | 'ready' | 'error';
  wardrobeSync?: WardrobeSync; wardrobeItems: readonly WardrobeItem[];
  cutoutEndpointConfigured: boolean;
}
interface JournalEvidence {
  version: number; owner: string; ids: Record<string, string>;
  base: { items: (WardrobeItem & { updatedAt: string })[] };
  pending: { kind: string; id: string; localId: string }[];
}
async function confirmedItems(input: Observation): Promise<{ count: number; unconfirmedResumable: boolean } | null> {
  try {
    const raw = await AsyncStorage.getItem(`vitrify.wardrobe.sync.v1.${encodeURIComponent(input.owner)}`);
    if (!raw) return null;
    const j = JSON.parse(raw) as JournalEvidence;
    if (j.version !== 1 || j.owner !== input.owner || !j.ids || !Array.isArray(j.base?.items) || !Array.isArray(j.pending)) return null;
    const confirmed = new Set(input.wardrobeItems.filter(item => {
      const id = j.ids[`item:${item.id}`] ?? item.id;
      const row = j.base.items.find(row => row.id === id);
      return !!row && typeof row.updatedAt === 'string' && !!row.updatedAt &&
        !j.pending.some(op => op.kind === 'item' && (op.id === id || op.localId === item.id)) &&
        (row.imageStoragePath ?? row.imageUrl) === (item.imageStoragePath ?? item.imageUrl) &&
        row.title === item.title && row.brand === item.brand && row.category === item.category;
    }).map(item => item.id));
    return { count: confirmed.size, unconfirmedResumable: input.wardrobeItems.some(item => resumableWardrobeCutout(item) && !confirmed.has(item.id)) };
  } catch { return null; }
}
async function providerUnknownCount(owner: string): Promise<number | null> {
  try {
    const prefix = `vitrify.provider-dispatch.v1.${encodeURIComponent(owner)}.wardrobe-cutout.`;
    const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(prefix));
    let count = 0;
    for (const key of keys) {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return null;
      const intent = JSON.parse(raw);
      if (intent?.owner !== owner || intent.provider !== 'wardrobe-cutout' ||
        typeof intent.request !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(intent.request) ||
        key !== prefix + intent.request || !['UNKNOWN', 'RESPONSE_OBSERVED'].includes(intent.state)) return null;
      count += Number(intent.state === 'UNKNOWN');
    }
    return count;
  } catch { return null; }
}

/** Diagnostic evidence only, never a new authorization or recovery predicate. */
export function createWardrobeResumeDiagnostic() {
  let seen: { owner: string; generation: number } | undefined;
  return async (input: Observation): Promise<void> => {
    if (!__DEV__ || !input.current() || !['ready', 'error'].includes(input.wardrobeStatus) ||
      (seen?.owner === input.owner && seen.generation === input.generation)) return;
    seen = { owner: input.owner, generation: input.generation };
    try {
      const [confirmed, unknown] = await Promise.all([confirmedItems(input), providerUnknownCount(input.owner)]);
      if (!input.current()) return;
      const items = input.wardrobeItems;
      const blocked = items.filter(item => !hasCutoutArtifact(item) && ['blocked', 'error'].includes(item.cutoutStatus ?? '')).length;
      const reasons: string[] = [];
      if (input.wardrobeStatus !== 'ready') reasons.push('WARDROBE_NOT_READY');
      if (input.wardrobeSync?.state !== 'synced' || input.wardrobeSync.pending !== 0) reasons.push('GLOBAL_SYNC_BLOCKED');
      // Per-item evidence is reported separately; today's scheduler uses the global gate.
      if (confirmed?.unconfirmedResumable) reasons.push('ITEM_NOT_CONFIRMED');
      if (blocked) reasons.push('BLOCKED_NO_ARTIFACT');
      if (unknown !== null && unknown > 0) reasons.push('PROVIDER_UNKNOWN');
      if (!input.cutoutEndpointConfigured && items.some(item => resumableWardrobeCutout(item) && !hasCutoutArtifact(item))) reasons.push('ENDPOINT_MISSING');
      if (confirmed === null || unknown === null) reasons.push('LOCAL_EVIDENCE_UNAVAILABLE');
      if (!items.length) reasons.push('NO_ITEMS');
      else if (!items.some(resumableWardrobeCutout)) reasons.push('NO_RESUMABLE_ITEMS');
      if (!reasons.length) reasons.push('ELIGIBLE');
      const syncState = input.wardrobeSync?.state;
      const pending = input.wardrobeSync?.pending;
      console.info(JSON.stringify({ type: 'wardrobe_resume_diagnostic',
        wardrobeStatus: input.wardrobeStatus, wardrobeSync: { state: syncState && ['synced', 'pending', 'conflict'].includes(syncState) ? syncState : 'UNKNOWN' },
        pendingCount: typeof pending === 'number' && Number.isSafeInteger(pending) && pending >= 0 ? pending : null, cloudConfirmedItemCount: confirmed?.count ?? null,
        pendingCutoutCount: items.filter(item => item.cutoutStatus === 'pending').length,
        blockedWithoutArtifactCount: blocked, artifactReadyCount: items.filter(hasCutoutArtifact).length,
        providerUnknownCount: unknown, cutoutEndpointConfigured: input.cutoutEndpointConfigured, reasonCodes: reasons,
      }));
    } catch { /* No raw errors, retries, side effects or impact on normal resume. */ }
  };
}

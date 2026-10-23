import { recordWardrobeCutoutFailure } from './wardrobeNetworkDiagnostics';

export type WardrobeStage =
  | 'permission'
  | 'picker'
  | 'queue'
  | 'writeGuardQueue'
  | 'copy'
  | 'checkpoint'
  | 'authenticate'
  | 'snapshot'
  | 'prepare'
  | 'encode'
  | 'upload'
  | 'database'
  | 'storageCheck'
  | 'save'
  | 'cutoutQueue'
  | 'cutoutPrepare'
  | 'cutoutProvider'
  | 'cutoutDecode'
  | 'cutoutWrite'
  | 'cutoutSign'
  | 'cutoutCheckpointQueue'
  | 'cutoutCheckpoint'
  | 'cutout'
  | 'cutoutUpload'
  | 'ui';
export type WardrobeProgress = (stage: WardrobeStage) => void;
export type WardrobeSyncPhase = 'configuration' | 'authenticate' | 'snapshot' | 'upload' | 'database' | 'media';
export type WardrobeSyncReason = 'CONFIG_MISSING' | 'PHOTO_CONTRACT_UNAVAILABLE' | 'MEDIA_PENDING' | 'RPC_MISSING' | 'RPC_FAILED' | 'STORAGE_UNKNOWN' | 'UNVERIFIED';
/** Fixed diagnostic codes only: never log server errors, owner, URL or payload. */
export function recordWardrobeSyncDiagnostic(phase: WardrobeSyncPhase, reason: WardrobeSyncReason): void {
  if (!__DEV__) return;
  try { console.info(JSON.stringify({ type: 'wardrobe_sync_diagnostic', phase, reason })); }
  catch { /* Diagnostics must not affect recovery. */ }
}
export interface WardrobeAddOptions {
  requestId: string;
  onStage?: WardrobeProgress;
}
type Timing = {
  calls: number;
  failures: number;
  totalMs: number;
  maxMs: number;
};
const timings: Partial<Record<WardrobeStage, Timing>> = {};

export const wardrobeStageText: Record<WardrobeStage, string> = {
  storageCheck: 'Önceki fotoğraf aktarımı doğrulanıyor…',
  permission: 'Fotoğraf izni kontrol ediliyor…',
  picker: 'Fotoğraf seçimi bekleniyor…',
  queue: 'Önceki dolap işlemi bekleniyor…',
  writeGuardQueue: 'Güvenli yazma sırası bekleniyor…',
  copy: 'Fotoğraf cihazına kaydediliyor…',
  checkpoint: 'Kayıt cihazında güvenceye alınıyor…',
  authenticate: 'Oturum doğrulanıyor…',
  snapshot: 'Dolap bulut kaydı doğrulanıyor…',
  prepare: 'Fotoğraf aktarım için hazırlanıyor…',
  encode: 'Fotoğraf aktarım verisi hazırlanıyor…',
  upload: 'Fotoğraf güvenli biçimde yükleniyor…',
  database: 'Kıyafet bilgileri buluta kaydediliyor…',
  save: 'Kıyafet kaydediliyor…',
  cutoutQueue: 'Arka plan işlemi sırada…',
  cutoutCheckpointQueue: 'İşlem kaydı sırası bekleniyor…',
  cutoutCheckpoint: 'Arka plan işlem kaydı korunuyor…',
  cutoutPrepare: 'Arka plan fotoğrafı hazırlanıyor…',
  cutoutProvider: 'Arka plan düzenleniyor…',
  cutoutDecode: 'Düzenlenen fotoğraf hazırlanıyor…',
  cutoutWrite: 'Düzenlenen fotoğraf cihazına kaydediliyor…',
  cutoutSign: 'Fotoğraf erişimi doğrulanıyor…',
  cutout: 'Arka plan işleniyor…',
  cutoutUpload: 'İşlenmiş fotoğraf yükleniyor…',
  ui: 'Dolabın güncelleniyor…',
};
export function notifyWardrobeStage(
  stage: WardrobeStage,
  notify?: WardrobeProgress,
): void {
  try {
    notify?.(stage);
  } catch {
    /* A view observer must never affect persistence. */
  }
}
export function recordWardrobeTiming(
  stage: WardrobeStage,
  elapsedMs: number,
  failed = false,
): void {
  if (!__DEV__) return;
  const ms = Math.max(0, elapsedMs);
  const total = (timings[stage] ??= {
    calls: 0,
    failures: 0,
    totalMs: 0,
    maxMs: 0,
  });
  total.calls++;
  total.failures += Number(failed);
  total.totalMs += ms;
  total.maxMs = Math.max(total.maxMs, ms);
  // Fixed stage names and numeric/boolean values only. No owner, URI, payload or errors.
  try {
    console.info(
      JSON.stringify({
        type: 'wardrobe_stage_timing',
        stage,
        elapsedMs: ms,
        failed,
      }),
    );
  } catch {
    /* Diagnostics cannot fail work. */
  }
}
export async function measureWardrobeStage<T>(
  stage: WardrobeStage,
  work: () => PromiseLike<T>,
  notify?: WardrobeProgress,
): Promise<T> {
  notifyWardrobeStage(stage, notify);
  if (!__DEV__) return work();
  recordWardrobeStart(stage);
  const start = performance.now();
  let failed = false;
  try {
    return await work();
  } catch (error) {
    failed = true;
    recordWardrobeCutoutFailure(stage, error);
    throw error;
  } finally {
    recordWardrobeTiming(stage, performance.now() - start, failed);
  }
}
export function takeWardrobeTimings(): Partial<Record<WardrobeStage, Timing>> {
  const result = Object.fromEntries(
    Object.entries(timings).map(([stage, value]) => [stage, { ...value }]),
  );
  for (const stage of Object.keys(timings) as WardrobeStage[])
    delete timings[stage];
  return result;
}

export function measureWardrobeStageSync<T>(
  stage: WardrobeStage,
  work: () => T,
): T {
  if (!__DEV__) return work();
  recordWardrobeStart(stage);
  const started = performance.now();
  let failed = false;
  try {
    return work();
  } catch (error) {
    failed = true;
    recordWardrobeCutoutFailure(stage, error);
    throw error;
  } finally {
    recordWardrobeTiming(stage, performance.now() - started, failed);
  }
}

export function recordWardrobeStart(stage: WardrobeStage): void {
  if (!__DEV__) return;
  try {
    console.info(JSON.stringify({ type: 'wardrobe_stage_start', stage }));
  } catch {
    /* Numeric-only diagnostics must not affect work. */
  }
}
export function beginWardrobeWait(stage: WardrobeStage): () => void {
  if (!__DEV__) return () => {};
  const started = performance.now();
  recordWardrobeStart(stage);
  return () => recordWardrobeTiming(stage, performance.now() - started);
}

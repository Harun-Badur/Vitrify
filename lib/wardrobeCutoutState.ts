import type { WardrobeItem } from '../types/wardrobe';

export type WardrobeCutoutJob = 'queued' | 'processing' | 'uploading';
export type WardrobeCutoutPatch = Partial<
  Pick<
    WardrobeItem,
    | 'cutoutStatus'
    | 'cutoutLocalUri'
    | 'cutoutUrl'
    | 'cutoutStoragePath'
    | 'cutoutUrlExpiresAt'
  >
>;
export const wardrobeOriginalIdentity = (item: WardrobeItem): string =>
  item.imageStoragePath ?? item.imageLocalUri ?? item.imageUrl;
export const hasCutoutArtifact = (item: WardrobeItem): boolean =>
  Boolean(item.cutoutLocalUri || item.cutoutStoragePath);
export const resumableWardrobeCutout = (item: WardrobeItem): boolean =>
  item.cutoutStatus === 'pending' ||
  (hasCutoutArtifact(item) &&
    (item.cutoutStatus !== 'ready' ||
      Boolean(
        item.cutoutStoragePath &&
        (item.cutoutUrlExpiresAt ?? 0) < Date.now() + 5 * 60 * 1000,
      )));

export function wardrobeCutoutPresentation(
  item: WardrobeItem,
  job?: WardrobeCutoutJob,
  configured = false,
  cloudConfirmed = true,
): { text: string; retry: boolean } {
  if (job)
    return {
      text:
        job === 'queued'
          ? 'Arka plan işlemi sırada'
          : job === 'uploading'
            ? 'Düzenlenen fotoğraf kaydediliyor'
            : 'Arka plan düzenleniyor',
      retry: false,
    };
  if (item.cutoutStatus === 'pending' && !cloudConfirmed) return { text: 'Bulut kaydı bekleniyor', retry: false };
  if (item.cutoutStatus === 'ready' && !item.cutoutUrl && !hasCutoutArtifact(item)) return { text: 'Fotoğrafın korundu', retry: false };
  if (item.cutoutStatus === 'ready')
    return {
      text: 'Arka plan düzenlendi',
      retry: false,
    };
  if (hasCutoutArtifact(item))
    return { text: 'Fotoğraf aktarımı bekliyor', retry: false };
  if (item.cutoutStatus === 'blocked' || item.cutoutStatus === 'error')
    return {
      text: 'Fotoğrafın korundu',
      retry: false,
    };
  if (!configured)
    return {
      text: 'Arka plan servisi bu sürümde kullanılamıyor',
      retry: false,
    };
  return {
    text:
      item.cutoutStatus === 'pending'
        ? 'Arka plan işlemi bekliyor'
        : 'Arka plan işlem kaydı bulunmuyor',
    retry: false,
  };
}

// Existing artifacts bypass inference. Their upload service reconciles UNKNOWN
// before any redispatch; ambiguous provider calls WITHOUT artifacts stay blocked.
export const autoResumeWardrobeCutout = resumableWardrobeCutout;

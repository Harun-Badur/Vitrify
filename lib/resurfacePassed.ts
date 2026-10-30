/**
 * GEÇİCİ: affiliate feed gelince kaldır.
 *
 * Prototip (küçük katalog): kullanıcı isterse geçtiği ürünler bu oturumda yeniden gösterilir.
 * Kalıcı passedProductIds listesine DOKUNULMAZ; yalnız dışlama listesi hesaplanırken oturum içi
 * bir "yeniden göster" kümesi çıkarılır. Uygulama yeniden açılınca küme boştur (normal dışlama).
 * Kaldırma: bu dosya + lib/prototypeFlags.ts + discoverySlice'taki effectivePassedIds/
 * notePassedAgain çağrıları + index.tsx'teki buton.
 */
import { PROTOTYPE_RESURFACE_PASSED_ENABLED } from './prototypeFlags';

let resurfaced = new Set<string>();

export const canResurfacePassed = (passedCount: number): boolean =>
  PROTOTYPE_RESURFACE_PASSED_ENABLED && passedCount > 0;

/** Dışlama için geçerli pass listesi; girdiyi değiştirmez. */
export const effectivePassedIds = (passedIds: readonly string[]): string[] =>
  PROTOTYPE_RESURFACE_PASSED_ENABLED && resurfaced.size > 0
    ? passedIds.filter(id => !resurfaced.has(id))
    : [...passedIds];

/** Mevcut pass'leri bu oturum için dışlamadan çıkarır (liked etkilenmez). */
export const resurfacePassed = (passedIds: readonly string[]): void => {
  if (!PROTOTYPE_RESURFACE_PASSED_ENABLED) return;
  resurfaced = new Set(passedIds);
};

/** Yeniden gösterilen ürün tekrar geçildi: bir sonraki yenilemede yine dışlansın. */
export const notePassedAgain = (productId: string): void => {
  if (resurfaced.size > 0) resurfaced.delete(productId);
};

export const resetResurfacedPassed = (): void => {
  resurfaced = new Set();
};

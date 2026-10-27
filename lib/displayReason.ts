export const PRICE_BAND_REASON_LABEL = 'Fiyat aralığına uygun';

// Fiyat bandı artık burada gizlenmez; insight chip seçicisi beğeni eşiğiyle açar (lib/insightChip.ts).
export const pickDisplayReason = (reasons: readonly string[]): string | undefined => {
  for (const reason of reasons) {
    const text = reason.trim();
    if (text.length > 0) return text;
  }
  return undefined;
};

export const PRICE_BAND_REASON_LABEL = 'Fiyat aralığına uygun';

// Faz 2'de eşikli ve dürüst metinle geri gelecek.
// Etiket öğrenilmiş fiyat bandından geliyor (tek beğeni yeterli), stüdyo bütçesinden değil.
export const HIDE_PRICE_BAND_REASON = true;

export const pickDisplayReason = (
  reasons: readonly string[],
  hidePriceBand: boolean = HIDE_PRICE_BAND_REASON,
): string | undefined => {
  for (const reason of reasons) {
    const text = reason.trim();
    if (text.length === 0) continue;
    if (hidePriceBand && text === PRICE_BAND_REASON_LABEL) continue;
    return text;
  }
  return undefined;
};

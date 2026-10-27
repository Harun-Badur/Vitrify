import type { InsightChipKind } from './insightChip';

/**
 * Insight chip ve "Neden bu öneri?" sayfasının tüm metinleri. Sabit şablon; LLM yok.
 * Kanıt satırları kendi verisinden doldurulur, cümle kalıbı burada kalır.
 */
export const INSIGHT_CHIP_COPY = {
  aiBadge: 'AI',
  chipLabel: {
    wardrobe_match: 'Dolabındakiyle uyumlu',
    completes_wardrobe: 'Dolabını tamamlar',
    style_fit: 'Tarzına uygun',
    // Kaynak öğrenilmiş fiyat bandıdır, beyan edilen bütçe değil; metin bunu söyler.
    budget: 'Beğendiğin fiyat aralığında',
    discovery: 'Yeni bir şey dene',
  } satisfies Record<InsightChipKind, string>,
  sheetTitle: 'Neden bu öneri?',
  sheetSummary: {
    wardrobe_match: 'Dolabındaki bir parçayla renk ve kombin olarak uyumlu görünüyor.',
    completes_wardrobe: 'Dolabında bu kategoriden parça yok; mevcut parçalarınla kombinlenebilir.',
    style_fit: 'Beğenilerinden öğrendiğimiz tercihlerle örtüşüyor.',
    budget: 'Beğendiğin ürünlerin çoğu bu fiyat aralığında.',
    discovery: 'Alışık olduğundan biraz farklı; yeni bir şey denemen için gösteriyoruz.',
  } satisfies Record<InsightChipKind, string>,
  evidenceTitle: 'Dayanak',
  wardrobeEvidence: (category: string): string => `Dolabındaki ${category}`,
  likeEvidence: (likeCount: number): string => `${likeCount} beğeniden öğrenildi`,
  productEvidence: 'Bu ürün',
  disclaimer: 'Bu bir yapay zekâ önerisidir ve yanılabilir.',
  openWardrobe: 'Dolabımı gör',
  hideKind: 'Bunu bir daha gösterme',
  close: 'Kapat',
  chipAccessibility: (label: string): string => `${label}. Neden bu öneri, ayrıntıları aç.`,
} as const;

export const WARDROBE_CATEGORY_LABEL_TR: Record<string, string> = {
  upper_body: 'üst giyim',
  lower_body: 'alt giyim',
  dresses: 'elbise',
  shoes: 'ayakkabı',
  bags: 'çanta',
  hats: 'şapka',
  accessories: 'aksesuar',
};

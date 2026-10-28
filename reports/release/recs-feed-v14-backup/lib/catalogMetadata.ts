/** Catalog-load repairs only. Never call these transformations from outfit ranking. */
export const P0_CATALOG_REPAIRS = {
  'boyner-15772029': { outfitRole: 'outerwear', subcategory: 'ceket' },
  'trendyol-367600412': { outfitRole: 'accessory', subcategory: 'gozluk' },
  'trendyol-736813153': { outfitRole: 'accessory', subcategory: 'gozluk' },
  // Preserve the existing bottom/category representation of the skirt set.
  'hepsiburada-HBCV0000H0CMNI': { outfitRole: 'bottom', subcategory: 'etek' },
} as const;

export const catalogMetadataRepair = (id: string) =>
  P0_CATALOG_REPAIRS[id as keyof typeof P0_CATALOG_REPAIRS];

// Audited legacy title-derived false positives; do not erase unrelated declared colors.
const INVALID_LEGACY_COLORS: Readonly<Record<string, readonly string[]>> = {
  'trendyol-48108999': ['yesil'],
  'trendyol-879907284': ['yesil'],
  'trendyol-795457817': ['yesil'],
  'trendyol-956741885': ['yesil'],
  'trendyol-1112700851': ['yesil'],
  'trendyol-878818436': ['yesil'],
  'trendyol-889961099': ['mor'],
  'trendyol-877485273': ['mor'],
  'trendyol-83134151': ['altin'],
  'trendyol-1125441545': ['sari'],
  'trendyol-1077699714': ['yesil'],
  'defacto-2827545': ['yesil'],
  'boyner-15795287': ['kirmizi'],
};

export const cleanDeclaredCatalogColors = (id: string, value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const invalid = INVALID_LEGACY_COLORS[id];
  return value.filter((color): color is string => {
    if (typeof color !== 'string') return false;
    const token = color.trim().toLocaleLowerCase('tr-TR');
    return token.length > 0 && token !== 'desenli' && token !== 'unknown' && !invalid?.includes(token);
  });
};

/** Empty scoring tokens represent missing evidence, never unisex/regular defaults. */
export const declaredCatalogGender = (value: unknown): 'women' | 'men' | 'unisex' | '' =>
  value === 'women' || value === 'men' || value === 'unisex' ? value : '';

export const declaredCatalogFit = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const fit = value.trim();
  return fit.toLocaleLowerCase('tr-TR') === 'unknown' ? '' : fit;
};

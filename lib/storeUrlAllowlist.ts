// Alan adları scripts/lib/retailProviders.ts (detectCatalogProvider) ve
// services/deeplinkService.ts (amazon.com.tr) ile aynı kaynaklardan türetilmiştir.
// Affiliate etiketi yalnız sorgu parametresi olarak eklenir; ayrı yönlendirme alan adı yok.
export const ALLOWED_STORE_DOMAINS = [
  'trendyol.com',
  'hepsiburada.com',
  'amazon.com.tr',
  'boyner.com.tr',
  'mavi.com',
  'lcw.com',
  'defacto.com.tr',
  'flo.com.tr',
] as const;

export const isAllowedStoreUrl = (value: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return ALLOWED_STORE_DOMAINS.some(
    domain => host === domain || host.endsWith(`.${domain}`),
  );
};

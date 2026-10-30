/** ı/İ/I → i (1:1), sonra küçük harf: Türkçe i-nokta farkını yok sayan karşılaştırma. */
const fold = (value: string): string => value.replace(/[İIı]/g, 'i').toLowerCase();

const LEADING_SEPARATORS = /^[\s\-–—:|·.,/]+/;

/**
 * Ürün adı marka adıyla başlıyorsa markayı ve baştaki ayırıcıları keser.
 * Marka yoksa, kelime sınırında bitmiyorsa ya da geriye ad kalmıyorsa orijinal döner.
 */
export function stripBrandPrefix(title: string, brand: string | null | undefined): string {
  const name = brand?.trim() ?? '';
  if (name.length === 0) return title;
  const foldedTitle = fold(title);
  const foldedBrand = fold(name);
  // Dönüşüm 1:1 olmalı ki indeksler orijinal metinle hizalı kalsın.
  if (foldedTitle.length !== title.length || foldedBrand.length !== name.length) return title;
  if (!foldedTitle.startsWith(foldedBrand)) return title;
  const rest = title.slice(name.length);
  if (rest.length > 0 && !/^[\s\-–—:|·.,/]/.test(rest)) return title;
  const stripped = rest.replace(LEADING_SEPARATORS, '').trim();
  return stripped.length > 0 ? stripped : title;
}

/**
 * Product preference rules shared by the app and the recs-feed Edge function.
 * Self-contained (no imports) so the Edge bundle can import it; app code reads it
 * through lib/productPreference.ts.
 */

/** Product preference picked by the user; NULL means "not chosen yet" and behaves as 'hepsi'. */
export type ProductPref = 'kadin' | 'erkek' | 'hepsi';
/** products.gender values a preference can admit (lib/catalogEnrichment FEED_GENDERS). */
export type ProductPrefGender = 'kadin' | 'erkek' | 'unisex';

const PRODUCT_PREFS: readonly string[] = ['kadin', 'erkek', 'hepsi'];
const ALLOWED: Readonly<Record<ProductPref, readonly ProductPrefGender[]>> = {
  kadin: ['kadin', 'unisex'],
  erkek: ['erkek', 'unisex'],
  hepsi: ['kadin', 'erkek', 'unisex'],
};
export const PRODUCT_PREF_DEFAULT: ProductPref = 'hepsi';

export const parseProductPref = (value: unknown): ProductPref | null =>
  typeof value === 'string' && PRODUCT_PREFS.includes(value) ? (value as ProductPref) : null;
export const effectiveProductPref = (value: unknown): ProductPref => parseProductPref(value) ?? PRODUCT_PREF_DEFAULT;
/** Catalog genders a preference admits; cocuk is never included. */
export const allowedGendersFor = (pref: ProductPref): readonly ProductPrefGender[] => ALLOWED[pref];

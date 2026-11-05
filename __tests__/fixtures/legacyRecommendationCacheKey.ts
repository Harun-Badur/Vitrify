// Frozen copy of the pre-hash (canonical string) key derivation, used only as a
// golden reference: new keys must induce exactly the same equality relation.
import { fingerprint, RECOMMENDATION_CACHE_SCHEMA_VERSION, RECOMMENDATION_ENGINE_VERSION,
  type CacheContext } from '../../src/recommendationCache/fingerprint';

export function legacyRankingFingerprint(context: CacheContext): string {
  const { input } = context;
  const anchorProductId = input.requiredCatalogProductId ?? null;
  const base = {
    schemaVersion: RECOMMENDATION_CACHE_SCHEMA_VERSION,
    engineVersion: context.engineVersion ?? RECOMMENDATION_ENGINE_VERSION,
    catalogVersion: context.catalogVersion ?? '',
    catalogFingerprint: fingerprint(input.catalogProducts),
    wardrobeFingerprint: fingerprint(input.wardrobeItems),
    anchorProductId,
    anchorFingerprint: fingerprint(input.catalogProducts.find(product => product.id === anchorProductId)),
    contextFingerprint: fingerprint({ wardrobe: input.wardrobeItems,
      firstOnly: input.firstOnly, catalogFilters: input.catalogFilters }),
  };
  return fingerprint(['ranking', base]);
}

export function legacyFinalFingerprint(context: CacheContext): string {
  const exposureFingerprint = fingerprint([...context.input.recommendationExposure ?? []]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  return fingerprint(['final', legacyRankingFingerprint(context), exposureFingerprint]);
}

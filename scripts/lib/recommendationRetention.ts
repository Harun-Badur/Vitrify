import type { SupabaseClient } from '@supabase/supabase-js';
import { recommendationCacheCutoff } from '../../src/recommendationCache/retention';

export interface CacheMaintenancePlan {
  scope: string; engineVersion: string; now: number;
  catalog?: { anchorId: string; version: string };
}
/** Server verifies principal/scope authorization. No scheduler or client-callable maintenance RPC is exposed. */
export async function authorizedPurgeRecommendationCache(client: SupabaseClient, principal: string,
  plan: CacheMaintenancePlan, authorize: (principal: string, scope: string) => Promise<boolean>): Promise<void> {
  if (!principal.trim() || !await authorize(principal, plan.scope)) throw new Error('Cache maintenance unauthorized');
  await purgeRecommendationCache(client, plan);
}

/** Explicit trusted maintenance entry point. No scheduler/CLI/default live execution. */
export async function purgeRecommendationCache(client: SupabaseClient, options: CacheMaintenancePlan): Promise<void> {
  if (!options.scope.trim() || !options.engineVersion.trim() ||
    (options.catalog && (!options.catalog.anchorId.trim() || !options.catalog.version.trim()))) {
    throw new Error('Explicit scope and active versions required');
  }
  // Conditions are evaluated by DELETE against current rows: a fresh upsert is protected.
  const age = await client.from('discover_recommendation_cache').delete()
    .eq('scope', options.scope).lte('updated_at', recommendationCacheCutoff(options.now));
  if (age.error) throw age.error;
  const engine = await client.from('discover_recommendation_cache').delete()
    .eq('scope', options.scope).neq('engine_version', options.engineVersion);
  if (engine.error) throw engine.error;
  // Catalog fingerprints can differ by anchor: never invalidate an entire scope using one anchor's version.
  if (options.catalog) {
    const catalog = await client.from('discover_recommendation_cache').delete()
      .eq('scope', options.scope).eq('anchor_product_id', options.catalog.anchorId)
      .neq('catalog_version', options.catalog.version);
    if (catalog.error) throw catalog.error;
  }
}

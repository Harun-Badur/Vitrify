import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type RecommendationCacheKey } from '../../src/recommendationCache/fingerprint';
import { anchorContext, decodeSnapshot, type FeedPacketRequest, type RecommendationFeedPacket } from '../../src/recommendationCache/feedPacket';
import { complementaryProductsForDisplay } from '../../src/intelligence/recommendations/complementaryProductsForDisplay';
import { serializeFinal } from '../../src/recommendationCache/codec';
import { RecommendationCacheWorker, type RecommendationRecordStore } from './recommendationCacheWorker';
import { recommendationCacheCutoff } from '../../src/recommendationCache/retention';

export interface RecommendationJobClaim { id: string; owner_id: string; claim_token: string; claim_revision: number; request_payload: string }
const claimArgs = (claim: RecommendationJobClaim) => ({ p_job: claim.id, p_token: claim.claim_token, p_revision: claim.claim_revision });
export class SupabaseRecommendationRecordStore implements RecommendationRecordStore {
  private readonly scope: string;
  constructor(private readonly client: SupabaseClient, private readonly ownerId: string | null = null,
    private readonly claim?: RecommendationJobClaim) {
    this.scope = ownerId ?? 'public';
  }
  private hash(key: RecommendationCacheKey): string { return createHash('sha256').update(key.fingerprint).digest('hex'); }
  async read(key: RecommendationCacheKey): Promise<string | undefined> {
    const { data, error } = await this.client.from('discover_recommendation_cache').select('payload')
      .eq('scope', this.scope).eq('kind', key.kind).eq('cache_key_hash', this.hash(key))
      .eq('engine_version', key.engineVersion).eq('catalog_version', key.catalogVersion)
      .gt('updated_at', recommendationCacheCutoff()).maybeSingle();
    if (error) throw error;
    return data?.payload;
  }
  async write(key: RecommendationCacheKey, serialized: string): Promise<void> {
    // Empty wardrobe is not public provenance: exposure, filtered pools and context
    // can still be personal. Only a server-issued owner claim authorizes writes.
    if (!this.ownerId || !this.claim || this.claim.owner_id !== this.ownerId) throw new Error('Cache publication requires an owner-bound v2 job claim; public provenance is unverified');
    const { error } = await this.client.rpc('publish_discover_recommendation_cache', { ...claimArgs(this.claim), p_record: {
      kind: key.kind, cache_key_hash: this.hash(key),
      engine_version: key.engineVersion, catalog_version: key.catalogVersion, anchor_product_id: key.anchorProductId,
      catalog_fingerprint: key.catalogFingerprint, context_fingerprint: key.contextFingerprint,
      payload: serialized, updated_at: new Date().toISOString(),
    } });
    if (error) throw error;
  }
}

/** Feed order is an input. Only recommendations are attached; no feed reranking. */
export async function prepareRecommendationFeedPacket(worker: RecommendationCacheWorker,
  request: FeedPacketRequest): Promise<RecommendationFeedPacket> {
  if (!request || !Array.isArray(request.anchors) || request.anchors.length > 278 ||
    !Array.isArray(request.exposure) || !Array.isArray(request.shownAnchorIds) || !Array.isArray(request.wardrobeItems)) throw new Error('Invalid feed request');
  const packet: RecommendationFeedPacket = { sessionId: request.sessionId, generation: request.generation,
    contextFingerprint: request.contextFingerprint, entries: [] };
  const exposure = new Map(request.exposure);
  const shown = new Set(request.shownAnchorIds);
  const reusable = new Set(request.reusableAnchorIds ?? request.shownAnchorIds);
  for (const anchor of request.anchors) {
    if (reusable.has(anchor.id)) continue;
    const context = anchorContext(request.candidatePool, anchor, request.wardrobeItems, exposure);
    const { result } = await worker.prepare(context);
    packet.entries.push({ anchorProductId: anchor.id, exposure: [...exposure], serialized: serializeFinal(result, context) });
    if (!shown.has(anchor.id)) {
      shown.add(anchor.id);
      for (const product of complementaryProductsForDisplay(result, anchor.id)) exposure.set(product.id, (exposure.get(product.id) ?? 0) + 1);
    }
  }
  return packet;
}

export async function processRecommendationJob(client: SupabaseClient): Promise<boolean> {
  const { data: job, error } = await client.rpc('claim_discover_recommendation_job_v2');
  if (error) throw error;
  if (!job) return false;
  if (typeof job.id !== 'string' || typeof job.owner_id !== 'string' || !job.owner_id ||
    typeof job.claim_token !== 'string' || !job.claim_token || !Number.isSafeInteger(job.claim_revision) || job.claim_revision < 1 ||
    typeof job.request_payload !== 'string') throw new Error('Owner-bound v2 job claim unavailable');
  let packet: string | null = null, preparationError: string | null = null;
  try {
    const request = decodeSnapshot<FeedPacketRequest>(job.request_payload);
    const worker = new RecommendationCacheWorker(new SupabaseRecommendationRecordStore(client, job.owner_id, job));
    packet = JSON.stringify(await prepareRecommendationFeedPacket(worker, request));
  } catch {
    // Keep payload/provider details out of persisted error text.
    preparationError = 'Preparation failed';
  }
  // A lost finish acknowledgement may already have committed. Never issue a
  // second, conflicting terminal write from the catch path.
  const { error: finishError } = await client.rpc('finish_discover_recommendation_job', {
    ...claimArgs(job), p_packet: packet, p_error: preparationError });
  if (finishError) throw finishError;
  return true;
}

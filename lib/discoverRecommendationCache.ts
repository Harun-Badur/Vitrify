import { registerOwnerResource } from './accountDeviceWork';
import type { Product } from '../types/product';
import { discoverPrefetchTrace, forgetDiscoverPrefetchTrace } from './discoverPrefetchInstrumentation';
import type { WardrobeItemForCandidate } from '../src/intelligence/outfits/outfitCandidate';
import type { OutfitDiscoverRecommendation } from '../src/intelligence/recommendations/discoverRecommendation';
import { complementaryProductsForDisplay } from '../src/intelligence/recommendations/complementaryProductsForDisplay';
import { hydrateFinal } from '../src/recommendationCache/codec';
import { fingerprint, RECOMMENDATION_ENGINE_VERSION, sha256Hex } from '../src/recommendationCache/fingerprint';
import { anchorContext, type FeedPacketRequest, type RecommendationFeedPacket } from '../src/recommendationCache/feedPacket';
import { effectiveProductPref, type ProductPref } from './productPreferenceRules';

interface Entry { product: Product; result: readonly OutfitDiscoverRecommendation[]; exposure: ReadonlyMap<string, number>;
  /** Packet identity (catalog version + payload digest) for duplicate detection. */
  payload?: string }
let nextSession = 0;
/** Soft per-anchor cap; only entries whose exposure can never match again are dropped. */
const MAX_ENTRIES_PER_ANCHOR = 16;
const sameExposure = (left: ReadonlyMap<string, number>, right: ReadonlyMap<string, number>) =>
  left.size === right.size && [...left].every(([id, count]) => right.get(id) === count);
/** Only packet ingestion hydrates/hashes. Gesture-time reads never compute/fetch. */
export class DiscoverRecommendationCache {
  readonly sessionId = `discover-${++nextSession}`;
  readonly exposure = new Map<string, number>();
  readonly shown = new Set<string>();
  private readonly entries = new Map<string, Entry[]>();
  private readonly pinned = new Map<string, Entry>();
  private generation = 0;
  private window: readonly Product[] = [];
  private readonly preparationListeners = new Set<() => void>();
  readonly contextFingerprint: string;
  /** Effective preference the catalog pool was read with; NULL is 'hepsi'. */
  readonly productPref: ProductPref;
  private closed = false;
  private catalogValue: readonly Product[];
  private wardrobeValue: readonly WardrobeItemForCandidate[];
  private readonly disposalListeners = new Set<() => void>();
  get catalog() { return this.catalogValue; }
  get wardrobe() { return this.wardrobeValue; }
  get disposed() { return this.closed; }
  onDispose(stop: () => void): () => void { if (this.closed) stop(); else this.disposalListeners.add(stop); return () => this.disposalListeners.delete(stop); }
  dispose(): void {
    if (this.closed) return;
    this.closed = true; this.generation++;
    this.disposalListeners.forEach(stop => stop()); this.disposalListeners.clear();
    this.preparationListeners.clear(); this.entries.clear(); this.pinned.clear();
    this.exposure.clear(); this.shown.clear(); this.window = []; this.catalogValue = []; this.wardrobeValue = [];
    forgetDiscoverPrefetchTrace(this);
  }
  constructor(catalog: readonly Product[], wardrobe: readonly WardrobeItemForCandidate[], owner: string | null,
    productPref: ProductPref | null = null) {
    this.catalogValue = [...catalog]; this.wardrobeValue = [...wardrobe];
    this.productPref = effectiveProductPref(productPref);
    // 'hepsi' keeps the pre-preference key; any other preference never shares a session context with it.
    const context = [owner, RECOMMENDATION_ENGINE_VERSION, catalog, wardrobe];
    this.contextFingerprint = fingerprint(this.productPref === 'hepsi' ? context : [...context, this.productPref]);
    if (owner) registerOwnerResource(owner, { stop: () => this.dispose(), empty: () => this.closed && this.wardrobeValue.length === 0 && this.entries.size === 0 });
  }
  request(anchors: readonly Product[], generation: number): FeedPacketRequest {
    if (this.closed) throw new Error('Owner recommendation cache disposed');
    this.generation = generation;
    return { sessionId: this.sessionId, generation, contextFingerprint: this.contextFingerprint,
      candidatePool: this.catalog, wardrobeItems: this.wardrobe, anchors: [...anchors],
      exposure: [...this.exposure], shownAnchorIds: [...this.shown], productPref: this.productPref,
      reusableAnchorIds: anchors.filter(product => this.pinned.get(product.id)?.product === product).map(product => product.id) };
  }
  get preparationWindow(): readonly Product[] { return this.window; }
  setPreparationWindow(products: readonly Product[]): void {
    if (this.closed) return;
    const window = products.slice(0, 3);
    if (window.length === this.window.length && window.every((product, index) => product === this.window[index])) return;
    this.window = window;
    if (__DEV__) {
      discoverPrefetchTrace(this).window(window);
      discoverPrefetchTrace(this).settle(this);
    }
    this.preparationListeners.forEach(listener => listener());
  }
  subscribePreparation(listener: () => void): () => void {
    this.preparationListeners.add(listener);
    return () => { this.preparationListeners.delete(listener); };
  }
  /** Image warming only; display reads must still validate exposure through lookup. */
  peekPrepared(product: Product): readonly OutfitDiscoverRecommendation[] | undefined {
    return this.entries.get(product.id)?.slice().reverse().find(entry => entry.product === product)?.result;
  }
  /** Whether a packet for this exact anchor object and exposure would only duplicate a held entry. */
  holdsPrepared(product: Product, exposure: ReadonlyMap<string, number>): boolean {
    if (this.closed) return false;
    if (this.pinned.get(product.id)?.product === product) return true;
    return this.entries.get(product.id)?.some(entry => entry.product === product && sameExposure(entry.exposure, exposure)) ?? false;
  }
  /** Exposure only grows, so an entry missing or below a current count can never match `find` again. */
  private reachable(exposure: ReadonlyMap<string, number>): boolean {
    return [...this.exposure].every(([id, count]) => exposure.has(id) && exposure.get(id)! >= count);
  }
  accept(packet: RecommendationFeedPacket, anchors: readonly Product[]): boolean {
    if (this.closed || !packet || !Array.isArray(packet.entries) || packet.sessionId !== this.sessionId ||
      packet.generation !== this.generation || packet.contextFingerprint !== this.contextFingerprint) return false;
    const products = new Map(anchors.map(product => [product.id, product]));
    let accepted = false;
    for (const item of packet.entries) {
      if (!item || typeof item.anchorProductId !== 'string' || typeof item.serialized !== 'string' ||
        !Array.isArray(item.exposure) || item.exposure.some(entry => !Array.isArray(entry) || entry.length !== 2 ||
          typeof entry[0] !== 'string' || typeof entry[1] !== 'number' || !Number.isFinite(entry[1]))) continue;
      const product = products.get(item.anchorProductId);
      if (!product || this.pinned.get(product.id)?.product === product) continue;
      const exposure = new Map(item.exposure);
      const payload = `${item.catalogVersion ?? ''}:${sha256Hex(item.serialized)}`;
      let entries = this.entries.get(product.id) ?? [];
      // An identical packet hydrates to an equal result; the held entry keeps answering lookups.
      if (entries.some(entry => entry.product === product && entry.payload === payload && sameExposure(entry.exposure, exposure))) {
        accepted = true;
        continue;
      }
      const result = hydrateFinal(item.serialized, anchorContext(this.catalog, product, this.wardrobe, exposure, item.catalogVersion));
      if (result.status !== 'hit') continue;
      const entry = { product, result: result.value, exposure, payload };
      entries.push(entry);
      if (entries.length > MAX_ENTRIES_PER_ANCHOR && !this.shown.has(product.id)) entries = entries.filter(held => this.reachable(held.exposure));
      this.entries.set(product.id, entries); accepted = true;
      if (__DEV__) discoverPrefetchTrace(this).stage(product, 'packetAcceptedAt');
      if (__DEV__) discoverPrefetchTrace(this).published(this, product);
    }
    if (__DEV__) discoverPrefetchTrace(this).settle(this);
    return accepted;
  }
  private find(product: Product): Entry | undefined {
    if (this.closed) return undefined;
    const pinned = this.pinned.get(product.id);
    if (pinned?.product === product) return pinned;
    return this.entries.get(product.id)?.find(entry => entry.product === product && (this.shown.has(product.id) ||
      (entry.exposure.size === this.exposure.size && [...entry.exposure].every(([id, count]) => this.exposure.get(id) === count))));
  }
  lookup(product: Product): readonly OutfitDiscoverRecommendation[] | undefined { return this.find(product)?.result; }
  /** Returns true when the product was newly shown, i.e. exposure (and so other cards' lookups) changed. */
  activate(product: Product): boolean {
    const entry = this.find(product);
    if (!entry) return false; // A miss is not a displayed valid empty engine result.
    this.pinned.set(product.id, entry);
    if (this.shown.has(product.id)) return false;
    this.shown.add(product.id);
    for (const recommended of complementaryProductsForDisplay(entry.result, product.id)) {
      this.exposure.set(recommended.id, (this.exposure.get(recommended.id) ?? 0) + 1);
    }
    this.preparationListeners.forEach(listener => listener());
    return true;
  }
}

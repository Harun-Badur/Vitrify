import type { Product, GarmentCategory } from './product';
import type { ProductIntelligence, ProductSignal, ProductSignalSource } from './productIntelligence';
import type { UserStudioProfile } from './profile';
import type { UserDeclaredPreferences, UserSnapshotConflict } from './userSnapshot';
import type { StyleProfileSnapshot } from './recommendation';

export type EvidenceDimension = 'category' | 'colors' | 'styleTags';
export type EvidenceState = 'known' | 'missing' | 'invalid' | 'conflicted' | 'unavailable' | 'unsupported';
export interface EvidenceField {
  status: EvidenceState;
  values: readonly ProductSignal<string>[];
}
/** Projection of existing ProductIntelligence, not a second product inference engine. */
export interface CommonProductEvidence {
  version: 1;
  productId: string;
  intelligence: ProductIntelligence | null;
  fields: Readonly<Record<EvidenceDimension, EvidenceField>>;
  issues: readonly string[];
  metadataStatus: 'loaded' | 'absent' | 'error' | 'invalid';
  semanticColumns: 'loaded' | 'unavailable' | 'unverified';
}
export interface CommonProductEvidenceInput {
  product: Product;
  attributes?: unknown;
  metadataStatus?: 'loaded' | 'absent' | 'error';
  semanticColumns?: 'loaded' | 'unavailable';
}
export interface CommonUserEvidenceInput {
  userId: string | null;
  /** Caller-confirmed session ownership; pure functions do not authenticate users. */
  sourceOwnerId: string | null;
  likes: readonly CommonProductEvidence[];
  passes: readonly { productId: string; evidence?: CommonProductEvidence }[];
  owned: readonly { id: string; category: GarmentCategory }[];
  outfits: readonly { id: string; wardrobeItemIds: readonly string[]; catalogProductIds: readonly string[] }[];
  profile: UserStudioProfile | null;
  /** Current catalog availability, NOT a user's historical encounter set. */
  catalog?: readonly CommonProductEvidence[];
}
export interface UserEvidenceRecord {
  productId: string;
  entity: 'catalog' | 'wardrobe';
  liked: boolean;
  passed: boolean;
  owned: boolean;
  used: boolean;
  outfitIds: readonly string[];
  order: 'unknown';
  passMetadata: 'not_recorded' | 'snapshot_time_unverified' | 'not_applicable' | 'conflicted' | 'identity_mismatch';
}
export interface EvidenceCount {
  value: string;
  likeCount: number;
  passCount: number;
  reliableLikeCount: number;
  reliablePassCount: number;
  ownedCount: number;
  usedCount: number;
  ambiguousCount: number;
  /** Distinct items with derived, conflicting or unverifiable provenance. */
  uncertainCount: number;
  sources: Partial<Record<ProductSignalSource, number>>;
}
export interface EvidenceAnalysis {
  status: 'unsupported' | 'insufficient_data' | 'observed_pattern';
  reliability: 'none' | 'uncertain' | 'documented' | 'mixed';
  sampleCount: number;
  missingCount: number;
  values: readonly EvidenceCount[];
}
export interface CommonUserEvidence {
  version: 1;
  userId: string | null;
  status: 'available' | 'unavailable' | 'owner_mismatch';
  counts: { liked: number; passed: number; owned: number; used: number; outfits: number };
  declared: UserDeclaredPreferences;
  declaredConflicts: readonly UserSnapshotConflict[];
  declaredFreshness: 'unverified';
  records: readonly UserEvidenceRecord[];
  dimensions: Readonly<Record<EvidenceDimension, EvidenceAnalysis>>;
  conflicts: readonly { code: string; productId: string }[];
  missing: readonly string[];
  limitations: readonly string[];
}
export interface BackendProfileSnapshotEvidence {
  snapshot: StyleProfileSnapshot;
  /** The existing scoring snapshot drops DB computed_at; supply it only if read. */
  computedAt?: string;
}
export interface BackendProfileComparison {
  status: 'available' | 'missing' | 'owner_mismatch' | 'invalid';
  freshness: 'unverified' | 'stale' | 'meets_explicit_cutoff' | 'invalid_timestamp';
  equivalence: 'not_equivalent';
  sharedDimensions: readonly string[];
  differences: readonly string[];
}

/** Proposed analysis input. Existing user_events do NOT supply this lifecycle contract.
 * Missing action identity/outcome is unresolved, never inferred from timestamp proximity.
 */
export interface PreferenceEvidenceEvent {
  eventId: string;
  userId: string;
  productId: string;
  eventType: 'like' | 'dolap_add' | 'pass' | 'unlike' | 'undo_pass' | 'dolap_remove';
  actionId?: string | null;
  actionOrigin?: 'favorite' | 'wardrobe' | 'pass';
  outcome?: 'committed' | 'failed' | 'unknown';
  /** Explicitly revoked committed actions, scoped to the same owner and product.
   * Unlike removing a retained favorite must name ALL active favorite actions.
   */
  revertsActionIds?: readonly string[];
}

export interface PreferenceActionEvidence {
  /** Counts describe resolved actions only. Incomplete results are not final preference claims. */
  status: 'ready' | 'incomplete' | 'unavailable';
  positiveActionCount: number;
  negativeActionCount: number;
  ownershipActionCount: number;
  /** Distinct products; repeated independent actions are not independent product samples. */
  positiveProductIds: readonly string[];
  negativeProductIds: readonly string[];
  ownedProductIds: readonly string[];
  ambiguousProductIds: readonly string[];
  unresolvedEventIds: readonly string[];
}

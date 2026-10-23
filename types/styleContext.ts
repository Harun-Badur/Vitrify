import type { GarmentCategory } from './product';
import type {
  ProductIntelligence,
  ProductSemanticConflict,
  ProductSignalConfidence,
  ProductSignalOrigin,
  ProductSignalSource,
} from './productIntelligence';
import type {
  UserBehaviorDirection,
  UserBehaviorStatus,
  UserBehaviorSummary,
  UserBehaviorValueSignal,
  UserDeclaredPreferences,
  UserSnapshotConflict,
} from './userSnapshot';

export const STYLE_CONTEXT_VERSION = 1;

export const STYLE_ANCHOR_FIELDS = [
  'role', 'subtype', 'gender', 'colors', 'fit', 'material', 'season', 'occasion', 'styleTags', 'priceBand',
] as const;

export type StyleAnchorField = (typeof STYLE_ANCHOR_FIELDS)[number];

/** Anchor attributes copied verbatim from Product Intelligence, provenance included. */
export type StyleAnchorAttributes = Pick<ProductIntelligence, StyleAnchorField>;

export interface StyleAnchor {
  productId: string;
  category: GarmentCategory;
  productIntelligenceVersion: ProductIntelligence['version'];
  attributes: StyleAnchorAttributes;
}

/** `catalog_product` marks plain products-table fields such as brand, whose confidence is unknown. */
export interface StyleAnchorValue {
  value: string;
  origin: ProductSignalOrigin;
  source: ProductSignalSource | 'catalog_product';
  confidence: ProductSignalConfidence;
}

/**
 * Literal comparison of the anchor value with a declared preference; never a compatibility verdict.
 * `declared_excludes`: a preference is declared and the anchor value is not part of it.
 */
export type StyleDeclaredRelation =
  | 'declared_includes'
  | 'declared_excludes'
  | 'not_declared'
  | 'anchor_unknown'
  | 'not_applicable';

export interface StyleBehaviorEvidence {
  /** Mirrors the UserSnapshot dimension status; `unavailable` without a snapshot. */
  status: 'known' | 'unknown' | 'unavailable' | 'not_applicable';
  /** UserSnapshot value signals for the anchor's own values, unchanged. */
  anchorValues: readonly UserBehaviorValueSignal[];
}

export interface StyleDimensionContext {
  /** Empty means the anchor value is unknown. */
  anchor: readonly StyleAnchorValue[];
  declared: StyleDeclaredRelation;
  behavior: StyleBehaviorEvidence;
}

export const STYLE_DIMENSIONS = ['color', 'brand', 'subtype', 'gender', 'role', 'priceBand', 'styleTags'] as const;

export type StyleDimension = (typeof STYLE_DIMENSIONS)[number];

export type StyleDimensions = Readonly<Record<StyleDimension, StyleDimensionContext>>;

export type StyleSessionRelation =
  | 'session_matches'
  | 'session_differs'
  | 'no_constraint'
  | 'anchor_unknown'
  | 'session_unavailable';

/** Raw search text and the scorer's session weights are deliberately not carried. */
export interface StyleSessionContext {
  status: 'unavailable' | 'empty' | 'active';
  constraints: { category: string | null; gender: string | null; size: string | null };
  recent: { lastCategory: string | null; lastSubcategory: string | null; lastTryShopSubcategory: string | null };
  hasActiveQuery: boolean;
  /** Literal equality between the anchor and explicit session filters. */
  anchorRelations: { category: StyleSessionRelation; gender: StyleSessionRelation };
}

export interface StyleContextSources {
  anchor: { productId: string; productIntelligenceVersion: ProductIntelligence['version'] };
  user:
    | { status: 'unavailable' }
    | { status: 'available'; snapshotVersion: number; profileStatus: 'loaded' | 'unavailable'; behaviorStatus: UserBehaviorStatus };
  session: { status: StyleSessionContext['status'] };
}

export type StyleContextConflict =
  | { source: 'anchor'; conflict: ProductSemanticConflict }
  | { source: 'user'; conflict: UserSnapshotConflict }
  | {
    source: 'context';
    code: 'declared_behavior_disagreement';
    dimension: 'color' | 'brand';
    value: string;
    behaviorDirection: UserBehaviorDirection;
  };

export type StyleContextGap =
  | { code: 'user_snapshot_unavailable' }
  | { code: 'profile_unavailable' }
  | { code: 'behavior_insufficient'; status: Exclude<UserBehaviorStatus, 'sufficient'> }
  | { code: 'session_intent_unavailable' }
  | { code: 'session_weights_not_interpreted' }
  | { code: 'anchor_attribute_unknown'; fields: readonly StyleAnchorField[] }
  | { code: 'anchor_attribute_uncertain'; fields: readonly { field: StyleAnchorField; confidence: ProductSignalConfidence }[] };

export interface StyleContext {
  version: typeof STYLE_CONTEXT_VERSION;
  anchor: StyleAnchor;
  /** `null` without a UserSnapshot; never merged with behavior. */
  declared: UserDeclaredPreferences | null;
  behavior: UserBehaviorSummary | null;
  session: StyleSessionContext;
  dimensions: StyleDimensions;
  sources: StyleContextSources;
  conflicts: readonly StyleContextConflict[];
  gaps: readonly StyleContextGap[];
}

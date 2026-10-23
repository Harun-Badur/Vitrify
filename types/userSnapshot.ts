import type { GarmentSize, StyleTag } from './profile';

export const USER_SNAPSHOT_VERSION = 1;

/** Declared values are what the user explicitly set in their profile; nothing is inferred here. */
export interface DeclaredPreference<T> {
  value: T | null;
  source: 'profile_declared' | 'unknown';
  confidence: 'high' | 'unknown';
}

export interface DeclaredPriceRange {
  min: number;
  max: number;
}

export interface UserDeclaredPreferences {
  styleTags: DeclaredPreference<readonly StyleTag[]>;
  /** Brand slugs. */
  favoriteBrands: DeclaredPreference<readonly string[]>;
  /** Canonical catalog color slugs. */
  preferredColors: DeclaredPreference<readonly string[]>;
  topSize: DeclaredPreference<GarmentSize>;
  bottomSize: DeclaredPreference<GarmentSize>;
  priceRange: DeclaredPreference<DeclaredPriceRange>;
}

export const USER_BEHAVIOR_DIMENSIONS = ['color', 'subtype', 'brand', 'gender', 'role', 'priceBand'] as const;

export type UserBehaviorDimension = (typeof USER_BEHAVIOR_DIMENSIONS)[number];

/** `mixed` means the same value was both liked and passed. */
export type UserBehaviorDirection = 'positive' | 'negative' | 'mixed';

/** Behavioral evidence never reaches `high`; it is observed, not stated. */
export type UserBehaviorConfidence = 'low' | 'medium';

export interface UserBehaviorValueSignal {
  value: string;
  likeCount: number;
  passCount: number;
  /** Observations whose product attribute was itself derived (e.g. from the title). */
  inferredAttributeCount: number;
  direction: UserBehaviorDirection;
  confidence: UserBehaviorConfidence;
}

export interface UserBehaviorDimensionSignal {
  status: 'known' | 'unknown';
  /** Interactions whose product carried a known value for this dimension. */
  evidenceCount: number;
  /** Empty when `status` is `unknown`. */
  values: readonly UserBehaviorValueSignal[];
}

/** `none`: no interactions; `sparse`: too few to describe preferences. */
export type UserBehaviorStatus = 'none' | 'sparse' | 'sufficient';

export interface UserBehaviorSummary {
  status: UserBehaviorStatus;
  likeCount: number;
  /** Server-persisted passes, including ones without product data. */
  passCount: number;
  /** Passes still undoable in this session. */
  undoablePassCount: number;
  /** Passes with product data available for attribute evidence. */
  attributedPassCount: number;
  /** Undo actions are not retained by the store; undone passes are simply absent. */
  undoHistory: 'not_recorded';
  dimensions: Readonly<Record<UserBehaviorDimension, UserBehaviorDimensionSignal>>;
}

export const USER_SNAPSHOT_CONFLICT_CODES = [
  'liked_and_passed',
  'declared_behavior_mismatch',
  'unrecognized_declared_value',
  'invalid_declared_value',
] as const;

export type UserSnapshotConflictCode = (typeof USER_SNAPSHOT_CONFLICT_CODES)[number];

/** Conflicts are reported, never resolved. */
export interface UserSnapshotConflict {
  code: UserSnapshotConflictCode;
  field: keyof UserDeclaredPreferences | UserBehaviorDimension | 'interactions';
  values: readonly string[];
}

export interface UserSnapshot {
  version: typeof USER_SNAPSHOT_VERSION;
  userId: string | null;
  profileStatus: 'loaded' | 'unavailable';
  declared: UserDeclaredPreferences;
  behavior: UserBehaviorSummary;
  conflicts: readonly UserSnapshotConflict[];
}

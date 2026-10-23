import { inferColorsFromText, slugify } from '../../../lib/productAttributes';
import type { LikedProduct, Product } from '../../../types/product';
import type { ProductIntelligence, ProductSignal } from '../../../types/productIntelligence';
import {
  GARMENT_SIZES,
  STYLE_TAGS,
  type GarmentSize,
  type StyleTag,
  type UserStudioProfile,
} from '../../../types/profile';
import {
  USER_SNAPSHOT_VERSION,
  type DeclaredPreference,
  type DeclaredPriceRange,
  type UserBehaviorDimension,
  type UserBehaviorDimensionSignal,
  type UserBehaviorStatus,
  type UserBehaviorSummary,
  type UserBehaviorValueSignal,
  type UserDeclaredPreferences,
  type UserSnapshot,
  type UserSnapshotConflict,
} from '../../../types/userSnapshot';
import { buildProductIntelligence } from '../product/productIntelligence';

/** Interactions with product data needed before any behavioral preference is described. */
export const MIN_BEHAVIOR_INTERACTIONS = 10;
/** Observations of a dimension needed before it can be `known`. */
export const MIN_DIMENSION_EVIDENCE = 5;
/** Observations of a single value needed before it is reported at all. */
export const MIN_VALUE_EVIDENCE = 3;
/** Observations of a single value needed for `medium` instead of `low` confidence. */
export const MEDIUM_VALUE_EVIDENCE = 8;

/** mapFeedRow substitutes this for a missing brand, so it is not brand evidence. */
const PLACEHOLDER_BRAND_SLUG = 'kabin';

/** Catalog brand slug, or `null` when the brand is missing or the mapFeedRow placeholder. */
export const catalogBrandSlug = (product: Product): string | null => {
  const slug = slugify(product.brand);
  return slug && slug !== PLACEHOLDER_BRAND_SLUG ? slug : null;
};

export interface UserSnapshotInput {
  userId: string | null;
  /** `null` when the profile was not loaded; this is not the same as an empty profile. */
  profile: UserStudioProfile | null;
  likedProducts: readonly LikedProduct[];
  passedProductIds: readonly string[];
  /** Session pass stack; the only passes that still carry product data. */
  passedProducts: readonly Product[];
  /** Defaults to title/variant evidence only; pass the repository bridge to use declared attributes. */
  resolveProductIntelligence?: (product: Product) => ProductIntelligence;
}

const UNKNOWN_DECLARED = { value: null, source: 'unknown', confidence: 'unknown' } as const;

const declared = <T>(value: T | null): DeclaredPreference<T> =>
  value === null ? UNKNOWN_DECLARED : { value, source: 'profile_declared', confidence: 'high' };

const isStyleTag = (value: unknown): value is StyleTag =>
  STYLE_TAGS.some(tag => tag.value === value);

const isGarmentSize = (value: unknown): value is GarmentSize =>
  (GARMENT_SIZES as readonly unknown[]).includes(value);

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const byText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

const defaultIntelligence = (product: Product): ProductIntelligence => buildProductIntelligence({ product });

const resolveDeclared = (
  profile: UserStudioProfile | null,
  conflicts: UserSnapshotConflict[],
): UserDeclaredPreferences => {
  const rawTags: readonly unknown[] = profile?.styleTags ?? [];
  const styleTags = unique(rawTags.filter(isStyleTag));
  const unknownTags = rawTags.filter(tag => !isStyleTag(tag)).map(String);
  if (unknownTags.length > 0) conflicts.push({ code: 'unrecognized_declared_value', field: 'styleTags', values: unknownTags });

  const brands = unique((profile?.favoriteBrands ?? []).map(slugify).filter(slug => slug.length > 0));

  const colors: string[] = [];
  const unknownColors: string[] = [];
  for (const label of profile?.preferredColors ?? []) {
    const slugs = inferColorsFromText(label);
    if (slugs.length === 0) unknownColors.push(label);
    colors.push(...slugs);
  }
  if (unknownColors.length > 0) {
    conflicts.push({ code: 'unrecognized_declared_value', field: 'preferredColors', values: unknownColors });
  }

  const topSize = profile?.topSize;
  const bottomSize = profile?.bottomSize;
  return {
    styleTags: declared(styleTags.length > 0 ? styleTags : null),
    favoriteBrands: declared(brands.length > 0 ? brands : null),
    preferredColors: declared(colors.length > 0 ? unique(colors) : null),
    topSize: declared(isGarmentSize(topSize) ? topSize : null),
    bottomSize: declared(isGarmentSize(bottomSize) ? bottomSize : null),
    priceRange: declared(resolvePriceRange(profile?.priceRange, conflicts)),
  };
};

const resolvePriceRange = (
  range: UserStudioProfile['priceRange'],
  conflicts: UserSnapshotConflict[],
): DeclaredPriceRange | null => {
  if (range == null) return null;
  const { min, max } = range;
  if (Number.isFinite(min) && Number.isFinite(max) && min >= 0 && max >= min) return { min, max };
  conflicts.push({ code: 'invalid_declared_value', field: 'priceRange', values: [String(min), String(max)] });
  return null;
};

interface Observation {
  kind: 'like' | 'pass';
  values: Readonly<Record<UserBehaviorDimension, readonly { value: string; inferred: boolean }[]>>;
}

const fromSignal = (signal: ProductSignal<string>): { value: string; inferred: boolean }[] =>
  signal.value === null ? [] : [{ value: signal.value, inferred: signal.origin === 'derived' }];

const observe = (
  kind: Observation['kind'],
  product: Product,
  resolve: (product: Product) => ProductIntelligence,
): Observation => {
  const intelligence = resolve(product);
  const brand = catalogBrandSlug(product);
  return {
    kind,
    values: {
      color: intelligence.colors.flatMap(fromSignal),
      subtype: fromSignal(intelligence.subtype),
      brand: brand ? [{ value: brand, inferred: false }] : [],
      gender: fromSignal(intelligence.gender),
      role: fromSignal(intelligence.role),
      priceBand: fromSignal(intelligence.priceBand),
    },
  };
};

const UNKNOWN_DIMENSION: UserBehaviorDimensionSignal = { status: 'unknown', evidenceCount: 0, values: [] };

const summarizeDimension = (
  dimension: UserBehaviorDimension,
  observations: readonly Observation[],
  status: UserBehaviorStatus,
): UserBehaviorDimensionSignal => {
  const counts = new Map<string, { like: number; pass: number; inferred: number }>();
  let evidenceCount = 0;
  for (const observation of observations) {
    const values = observation.values[dimension];
    if (values.length === 0) continue;
    evidenceCount++;
    for (const { value, inferred } of values) {
      const entry = counts.get(value) ?? { like: 0, pass: 0, inferred: 0 };
      if (observation.kind === 'like') entry.like++;
      else entry.pass++;
      if (inferred) entry.inferred++;
      counts.set(value, entry);
    }
  }
  if (status !== 'sufficient' || evidenceCount < MIN_DIMENSION_EVIDENCE) {
    return { ...UNKNOWN_DIMENSION, evidenceCount };
  }
  const values: UserBehaviorValueSignal[] = [...counts.entries()]
    .filter(([, entry]) => entry.like + entry.pass >= MIN_VALUE_EVIDENCE)
    .sort(([leftValue, left], [rightValue, right]) =>
      right.like + right.pass - (left.like + left.pass) || byText(leftValue, rightValue))
    .map(([value, entry]) => ({
      value,
      likeCount: entry.like,
      passCount: entry.pass,
      inferredAttributeCount: entry.inferred,
      direction: entry.pass === 0 ? 'positive' : entry.like === 0 ? 'negative' : 'mixed',
      confidence: entry.like + entry.pass >= MEDIUM_VALUE_EVIDENCE ? 'medium' : 'low',
    }));
  return values.length > 0 ? { status: 'known', evidenceCount, values } : { ...UNKNOWN_DIMENSION, evidenceCount };
};

const resolveBehavior = (
  input: UserSnapshotInput,
  conflicts: UserSnapshotConflict[],
): UserBehaviorSummary => {
  const resolve = input.resolveProductIntelligence ?? defaultIntelligence;
  const liked = new Map(input.likedProducts.map(item => [item.product.id, item.product]));
  const passedProducts = new Map(input.passedProducts.map(product => [product.id, product]));
  const passedIds = new Set([...input.passedProductIds, ...passedProducts.keys()]);
  const contradictory = [...liked.keys()].filter(id => passedIds.has(id)).sort(byText);
  if (contradictory.length > 0) conflicts.push({ code: 'liked_and_passed', field: 'interactions', values: contradictory });
  const excluded = new Set(contradictory);

  const observations: Observation[] = [
    ...[...liked.values()].filter(product => !excluded.has(product.id)).map(product => observe('like', product, resolve)),
    ...[...passedProducts.values()].filter(product => !excluded.has(product.id)).map(product => observe('pass', product, resolve)),
  ];
  const attributedPassCount = observations.filter(observation => observation.kind === 'pass').length;
  const status: UserBehaviorStatus = liked.size + passedIds.size === 0
    ? 'none'
    : observations.length < MIN_BEHAVIOR_INTERACTIONS ? 'sparse' : 'sufficient';

  const summarize = (dimension: UserBehaviorDimension): UserBehaviorDimensionSignal =>
    summarizeDimension(dimension, observations, status);
  const dimensions: Record<UserBehaviorDimension, UserBehaviorDimensionSignal> = {
    color: summarize('color'),
    subtype: summarize('subtype'),
    brand: summarize('brand'),
    gender: summarize('gender'),
    role: summarize('role'),
    priceBand: summarize('priceBand'),
  };

  return {
    status,
    likeCount: liked.size,
    passCount: passedIds.size,
    undoablePassCount: passedProducts.size,
    attributedPassCount,
    undoHistory: 'not_recorded',
    dimensions,
  };
};

const recordDeclaredMismatches = (
  declaredPreferences: UserDeclaredPreferences,
  behavior: UserBehaviorSummary,
  conflicts: UserSnapshotConflict[],
): void => {
  const pairs = [
    ['preferredColors', declaredPreferences.preferredColors.value, behavior.dimensions.color],
    ['favoriteBrands', declaredPreferences.favoriteBrands.value, behavior.dimensions.brand],
  ] as const;
  for (const [field, values, dimension] of pairs) {
    if (!values || dimension.status !== 'known') continue;
    const rejected = dimension.values
      .filter(signal => signal.direction === 'negative' && values.includes(signal.value))
      .map(signal => signal.value);
    if (rejected.length > 0) conflicts.push({ code: 'declared_behavior_mismatch', field, values: rejected });
  }
};

/** Pure and deterministic; reads only the inputs and never writes events, storage or backend state. */
export const buildUserSnapshot = (input: UserSnapshotInput): UserSnapshot => {
  const conflicts: UserSnapshotConflict[] = [];
  const declaredPreferences = resolveDeclared(input.profile, conflicts);
  const behavior = resolveBehavior(input, conflicts);
  recordDeclaredMismatches(declaredPreferences, behavior, conflicts);
  return {
    version: USER_SNAPSHOT_VERSION,
    userId: input.userId,
    profileStatus: input.profile ? 'loaded' : 'unavailable',
    declared: declaredPreferences,
    behavior,
    conflicts,
  };
};

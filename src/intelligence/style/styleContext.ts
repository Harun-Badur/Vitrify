import { getDisplayPrice, type Product } from '../../../types/product';
import type { ProductIntelligence, ProductSignal } from '../../../types/productIntelligence';
import type { SessionIntent } from '../../../types/recommendation';
import {
  STYLE_ANCHOR_FIELDS,
  STYLE_CONTEXT_VERSION,
  type StyleAnchorAttributes,
  type StyleAnchorField,
  type StyleAnchorValue,
  type StyleBehaviorEvidence,
  type StyleContext,
  type StyleContextConflict,
  type StyleContextGap,
  type StyleContextSources,
  type StyleDeclaredRelation,
  type StyleDimensionContext,
  type StyleDimensions,
  type StyleSessionContext,
  type StyleSessionRelation,
} from '../../../types/styleContext';
import type {
  DeclaredPreference,
  UserBehaviorDimension,
  UserBehaviorSummary,
  UserDeclaredPreferences,
  UserSnapshot,
} from '../../../types/userSnapshot';
import { catalogBrandSlug } from '../user/userSnapshot';

export interface StyleContextInput {
  anchor: Product;
  /** Must describe `anchor`; build it with buildProductIntelligence. */
  anchorIntelligence: ProductIntelligence;
  user: UserSnapshot | null;
  sessionIntent: SessionIntent | null;
}

/** The user evidence a StyleContext carries; `null` when no snapshot was available. */
export interface StylePreferences {
  declared: UserDeclaredPreferences | null;
  behavior: UserBehaviorSummary | null;
}

const NOT_APPLICABLE_BEHAVIOR: StyleBehaviorEvidence = { status: 'not_applicable', anchorValues: [] };

const signalValues = <T extends string>(signals: readonly ProductSignal<T>[]): StyleAnchorValue[] =>
  signals.flatMap((signal) =>
    signal.value === null
      ? []
      : [{ value: signal.value, origin: signal.origin, source: signal.source, confidence: signal.confidence }]);

const fieldSignals = (attributes: StyleAnchorAttributes, field: StyleAnchorField): readonly ProductSignal<string>[] => {
  const value: ProductSignal<string> | readonly ProductSignal<string>[] = attributes[field];
  return 'origin' in value ? [value] : value;
};

const isUnknownField = (attributes: StyleAnchorAttributes, field: StyleAnchorField): boolean =>
  fieldSignals(attributes, field).every((signal) => signal.value === null);

export const unknownStyleFields = (attributes: StyleAnchorAttributes): StyleAnchorField[] =>
  STYLE_ANCHOR_FIELDS.filter((field) => isUnknownField(attributes, field));

export const styleAttributesOf = (intelligence: ProductIntelligence): StyleAnchorAttributes => ({
  role: intelligence.role,
  subtype: intelligence.subtype,
  gender: intelligence.gender,
  colors: intelligence.colors,
  fit: intelligence.fit,
  material: intelligence.material,
  season: intelligence.season,
  occasion: intelligence.occasion,
  styleTags: intelligence.styleTags,
  priceBand: intelligence.priceBand,
});

const relationToSet = (
  anchor: readonly StyleAnchorValue[],
  preference: DeclaredPreference<readonly string[]> | undefined,
  normalize: (value: string) => string = (value) => value,
): StyleDeclaredRelation => {
  if (!preference || preference.value === null || preference.value.length === 0) return 'not_declared';
  if (anchor.length === 0) return 'anchor_unknown';
  const declared = new Set(preference.value.map(normalize));
  return anchor.some((entry) => declared.has(normalize(entry.value))) ? 'declared_includes' : 'declared_excludes';
};

/** Compares the anchor's display price itself, not its derived band, with the declared range. */
const priceRelation = (anchor: Product, declared: UserDeclaredPreferences | null): StyleDeclaredRelation => {
  const range = declared?.priceRange.value;
  if (!range) return 'not_declared';
  const price = getDisplayPrice(anchor);
  if (!Number.isFinite(price) || price <= 0) return 'anchor_unknown';
  return price >= range.min && price <= range.max ? 'declared_includes' : 'declared_excludes';
};

const behaviorEvidence = (
  behavior: UserBehaviorSummary | null,
  dimension: UserBehaviorDimension,
  anchor: readonly StyleAnchorValue[],
): StyleBehaviorEvidence => {
  if (!behavior) return { status: 'unavailable', anchorValues: [] };
  const signal = behavior.dimensions[dimension];
  const anchorValues = new Set(anchor.map((entry) => entry.value));
  return {
    status: signal.status,
    anchorValues: signal.values.filter((entry) => anchorValues.has(entry.value)),
  };
};

/** Describes any product against the user's evidence; `anchor` names the described product. */
export const buildStyleDimensions = (
  anchor: Product,
  attributes: StyleAnchorAttributes,
  { declared, behavior }: StylePreferences,
): StyleDimensions => {
  const brandSlug = catalogBrandSlug(anchor);
  const brand: StyleAnchorValue[] = brandSlug
    ? [{ value: brandSlug, origin: 'declared', source: 'catalog_product', confidence: 'unknown' }]
    : [];
  const color = signalValues(attributes.colors);
  const subtype = signalValues([attributes.subtype]);
  const gender = signalValues([attributes.gender]);
  const role = signalValues([attributes.role]);
  const priceBand = signalValues([attributes.priceBand]);
  const styleTags = signalValues(attributes.styleTags);
  const notDeclared = (values: StyleAnchorValue[], dimension: UserBehaviorDimension): StyleDimensionContext => ({
    anchor: values,
    declared: 'not_applicable',
    behavior: behaviorEvidence(behavior, dimension, values),
  });

  return {
    color: {
      anchor: color,
      declared: relationToSet(color, declared?.preferredColors),
      behavior: behaviorEvidence(behavior, 'color', color),
    },
    brand: {
      anchor: brand,
      declared: relationToSet(brand, declared?.favoriteBrands),
      behavior: behaviorEvidence(behavior, 'brand', brand),
    },
    subtype: notDeclared(subtype, 'subtype'),
    gender: notDeclared(gender, 'gender'),
    role: notDeclared(role, 'role'),
    priceBand: {
      anchor: priceBand,
      declared: priceRelation(anchor, declared),
      behavior: behaviorEvidence(behavior, 'priceBand', priceBand),
    },
    styleTags: {
      anchor: styleTags,
      declared: relationToSet(styleTags, declared?.styleTags, (value) => value.toLocaleLowerCase('tr-TR')),
      behavior: NOT_APPLICABLE_BEHAVIOR,
    },
  };
};

const hasWeights = (intent: SessionIntent): boolean =>
  Object.values(intent.weights).some((weights) => Object.keys(weights).length > 0);

const sessionRelation = (
  intent: SessionIntent | null,
  constraint: string | null,
  anchorValue: string | null,
): StyleSessionRelation => {
  if (!intent) return 'session_unavailable';
  if (!constraint) return 'no_constraint';
  if (!anchorValue) return 'anchor_unknown';
  return constraint === anchorValue ? 'session_matches' : 'session_differs';
};

const buildSession = (
  intent: SessionIntent | null,
  anchor: Product,
  attributes: StyleAnchorAttributes,
): StyleSessionContext => {
  const constraints = {
    category: intent?.constraints.category ?? null,
    gender: intent?.constraints.gender ?? null,
    size: intent?.constraints.size ?? null,
  };
  const recent = {
    lastCategory: intent?.lastCategory ?? null,
    lastSubcategory: intent?.lastSubcategory ?? null,
    lastTryShopSubcategory: intent?.lastTryShopSubcategory ?? null,
  };
  const hasActiveQuery = Boolean(intent && intent.query.trim().length > 0);
  const isEmpty = !hasActiveQuery
    && Object.values(constraints).every((value) => value === null)
    && Object.values(recent).every((value) => value === null)
    && !(intent && hasWeights(intent));

  return {
    status: !intent ? 'unavailable' : isEmpty ? 'empty' : 'active',
    constraints,
    recent,
    hasActiveQuery,
    anchorRelations: {
      category: sessionRelation(intent, constraints.category, anchor.category),
      gender: sessionRelation(intent, constraints.gender, attributes.gender.value),
    },
  };
};

const buildConflicts = (
  intelligence: ProductIntelligence,
  user: UserSnapshot | null,
  dimensions: StyleDimensions,
): StyleContextConflict[] => {
  const conflicts: StyleContextConflict[] = [
    ...intelligence.conflicts.map((conflict): StyleContextConflict => ({ source: 'anchor', conflict })),
    ...(user?.conflicts ?? []).map((conflict): StyleContextConflict => ({ source: 'user', conflict })),
  ];
  for (const dimension of ['color', 'brand'] as const) {
    const context = dimensions[dimension];
    if (context.declared !== 'declared_includes') continue;
    const declared = dimension === 'color' ? user?.declared.preferredColors.value : user?.declared.favoriteBrands.value;
    const declaredSet = new Set(declared ?? []);
    for (const signal of context.behavior.anchorValues) {
      if (signal.direction !== 'negative' || !declaredSet.has(signal.value)) continue;
      conflicts.push({
        source: 'context',
        code: 'declared_behavior_disagreement',
        dimension,
        value: signal.value,
        behaviorDirection: signal.direction,
      });
    }
  }
  return conflicts;
};

const buildGaps = (
  attributes: StyleAnchorAttributes,
  user: UserSnapshot | null,
  intent: SessionIntent | null,
): StyleContextGap[] => {
  const gaps: StyleContextGap[] = [];
  if (!user) {
    gaps.push({ code: 'user_snapshot_unavailable' });
  } else {
    if (user.profileStatus === 'unavailable') gaps.push({ code: 'profile_unavailable' });
    if (user.behavior.status !== 'sufficient') gaps.push({ code: 'behavior_insufficient', status: user.behavior.status });
  }
  if (!intent) gaps.push({ code: 'session_intent_unavailable' });
  else if (hasWeights(intent)) gaps.push({ code: 'session_weights_not_interpreted' });

  const unknown = unknownStyleFields(attributes);
  if (unknown.length > 0) gaps.push({ code: 'anchor_attribute_unknown', fields: unknown });

  const uncertain = STYLE_ANCHOR_FIELDS.flatMap((field) =>
    fieldSignals(attributes, field)
      .filter((signal) => signal.value !== null && (signal.confidence === 'low' || signal.confidence === 'unknown'))
      .map((signal) => ({ field, confidence: signal.confidence })));
  if (uncertain.length > 0) gaps.push({ code: 'anchor_attribute_uncertain', fields: uncertain });
  return gaps;
};

/**
 * Pure assembly of style context. Explicit, behavioral and session evidence stay side by side;
 * nothing is scored, ranked or resolved, and the raw search query is never copied.
 */
export const buildStyleContext = ({
  anchor,
  anchorIntelligence,
  user,
  sessionIntent,
}: StyleContextInput): StyleContext => {
  if (anchorIntelligence.productId !== anchor.id) {
    throw new Error('buildStyleContext: anchorIntelligence does not describe the anchor product');
  }
  const attributes = styleAttributesOf(anchorIntelligence);
  const dimensions = buildStyleDimensions(anchor, attributes, {
    declared: user?.declared ?? null,
    behavior: user?.behavior ?? null,
  });
  const session = buildSession(sessionIntent, anchor, attributes);
  const sources: StyleContextSources = {
    anchor: { productId: anchor.id, productIntelligenceVersion: anchorIntelligence.version },
    user: user
      ? {
        status: 'available',
        snapshotVersion: user.version,
        profileStatus: user.profileStatus,
        behaviorStatus: user.behavior.status,
      }
      : { status: 'unavailable' },
    session: { status: session.status },
  };

  return {
    version: STYLE_CONTEXT_VERSION,
    anchor: {
      productId: anchor.id,
      category: anchor.category,
      productIntelligenceVersion: anchorIntelligence.version,
      attributes,
    },
    declared: user?.declared ?? null,
    behavior: user?.behavior ?? null,
    session,
    dimensions,
    sources,
    conflicts: buildConflicts(anchorIntelligence, user, dimensions),
    gaps: buildGaps(attributes, user, sessionIntent),
  };
};

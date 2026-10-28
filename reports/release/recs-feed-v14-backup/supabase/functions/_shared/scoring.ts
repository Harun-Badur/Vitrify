import type {
  DiversityMix,
  FeedMode,
  RecsScoringConfig,
  ScoreBreakdown,
  ScoredCandidate,
  ScoringCandidate,
  ScoringWeights,
  SessionIntent,
  StyleProfileSnapshot,
  StyleTagPrior,
  TrendScoringBoost,
  WeightMap,
} from './types.ts';

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;
const UINT32 = 4294967296;
const FRESHNESS_HORIZON_DAYS = 90;
const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;
const DEFAULT_DECLARED_STYLE_SHARE = 0.35;
const DEFAULT_BEHAVIORAL_STYLE_SHARE = 0.65;
const DEFAULT_PRODUCT_NEGATIVE_HOURS = 12;
const DEFAULT_FEATURE_NEGATIVE_SCALE = 0.25;
const DEFAULT_NOISE_AMPLITUDE = 2;
const DEFAULT_TRY_SHOP_BOOST = 4;

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  category_match: 10,
  style_match: 8,
  color_match: 6,
  brand_match: 5,
  fit_match: 6,
  price_match: 4,
  negative_signal: 8,
  novelty: 3,
  freshness: 2,
  context: 9,
  try_shop_boost: DEFAULT_TRY_SHOP_BOOST,
  deal_match: 0,
};

export const DEFAULT_TREND_SCORING_BOOST: TrendScoringBoost = {
  freshness: 1.8,
  novelty: 1.6,
  context: 0.45,
  style_match: 0.55,
  category_match: 0.7,
  color_match: 0.7,
  brand_match: 0.7,
  fit_match: 0.7,
  price_match: 1,
  deal_match: 3,
  preferred: 0.82,
  discovery: 1.45,
};

export const DEFAULT_STYLE_TAG_PRIORS: Record<string, StyleTagPrior> = {
  minimal: {
    subcategoryW: {
      tisort: 0.8,
      gomlek: 0.9,
      pantolon: 0.7,
      elbise: 0.6,
      ceket: 0.5,
    },
    fitW: { regular: 0.8, slim: 0.7, oversized: 0.2, relaxed: 0.3 },
    colorW: { siyah: 0.7, beyaz: 0.9, bej: 0.8, gri: 0.7, navy: 0.8 },
  },
  street: {
    subcategoryW: {
      tisort: 0.7,
      hoodie: 0.9,
      jean: 0.8,
      kargo: 0.8,
      sweatshirt: 0.7,
    },
    fitW: { oversized: 0.9, relaxed: 0.8, regular: 0.4, slim: 0.2 },
    colorW: { siyah: 0.9, beyaz: 0.5, gri: 0.7, kirmizi: 0.4 },
  },
  classic: {
    subcategoryW: {
      gomlek: 0.9,
      ceket: 0.85,
      blazer: 0.9,
      pantolon: 0.8,
      elbise: 0.7,
    },
    fitW: { regular: 0.9, slim: 0.8, relaxed: 0.3, oversized: 0.15 },
    colorW: { navy: 0.9, bej: 0.8, beyaz: 0.8, camel: 0.7, siyah: 0.5 },
  },
  sport: {
    subcategoryW: {
      tisort: 0.8,
      sweatshirt: 0.85,
      esofman: 0.9,
      sort: 0.7,
      hoodie: 0.6,
    },
    fitW: { regular: 0.7, relaxed: 0.8, slim: 0.3, oversized: 0.4 },
    colorW: { siyah: 0.7, gri: 0.8, navy: 0.6, beyaz: 0.5 },
  },
};

export const DEFAULT_RECS_CONFIG: RecsScoringConfig = {
  scoringWeights: DEFAULT_SCORING_WEIGHTS,
  reasonsThresholds: {
    brand_match: 0.35,
    category_match: 0.3,
    style_match: 0.3,
    color_match: 0.25,
    fit_match: 0.25,
    price_match: 0.2,
    complementary: 0.4,
    min_score_for_sana_uygun: 0.55,
  },
  diversityMix: {
    preferred: 0.45,
    similar: 0.22,
    complementary: 0.18,
    discovery: 0.15,
  },
  noiseAmplitude: DEFAULT_NOISE_AMPLITUDE,
  declaredStyleShare: DEFAULT_DECLARED_STYLE_SHARE,
  behavioralStyleShare: DEFAULT_BEHAVIORAL_STYLE_SHARE,
  productNegativeHours: DEFAULT_PRODUCT_NEGATIVE_HOURS,
  featureNegativeScale: DEFAULT_FEATURE_NEGATIVE_SCALE,
  styleTagPriors: DEFAULT_STYLE_TAG_PRIORS,
  configVersion: 'default',
  trendScoringBoost: DEFAULT_TREND_SCORING_BOOST,
};

export const emptyStyleProfile = (userId: string): StyleProfileSnapshot => ({
  userId,
  colorW: {},
  subcategoryW: {},
  brandW: {},
  fitW: {},
  priceBandW: {},
  styleTagWeights: {},
  negativePreferences: [],
});

const scaleMix = (mix: DiversityMix, boost: TrendScoringBoost): DiversityMix => {
  const preferred = mix.preferred * boost.preferred;
  const similar = mix.similar;
  const complementary = mix.complementary;
  const discovery = mix.discovery * boost.discovery;
  const sum = preferred + similar + complementary + discovery;
  if (sum <= 0) {
    return mix;
  }
  return {
    preferred: preferred / sum,
    similar: similar / sum,
    complementary: complementary / sum,
    discovery: discovery / sum,
  };
};

export const applyFeedMode = (
  config: RecsScoringConfig,
  mode: FeedMode,
): RecsScoringConfig => {
  if (mode === 'personal') {
    return config;
  }
  const boost = config.trendScoringBoost;
  const weights = config.scoringWeights;
  return {
    ...config,
    scoringWeights: {
      ...weights,
      freshness: weights.freshness * boost.freshness,
      novelty: weights.novelty * boost.novelty,
      context: weights.context * boost.context,
      style_match: weights.style_match * boost.style_match,
      category_match: weights.category_match * boost.category_match,
      color_match: weights.color_match * boost.color_match,
      brand_match: weights.brand_match * boost.brand_match,
      fit_match: weights.fit_match * boost.fit_match,
      price_match: weights.price_match * boost.price_match,
      deal_match: boost.deal_match,
    },
    diversityMix: scaleMix(config.diversityMix, boost),
  };
};

export const emptySessionIntent = (): SessionIntent => ({
  weights: {
    colorW: {},
    subcategoryW: {},
    brandW: {},
    fitW: {},
    priceBandW: {},
    categoryW: {},
  },
  constraints: { category: null, gender: null, size: null },
  query: '',
  lastCategory: null,
  lastSubcategory: null,
  lastTryShopSubcategory: null,
});

export const clamp01 = (value: number): number =>
  Math.min(1, Math.max(0, value));

export const lookupWeight = (map: WeightMap, key: string | null): number => {
  if (key === null || key.trim().length === 0) {
    return 0;
  }
  return clamp01(map[key.trim().toLocaleLowerCase('tr-TR')] ?? 0);
};

export const maxLookup = (map: WeightMap, keys: string[]): number => {
  let max = 0;
  for (const key of keys) {
    max = Math.max(max, lookupWeight(map, key));
  }
  return max;
};

const meanOf = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export const utcDayKey = (nowMs: number): string =>
  new Date(nowMs).toISOString().slice(0, 10);

export const hashToUnit = (input: string): number => {
  let hash = FNV_OFFSET;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0) / UINT32;
};

export const controlledNoise = (
  userId: string,
  productId: string,
  nowMs: number,
  amplitude: number,
): number => {
  const unit = hashToUnit(`${userId}|${productId}|${utcDayKey(nowMs)}`);
  return (unit * 2 - 1) * amplitude;
};

const priorMatch = (
  prior: StyleTagPrior,
  candidate: ScoringCandidate,
): number =>
  meanOf([
    lookupWeight(prior.subcategoryW, candidate.subcategory),
    lookupWeight(prior.fitW, candidate.fit),
    maxLookup(prior.colorW, candidate.colors),
  ]);

const declaredStyleAffinity = (
  profile: StyleProfileSnapshot,
  candidate: ScoringCandidate,
  priors: Record<string, StyleTagPrior>,
): number => {
  const entries = Object.entries(profile.styleTagWeights).filter(
    ([, weight]) => weight > 0,
  );
  if (entries.length === 0) {
    return 0;
  }
  let weighted = 0;
  let total = 0;
  for (const [tag, weight] of entries) {
    const prior = priors[tag];
    if (!prior) {
      continue;
    }
    weighted += weight * priorMatch(prior, candidate);
    total += weight;
  }
  return total === 0 ? 0 : clamp01(weighted / total);
};

const matchesQuery = (candidate: ScoringCandidate, query: string): boolean => {
  const needle = query.trim().toLocaleLowerCase('tr-TR');
  if (needle.length === 0) {
    return false;
  }
  const haystack = `${candidate.brand} ${candidate.brandSlug} ${candidate.subcategory}`
    .toLocaleLowerCase('tr-TR');
  return haystack.includes(needle);
};

const freshnessScore = (createdAtMs: number, nowMs: number): number => {
  if (createdAtMs <= 0) {
    return 0;
  }
  const ageDays = (nowMs - createdAtMs) / MS_PER_DAY;
  return clamp01(1 - ageDays / FRESHNESS_HORIZON_DAYS);
};

const noveltyScore = (impressionCount: number): number => {
  if (impressionCount <= 1) {
    return 1;
  }
  return clamp01(1 / (1 + impressionCount));
};

/**
 * Ürün-düzeyi 12s ceza varsa feature cezası uygulanmaz (çift ceza yok).
 * Decay tekil: yarım ömür productNegativeHours.
 */
export const softNegativeScore = (
  candidate: ScoringCandidate,
  profile: StyleProfileSnapshot,
  nowMs: number,
  productNegativeHours: number,
  featureNegativeScale: number,
): number => {
  const halfLifeMs = Math.max(productNegativeHours, 1) * MS_PER_HOUR;
  let productPenalty = 0;
  let featurePenalty = 0;

  for (const pref of profile.negativePreferences) {
    const atMs = pref.at ? Date.parse(pref.at) : Number.NaN;
    const ageMs = Number.isFinite(atMs) ? Math.max(0, nowMs - atMs) : 0;
    const decay = 0.5 ** (ageMs / halfLifeMs);

    if (pref.productId === candidate.id) {
      productPenalty = Math.max(productPenalty, decay);
      continue;
    }

    let featureHit = 0;
    if (pref.colors.some((color) => candidate.colors.includes(color))) {
      featureHit = Math.max(featureHit, 1);
    }
    if (
      pref.subcategory !== null &&
      pref.subcategory === candidate.subcategory
    ) {
      featureHit = Math.max(featureHit, 1);
    }
    if (pref.fit !== null && pref.fit === candidate.fit) {
      featureHit = Math.max(featureHit, 0.6);
    }
    if (pref.brandSlug !== null && pref.brandSlug === candidate.brandSlug) {
      featureHit = Math.max(featureHit, 0.8);
    }
    featurePenalty = Math.max(featurePenalty, featureHit * decay);
  }

  if (productPenalty > 0) {
    return clamp01(productPenalty);
  }
  return clamp01(featurePenalty * featureNegativeScale);
};

export const scoreCandidate = (
  candidate: ScoringCandidate,
  profile: StyleProfileSnapshot,
  session: SessionIntent,
  config: RecsScoringConfig,
  nowMs: number,
  userId: string,
): ScoredCandidate => {
  const weights = config.scoringWeights;
  const colorAffinity = maxLookup(profile.colorW, candidate.colors);
  const fitAffinity = lookupWeight(profile.fitW, candidate.fit);
  const categoryAffinity = Math.max(
    lookupWeight(profile.subcategoryW, candidate.subcategory),
    lookupWeight(profile.subcategoryW, candidate.category),
  );
  const brandAffinity = lookupWeight(profile.brandW, candidate.brandSlug);
  const priceFit = lookupWeight(profile.priceBandW, candidate.priceBand);

  const behavioralStyle = meanOf([
    colorAffinity,
    fitAffinity,
    categoryAffinity,
  ]);
  const declaredStyle = declaredStyleAffinity(
    profile,
    candidate,
    config.styleTagPriors,
  );
  const styleAffinity = clamp01(
    config.declaredStyleShare * declaredStyle +
      config.behavioralStyleShare * behavioralStyle,
  );

  const sessionColor = maxLookup(session.weights.colorW, candidate.colors);
  const sessionFit = lookupWeight(session.weights.fitW, candidate.fit);
  const sessionCategory = Math.max(
    lookupWeight(session.weights.subcategoryW, candidate.subcategory),
    lookupWeight(session.weights.categoryW, candidate.category),
  );
  const sessionBrand = lookupWeight(session.weights.brandW, candidate.brandSlug);
  const sessionPrice = lookupWeight(
    session.weights.priceBandW,
    candidate.priceBand,
  );
  let sessionAffinity = meanOf([
    sessionColor,
    sessionFit,
    sessionCategory,
    sessionBrand,
    sessionPrice,
  ]);
  if (matchesQuery(candidate, session.query)) {
    sessionAffinity = clamp01(sessionAffinity + 0.45);
  }

  const longTermAffinity = meanOf([
    colorAffinity,
    fitAffinity,
    categoryAffinity,
    brandAffinity,
    priceFit,
  ]);

  const freshness = freshnessScore(candidate.createdAtMs, nowMs);
  const novelty = noveltyScore(candidate.impressionCount);
  const tryShopBoost =
    session.lastTryShopSubcategory !== null &&
    session.lastTryShopSubcategory === candidate.subcategory
      ? 1
      : 0;
  const deal = clamp01(Number.isFinite(candidate.deal) ? candidate.deal : 0);
  const softNegative = softNegativeScore(
    candidate,
    profile,
    nowMs,
    config.productNegativeHours,
    config.featureNegativeScale,
  );
  const noise = controlledNoise(
    userId,
    candidate.id,
    nowMs,
    config.noiseAmplitude,
  );

  const baseWeightSum =
    weights.category_match +
    weights.style_match +
    weights.color_match +
    weights.brand_match +
    weights.fit_match +
    weights.price_match;
  const weightedBase =
    baseWeightSum === 0
      ? 0
      : (weights.category_match * categoryAffinity +
          weights.style_match * styleAffinity +
          weights.color_match * colorAffinity +
          weights.brand_match * brandAffinity +
          weights.fit_match * fitAffinity +
          weights.price_match * priceFit) /
        baseWeightSum;

  const total =
    weightedBase * baseWeightSum +
    weights.context * sessionAffinity +
    weights.freshness * freshness +
    weights.novelty * novelty +
    weights.try_shop_boost * tryShopBoost +
    weights.deal_match * deal -
    weights.negative_signal * softNegative +
    noise;

  const breakdown: ScoreBreakdown = {
    weighted_base: weightedBase,
    long_term_affinity: longTermAffinity,
    session_affinity: sessionAffinity,
    style_affinity: styleAffinity,
    color_affinity: colorAffinity,
    fit_affinity: fitAffinity,
    category_affinity: categoryAffinity,
    brand_affinity: brandAffinity,
    price_fit: priceFit,
    freshness,
    novelty,
    try_shop_boost: tryShopBoost,
    deal,
    soft_negative: softNegative,
    controlled_noise: noise,
    total,
    dominant_color: candidate.colors[0] ?? null,
  };

  return { candidate, breakdown };
};

export const rankCandidates = (
  candidates: ScoringCandidate[],
  profile: StyleProfileSnapshot,
  session: SessionIntent,
  config: RecsScoringConfig,
  nowMs: number,
  userId: string,
): ScoredCandidate[] =>
  candidates
    .map((candidate) =>
      scoreCandidate(candidate, profile, session, config, nowMs, userId),
    )
    .sort((left, right) => right.breakdown.total - left.breakdown.total);

export const matchesHardConstraints = (
  candidate: ScoringCandidate,
  session: SessionIntent,
): boolean => {
  const { category, gender } = session.constraints;
  if (category !== null && candidate.category !== category) {
    return false;
  }
  if (gender !== null) {
    if (candidate.gender !== gender && candidate.gender !== 'unisex') {
      return false;
    }
  }
  return true;
};

import type {
  DiversityMix,
  NegativePreference,
  RecsScoringConfig,
  ScoringWeights,
  StyleProfileSnapshot,
  StyleTagPrior,
  TrendScoringBoost,
  WeightMap,
} from './types.ts';
import {
  DEFAULT_RECS_CONFIG,
  DEFAULT_SCORING_WEIGHTS,
  DEFAULT_TREND_SCORING_BOOST,
  emptyStyleProfile,
} from './scoring.ts';

export interface RecsConfigRow {
  key: string;
  value: unknown;
  updated_at: string;
}

export interface StyleTagPriorRow {
  tag: string;
  subcategory_w: unknown;
  fit_w: unknown;
  color_w: unknown;
}

export interface StyleProfileRow {
  user_id: string;
  color_w: unknown;
  subcategory_w: unknown;
  brand_w: unknown;
  fit_w: unknown;
  price_band_w: unknown;
  style_tag_weights: unknown;
  negative_preferences: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const parseWeightMap = (value: unknown): WeightMap => {
  if (!isRecord(value)) {
    return {};
  }
  const map: WeightMap = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      map[key] = raw;
    } else if (typeof raw === 'string' && Number.isFinite(Number(raw))) {
      map[key] = Number(raw);
    }
  }
  return map;
};

const parseScoringWeights = (value: unknown): ScoringWeights => {
  const map = parseWeightMap(value);
  return {
    category_match: map.category_match ?? DEFAULT_SCORING_WEIGHTS.category_match,
    style_match: map.style_match ?? DEFAULT_SCORING_WEIGHTS.style_match,
    color_match: map.color_match ?? DEFAULT_SCORING_WEIGHTS.color_match,
    brand_match: map.brand_match ?? DEFAULT_SCORING_WEIGHTS.brand_match,
    fit_match: map.fit_match ?? DEFAULT_SCORING_WEIGHTS.fit_match,
    price_match: map.price_match ?? DEFAULT_SCORING_WEIGHTS.price_match,
    negative_signal:
      map.negative_signal ?? DEFAULT_SCORING_WEIGHTS.negative_signal,
    novelty: map.novelty ?? DEFAULT_SCORING_WEIGHTS.novelty,
    freshness: map.freshness ?? DEFAULT_SCORING_WEIGHTS.freshness,
    context: map.context ?? DEFAULT_SCORING_WEIGHTS.context,
    try_shop_boost:
      map.try_shop_boost ?? DEFAULT_SCORING_WEIGHTS.try_shop_boost,
    deal_match: map.deal_match ?? DEFAULT_SCORING_WEIGHTS.deal_match,
  };
};

const parseDiversityMix = (value: unknown): DiversityMix => {
  const map = parseWeightMap(value);
  return {
    preferred: map.preferred ?? DEFAULT_RECS_CONFIG.diversityMix.preferred,
    similar: map.similar ?? DEFAULT_RECS_CONFIG.diversityMix.similar,
    complementary:
      map.complementary ?? DEFAULT_RECS_CONFIG.diversityMix.complementary,
    discovery: map.discovery ?? DEFAULT_RECS_CONFIG.diversityMix.discovery,
  };
};

const parseTrendScoringBoost = (value: unknown): TrendScoringBoost => {
  const map = parseWeightMap(value);
  return {
    freshness: map.freshness ?? DEFAULT_TREND_SCORING_BOOST.freshness,
    novelty: map.novelty ?? DEFAULT_TREND_SCORING_BOOST.novelty,
    context: map.context ?? DEFAULT_TREND_SCORING_BOOST.context,
    style_match: map.style_match ?? DEFAULT_TREND_SCORING_BOOST.style_match,
    category_match:
      map.category_match ?? DEFAULT_TREND_SCORING_BOOST.category_match,
    color_match: map.color_match ?? DEFAULT_TREND_SCORING_BOOST.color_match,
    brand_match: map.brand_match ?? DEFAULT_TREND_SCORING_BOOST.brand_match,
    fit_match: map.fit_match ?? DEFAULT_TREND_SCORING_BOOST.fit_match,
    price_match: map.price_match ?? DEFAULT_TREND_SCORING_BOOST.price_match,
    deal_match: map.deal_match ?? DEFAULT_TREND_SCORING_BOOST.deal_match,
    preferred: map.preferred ?? DEFAULT_TREND_SCORING_BOOST.preferred,
    discovery: map.discovery ?? DEFAULT_TREND_SCORING_BOOST.discovery,
  };
};

const parseNegativePreferences = (value: unknown): NegativePreference[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const colors = Array.isArray(item.colors)
      ? item.colors.filter((color): color is string => typeof color === 'string')
      : [];
    return [
      {
        productId:
          typeof item.product_id === 'string' ? item.product_id : null,
        at: typeof item.at === 'string' ? item.at : null,
        colors,
        subcategory:
          typeof item.subcategory === 'string' ? item.subcategory : null,
        fit: typeof item.fit === 'string' ? item.fit : null,
        brandSlug:
          typeof item.brand_slug === 'string' ? item.brand_slug : null,
        priceBand:
          typeof item.price_band === 'string' ? item.price_band : null,
      },
    ];
  });
};

const readNumber = (value: unknown, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
};

export const assembleRecsConfig = (
  rows: RecsConfigRow[],
  priors: StyleTagPriorRow[],
): RecsScoringConfig => {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const scoringWeights = parseScoringWeights(byKey.get('scoring_weights')?.value);
  const diversityMix = parseDiversityMix(byKey.get('diversity_mix')?.value);
  const reasonsThresholds = parseWeightMap(
    byKey.get('reasons_thresholds')?.value,
  );
  const mix = parseWeightMap(byKey.get('scoring_mix')?.value);
  const softNegative = parseWeightMap(byKey.get('soft_negative')?.value);
  const noiseAmplitude = readNumber(
    byKey.get('noise_amplitude')?.value,
    DEFAULT_RECS_CONFIG.noiseAmplitude,
  );

  const styleTagPriors: Record<string, StyleTagPrior> = {
    ...DEFAULT_RECS_CONFIG.styleTagPriors,
  };
  for (const row of priors) {
    styleTagPriors[row.tag] = {
      subcategoryW: parseWeightMap(row.subcategory_w),
      fitW: parseWeightMap(row.fit_w),
      colorW: parseWeightMap(row.color_w),
    };
  }

  const latest = rows.reduce(
    (max, row) => (row.updated_at > max ? row.updated_at : max),
    'default',
  );

  return {
    scoringWeights,
    reasonsThresholds:
      Object.keys(reasonsThresholds).length > 0
        ? reasonsThresholds
        : DEFAULT_RECS_CONFIG.reasonsThresholds,
    diversityMix,
    noiseAmplitude,
    declaredStyleShare:
      mix.declared_style ?? DEFAULT_RECS_CONFIG.declaredStyleShare,
    behavioralStyleShare:
      mix.behavioral_style ?? DEFAULT_RECS_CONFIG.behavioralStyleShare,
    productNegativeHours:
      softNegative.product_hours ?? DEFAULT_RECS_CONFIG.productNegativeHours,
    featureNegativeScale:
      softNegative.feature_scale ?? DEFAULT_RECS_CONFIG.featureNegativeScale,
    styleTagPriors,
    configVersion: latest,
    trendScoringBoost: parseTrendScoringBoost(
      byKey.get('trend_scoring_boost')?.value,
    ),
  };
};

export const mapStyleProfileRow = (
  row: StyleProfileRow | null,
  userId: string,
): StyleProfileSnapshot => {
  if (row === null) {
    return emptyStyleProfile(userId);
  }
  return {
    userId: row.user_id,
    colorW: parseWeightMap(row.color_w),
    subcategoryW: parseWeightMap(row.subcategory_w),
    brandW: parseWeightMap(row.brand_w),
    fitW: parseWeightMap(row.fit_w),
    priceBandW: parseWeightMap(row.price_band_w),
    styleTagWeights: parseWeightMap(row.style_tag_weights),
    negativePreferences: parseNegativePreferences(row.negative_preferences),
  };
};

export const isConfigRow = (value: unknown): value is RecsConfigRow =>
  isRecord(value) &&
  typeof value.key === 'string' &&
  typeof value.updated_at === 'string';

export const isPriorRow = (value: unknown): value is StyleTagPriorRow =>
  isRecord(value) && typeof value.tag === 'string';

export const isProfileRow = (value: unknown): value is StyleProfileRow =>
  isRecord(value) && typeof value.user_id === 'string';

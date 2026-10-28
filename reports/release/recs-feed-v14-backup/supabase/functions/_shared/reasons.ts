import type {
  RecsScoringConfig,
  RecsSlot,
  ScoredCandidate,
  StyleProfileSnapshot,
} from './types.ts';
import { lookupWeight } from './scoring.ts';

const MAX_REASONS = 2;

const COLOR_LABEL_TR: Record<string, string> = {
  siyah: 'Siyah',
  beyaz: 'Beyaz',
  gri: 'Gri',
  bej: 'Bej',
  kahverengi: 'Kahverengi',
  navy: 'Lacivert',
  mavi: 'Mavi',
  kirmizi: 'Kırmızı',
  pembe: 'Pembe',
  yesil: 'Yeşil',
  sari: 'Sarı',
  turuncu: 'Turuncu',
  mor: 'Mor',
  bordo: 'Bordo',
  camel: 'Camel',
  altin: 'Altın',
  gumus: 'Gümüş',
  turkuaz: 'Turkuaz',
  krem: 'Krem',
  desenli: 'Desenli',
};

interface ReasonCandidate {
  label: string;
  contribution: number;
}

const colorLabel = (slug: string): string => COLOR_LABEL_TR[slug] ?? slug;

const topDeclaredTag = (profile: StyleProfileSnapshot): string | null => {
  let bestTag: string | null = null;
  let bestWeight = 0;
  for (const [tag, weight] of Object.entries(profile.styleTagWeights)) {
    if (weight > bestWeight) {
      bestWeight = weight;
      bestTag = tag;
    }
  }
  return bestTag;
};

/**
 * Yalnızca eşik üstü pozitif katkılar. Negatif asla. Veriyle desteklenmeyen etiket yok.
 */
export const buildReasons = (
  item: ScoredCandidate,
  slot: RecsSlot,
  profile: StyleProfileSnapshot,
  config: RecsScoringConfig,
): string[] => {
  const { breakdown, candidate } = item;
  const thresholds = config.reasonsThresholds;
  const collected: ReasonCandidate[] = [];

  const matchedColor = candidate.colors.find(
    (color) => lookupWeight(profile.colorW, color) >= (thresholds.color_match ?? 0),
  );
  if (
    breakdown.color_affinity >= (thresholds.color_match ?? 0) &&
    matchedColor !== undefined
  ) {
    collected.push({
      label: `Sevdiğin renk: ${colorLabel(matchedColor)}`,
      contribution: breakdown.color_affinity,
    });
  }

  if (
    breakdown.brand_affinity >= (thresholds.brand_match ?? 0) &&
    lookupWeight(profile.brandW, candidate.brandSlug) > 0
  ) {
    collected.push({
      label: 'Sevdiğin marka',
      contribution: breakdown.brand_affinity,
    });
  }

  if (
    breakdown.category_affinity >= (thresholds.category_match ?? 0) &&
    (lookupWeight(profile.subcategoryW, candidate.subcategory) > 0 ||
      lookupWeight(profile.subcategoryW, candidate.category) > 0)
  ) {
    collected.push({
      label: 'Bu kategoriyi sık beğeniyorsun',
      contribution: breakdown.category_affinity,
    });
  }

  if (
    breakdown.price_fit >= (thresholds.price_match ?? 0) &&
    lookupWeight(profile.priceBandW, candidate.priceBand) > 0
  ) {
    collected.push({
      label: 'Fiyat aralığına uygun',
      contribution: breakdown.price_fit,
    });
  }

  if (
    breakdown.style_affinity >= (thresholds.style_match ?? 0) &&
    topDeclaredTag(profile) === 'minimal'
  ) {
    collected.push({
      label: 'Minimal stiline yakın',
      contribution: breakdown.style_affinity,
    });
  }

  if (slot === 'exploration' || slot === 'discovery') {
    if (
      candidate.impressionCount <= 1 ||
      breakdown.novelty >= 0.5 ||
      breakdown.long_term_affinity < 0.25
    ) {
      collected.push({
        label: 'Yeni bir şey dene',
        contribution: Math.max(breakdown.novelty, 0.4),
      });
    }
  }

  return collected
    .filter((itemReason) => itemReason.contribution > 0)
    .sort((left, right) => right.contribution - left.contribution)
    .slice(0, MAX_REASONS)
    .map((itemReason) => itemReason.label);
};

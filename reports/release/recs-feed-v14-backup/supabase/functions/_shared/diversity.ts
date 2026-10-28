import type {
  DiversityMix,
  RankedCandidate,
  RecsSlot,
  ScoredCandidate,
  SessionIntent,
} from './types.ts';
import { buildReasons } from './reasons.ts';
import type { RecsScoringConfig, StyleProfileSnapshot } from './types.ts';

const FIRST_WINDOW = 8;
const MAX_BRAND_IN_WINDOW = 2;
const MAX_SUBCATEGORY_IN_WINDOW = 3;
const CATALOG_NEW_DAYS = 14;
const LOW_AFFINITY = 0.25;
const MS_PER_DAY = 86_400_000;
const EXPLORATION_EVERY = 10;

const COMPLEMENTARY_CATEGORIES: Record<string, readonly string[]> = {
  upper_body: ['lower_body', 'dresses'],
  lower_body: ['upper_body'],
  dresses: ['upper_body', 'lower_body'],
};

export const complementaryCategories = (category: string): readonly string[] =>
  COMPLEMENTARY_CATEGORIES[category] ?? [];

export const medianOf = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  const midValue = sorted[mid];
  if (sorted.length % 2 === 1) {
    return midValue ?? 0;
  }
  const before = sorted[mid - 1];
  if (midValue === undefined || before === undefined) {
    return 0;
  }
  return (before + midValue) / 2;
};

export const isExplorationCandidate = (
  item: ScoredCandidate,
  medianBase: number,
  nowMs: number,
): boolean => {
  if (item.candidate.impressionCount <= 1) {
    return true;
  }
  if (
    item.candidate.createdAtMs > 0 &&
    nowMs - item.candidate.createdAtMs <= CATALOG_NEW_DAYS * MS_PER_DAY
  ) {
    return true;
  }
  return (
    item.breakdown.long_term_affinity < LOW_AFFINITY &&
    item.breakdown.weighted_base >= medianBase
  );
};

const countInWindow = (
  result: ScoredCandidate[],
  keyOf: (item: ScoredCandidate) => string,
  key: string,
): number => {
  const windowItems = result.slice(0, FIRST_WINDOW);
  let count = 0;
  for (const item of windowItems) {
    if (keyOf(item) === key) {
      count += 1;
    }
  }
  return count;
};

interface DiversityStrictness {
  brand: boolean;
  subcategory: boolean;
  color: boolean;
}

const wouldViolate = (
  result: ScoredCandidate[],
  next: ScoredCandidate,
  strict: DiversityStrictness,
): boolean => {
  const inWindow = result.length < FIRST_WINDOW;
  if (inWindow && strict.brand) {
    const brandCount = countInWindow(
      result,
      (item) => item.candidate.brandSlug,
      next.candidate.brandSlug,
    );
    if (brandCount >= MAX_BRAND_IN_WINDOW) {
      return true;
    }
  }
  if (inWindow && strict.subcategory) {
    const subCount = countInWindow(
      result,
      (item) => item.candidate.subcategory,
      next.candidate.subcategory,
    );
    if (subCount >= MAX_SUBCATEGORY_IN_WINDOW) {
      return true;
    }
  }
  if (strict.color && result.length > 0) {
    const previous = result[result.length - 1];
    const prevColor = previous?.breakdown.dominant_color;
    const nextColor = next.breakdown.dominant_color;
    if (
      prevColor !== null &&
      nextColor !== null &&
      prevColor === nextColor
    ) {
      return true;
    }
  }
  return false;
};

const pickWithDiversity = (
  pool: ScoredCandidate[],
  result: ScoredCandidate[],
): ScoredCandidate | null => {
  const levels: DiversityStrictness[] = [
    { brand: true, subcategory: true, color: true },
    { brand: true, subcategory: true, color: false },
    { brand: true, subcategory: false, color: false },
    { brand: false, subcategory: false, color: false },
  ];
  for (const strict of levels) {
    for (const item of pool) {
      if (!wouldViolate(result, item, strict)) {
        return item;
      }
    }
  }
  return pool[0] ?? null;
};

export const buildSlotPlan = (
  limit: number,
  mix: DiversityMix,
): RecsSlot[] => {
  const preferred = Math.max(0, Math.round(mix.preferred * limit));
  const similar = Math.max(0, Math.round(mix.similar * limit));
  const complementary = Math.max(0, Math.round(mix.complementary * limit));
  let discovery = limit - preferred - similar - complementary;
  if (discovery < 0) {
    discovery = 0;
  }
  const plan: RecsSlot[] = [
    ...Array<RecsSlot>(preferred).fill('preferred'),
    ...Array<RecsSlot>(similar).fill('similar'),
    ...Array<RecsSlot>(complementary).fill('complementary'),
    ...Array<RecsSlot>(discovery).fill('discovery'),
  ];
  while (plan.length < limit) {
    plan.push('preferred');
  }
  const trimmed = plan.slice(0, limit);
  for (let index = EXPLORATION_EVERY - 1; index < trimmed.length; index += EXPLORATION_EVERY) {
    trimmed[index] = 'exploration';
  }
  return trimmed;
};

const matchesSimilar = (
  item: ScoredCandidate,
  session: SessionIntent,
  anchor: ScoredCandidate | null,
): boolean => {
  const subcategory =
    session.lastSubcategory ?? anchor?.candidate.subcategory ?? null;
  if (subcategory !== null && item.candidate.subcategory === subcategory) {
    return true;
  }
  const colors = anchor?.candidate.colors ?? [];
  return item.candidate.colors.some((color) => colors.includes(color));
};

const matchesComplementary = (
  item: ScoredCandidate,
  session: SessionIntent,
  anchor: ScoredCandidate | null,
): boolean => {
  const category = session.lastCategory ?? anchor?.candidate.category ?? null;
  if (category === null) {
    return false;
  }
  return complementaryCategories(category).includes(item.candidate.category);
};

export const rerankForDiversity = (
  scored: ScoredCandidate[],
  session: SessionIntent,
  config: RecsScoringConfig,
  profile: StyleProfileSnapshot,
  limit: number,
  nowMs: number,
): RankedCandidate[] => {
  if (scored.length === 0 || limit <= 0) {
    return [];
  }

  const medianBase = medianOf(scored.map((item) => item.breakdown.weighted_base));
  const used = new Set<string>();
  const picked: ScoredCandidate[] = [];
  const slots: RecsSlot[] = [];
  const plan = buildSlotPlan(limit, config.diversityMix);
  const anchor = scored[0] ?? null;

  const remaining = (): ScoredCandidate[] =>
    scored.filter((item) => !used.has(item.candidate.id));

  for (const slot of plan) {
    const pool = remaining();
    if (pool.length === 0) {
      break;
    }

    let filtered: ScoredCandidate[] = pool;
    if (slot === 'similar') {
      const similar = pool.filter((item) => matchesSimilar(item, session, anchor));
      if (similar.length > 0) {
        filtered = similar;
      }
    } else if (slot === 'complementary') {
      const complementary = pool.filter((item) =>
        matchesComplementary(item, session, anchor),
      );
      if (complementary.length > 0) {
        filtered = complementary;
      }
    } else if (slot === 'discovery' || slot === 'exploration') {
      const exploration = pool.filter((item) =>
        isExplorationCandidate(item, medianBase, nowMs),
      );
      if (exploration.length > 0) {
        filtered = exploration;
      }
    }

    const chosen = pickWithDiversity(filtered, picked);
    if (!chosen) {
      break;
    }
    used.add(chosen.candidate.id);
    picked.push(chosen);
    slots.push(slot);
  }

  return picked.map((item, index) => {
    const slot = slots[index] ?? 'preferred';
    return {
      ...item,
      slot,
      reasons: buildReasons(item, slot, profile, config),
      position: index,
    };
  });
};

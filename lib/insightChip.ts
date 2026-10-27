import type { Product } from '../types/product';
import { PRICE_BAND_REASON_LABEL } from './displayReason';
import { INSIGHT_CHIP_COPY, WARDROBE_CATEGORY_LABEL_TR } from './insightChipTemplates';

/** Öncelik sırasıyla; seçici bu sırayı izler. */
export const INSIGHT_CHIP_PRIORITY = [
  'wardrobe_match',
  'completes_wardrobe',
  'style_fit',
  'budget',
  'discovery',
] as const;

export type InsightChipKind = (typeof INSIGHT_CHIP_PRIORITY)[number];

/** Fiyat bandı chip'i için en az beğeni sayısı; tek beğeniden bant "öğrenilmiş" sayılmaz. */
export const BUDGET_CHIP_MIN_LIKES = 5;
/** Dolap kanıtlı chip'ler için dolapta olması gereken en az parça. */
export const MIN_WARDROBE_ITEMS_FOR_INSIGHT = 3;
/** Aynı tür en fazla bu kadar ardışık kartta görünür. */
export const MAX_CONSECUTIVE_SAME_KIND = 2;

const MAX_EVIDENCE = 3;

export interface InsightWardrobeItem {
  id: string;
  category: string;
  subcategory?: string | null;
  colorSlugs?: readonly string[];
  imageUrl?: string;
}

export interface InsightEvidence {
  id: string;
  label: string;
  source: 'wardrobe' | 'profile' | 'product';
  imageUrl?: string;
}

export interface InsightChip {
  kind: InsightChipKind;
  label: string;
  summary: string;
  evidence: InsightEvidence[];
  /** Yalnız dolap eşleşmesinde: chip'te küçük görseli çizilen parça. */
  matchedItem?: InsightWardrobeItem;
}

export interface ReasonSignal {
  kind: 'style_fit' | 'budget' | 'discovery';
  label: string;
}

export interface InsightChipContext {
  /** recs-feed `reasons`; eski önbellek kayıtlarında eksik veya bozuk olabilir. */
  reasons: unknown;
  wardrobe: readonly InsightWardrobeItem[];
  likeCount: number;
  /** Önceki kartların türleri (en yenisi sonda); chip'siz kart null. */
  recentKinds: readonly (InsightChipKind | null)[];
  hiddenKinds?: ReadonlySet<InsightChipKind>;
}

export const isWardrobeEvidenceKind = (kind: InsightChipKind): boolean =>
  kind === 'wardrobe_match' || kind === 'completes_wardrobe';

const STYLE_REASON_LABELS = new Set(['Sevdiğin marka', 'Bu kategoriyi sık beğeniyorsun', 'Minimal stiline yakın']);
const COLOR_REASON_PREFIX = 'Sevdiğin renk:';
const DISCOVERY_REASON_LABEL = 'Yeni bir şey dene';

/** buildReasons etiketlerini chip sinyallerine çevirir; tanınmayan veya bozuk girdiyi atlar. */
export const parseReasonSignals = (reasons: unknown): ReasonSignal[] => {
  if (!Array.isArray(reasons)) return [];
  const signals: ReasonSignal[] = [];
  for (const reason of reasons) {
    if (typeof reason !== 'string') continue;
    const label = reason.trim();
    if (label.length === 0) continue;
    if (label.startsWith(COLOR_REASON_PREFIX) || STYLE_REASON_LABELS.has(label)) {
      signals.push({ kind: 'style_fit', label });
    } else if (label === PRICE_BAND_REASON_LABEL) {
      signals.push({ kind: 'budget', label });
    } else if (label === DISCOVERY_REASON_LABEL) {
      signals.push({ kind: 'discovery', label });
    }
  }
  return signals;
};

/** Kombinlenebilir kategori çiftleri; dolap kanıtı yalnız bunlardan sayılır. */
const COMPLEMENTS: Record<string, readonly string[]> = {
  upper_body: ['lower_body', 'shoes', 'bags'],
  lower_body: ['upper_body', 'shoes', 'bags'],
  dresses: ['shoes', 'bags', 'accessories'],
  shoes: ['upper_body', 'lower_body', 'dresses'],
  bags: ['upper_body', 'lower_body', 'dresses'],
  hats: ['upper_body', 'dresses'],
  accessories: ['upper_body', 'dresses'],
};

const wardrobeEvidence = (item: InsightWardrobeItem): InsightEvidence => ({
  id: item.id,
  label: INSIGHT_CHIP_COPY.wardrobeEvidence(WARDROBE_CATEGORY_LABEL_TR[item.category] ?? item.category),
  source: 'wardrobe',
  imageUrl: item.imageUrl,
});

const productEvidence = (product: Product): InsightEvidence => ({
  id: product.id,
  label: INSIGHT_CHIP_COPY.productEvidence,
  source: 'product',
  imageUrl: product.imageUrl,
});

const chip = (kind: InsightChipKind, evidence: InsightEvidence[], matchedItem?: InsightWardrobeItem): InsightChip => ({
  kind,
  label: INSIGHT_CHIP_COPY.chipLabel[kind],
  summary: INSIGHT_CHIP_COPY.sheetSummary[kind],
  evidence,
  ...(matchedItem ? { matchedItem } : {}),
});

const candidateChips = (product: Product, context: InsightChipContext): Map<InsightChipKind, () => InsightChip> => {
  const candidates = new Map<InsightChipKind, () => InsightChip>();
  const wardrobe = context.wardrobe;
  if (wardrobe.length >= MIN_WARDROBE_ITEMS_FOR_INSIGHT) {
    const complements = COMPLEMENTS[product.category] ?? [];
    const pairable = wardrobe.filter(item => complements.includes(item.category));
    const productColors = new Set(product.colorSlugs ?? []);
    const match = pairable.find(item => (item.colorSlugs ?? []).some(color => productColors.has(color)));
    if (match) {
      candidates.set('wardrobe_match', () => chip('wardrobe_match', [wardrobeEvidence(match), productEvidence(product)], match));
    }
    const ownsCategory = wardrobe.some(item => item.category === product.category);
    if (!ownsCategory && pairable.length > 0) {
      candidates.set('completes_wardrobe', () =>
        chip('completes_wardrobe', [...pairable.slice(0, MAX_EVIDENCE).map(wardrobeEvidence), productEvidence(product)]));
    }
  }
  for (const signal of parseReasonSignals(context.reasons)) {
    if (candidates.has(signal.kind)) continue;
    if (signal.kind === 'budget' && context.likeCount < BUDGET_CHIP_MIN_LIKES) continue;
    const evidence: InsightEvidence[] = [productEvidence(product)];
    if (signal.kind === 'style_fit') {
      const labels = parseReasonSignals(context.reasons).filter(item => item.kind === 'style_fit').slice(0, MAX_EVIDENCE);
      evidence.push(...labels.map((item, index) => ({ id: `reason:${index}`, label: item.label, source: 'profile' as const })));
    } else if (signal.kind === 'budget') {
      evidence.push({ id: 'likes', label: INSIGHT_CHIP_COPY.likeEvidence(context.likeCount), source: 'profile' });
    }
    candidates.set(signal.kind, () => chip(signal.kind, evidence));
  }
  return candidates;
};

const isCapped = (kind: InsightChipKind, recentKinds: readonly (InsightChipKind | null)[]): boolean => {
  if (recentKinds.length < MAX_CONSECUTIVE_SAME_KIND) return false;
  return recentKinds.slice(-MAX_CONSECUTIVE_SAME_KIND).every(recent => recent === kind);
};

/** Saf seçici: kanıtı olan en yüksek öncelikli, sınıra takılmayan tek chip; yoksa null. */
export const selectInsightChip = (product: Product, context: InsightChipContext): InsightChip | null => {
  const candidates = candidateChips(product, context);
  for (const kind of INSIGHT_CHIP_PRIORITY) {
    const build = candidates.get(kind);
    if (!build || context.hiddenKinds?.has(kind) || isCapped(kind, context.recentKinds)) continue;
    return build();
  }
  return null;
};

export interface InsightChipSequence {
  /** Bir kez atanan chip sabit kalır; deste kısalınca kart etiketi değişmez. */
  chips: ReadonlyMap<string, InsightChip | null>;
  recentKinds: readonly (InsightChipKind | null)[];
}

export const createInsightChipSequence = (): InsightChipSequence => ({ chips: new Map(), recentKinds: [] });

/** Desteyi sırayla dolaşır; yeni ürünlere chip atar, frekans sınırını atama sırasına uygular. */
export const assignInsightChips = (
  products: readonly Product[],
  context: Omit<InsightChipContext, 'reasons' | 'recentKinds'>,
  previous: InsightChipSequence,
): InsightChipSequence => {
  let chips: Map<string, InsightChip | null> | null = null;
  let recentKinds = previous.recentKinds;
  for (const product of products) {
    if (previous.chips.has(product.id) || chips?.has(product.id)) continue;
    const selected = selectInsightChip(product, { ...context, reasons: product.reasons, recentKinds });
    chips ??= new Map(previous.chips);
    chips.set(product.id, selected);
    recentKinds = [...recentKinds, selected?.kind ?? null].slice(-MAX_CONSECUTIVE_SAME_KIND);
  }
  return chips ? { chips, recentKinds } : previous;
};

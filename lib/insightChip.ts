import type { Product } from '../types/product';
import { colorCompatibility, evaluatePair, pairEvidenceKinds } from '../src/intelligence/pairing/pairing';
import { evidenceCopy } from './insightChipEvidence';
import type { PairItem } from '../src/intelligence/pairing/pairingTypes';
import { fromWardrobe } from '../src/intelligence/pairing/wardrobePairing';
import { UPPER_SUBCATEGORY_ROLE } from '../src/intelligence/pairing/outfitRules';
import { ACTIVE_CATALOG_PAIRING_POLICY, pairItemFromProduct } from '../src/intelligence/recommendations/catalogPairing';
import { PRICE_BAND_REASON_LABEL } from './displayReason';
import { INSIGHT_CHIP_COPY, WARDROBE_CATEGORY_LABEL_TR } from './insightChipTemplates';
import { COLORS, isUnknownSubtype, isValidSubtype, subtypesForCategory } from './styleVocabulary';
import { isGarmentCategory } from '../types/product';

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
  /** Profilde beyan edilen bütçe; verilmişse fiyatı aralığın dışındaki ürün için bütçe chip'i çıkmaz. */
  declaredPriceRange?: { min: number; max: number } | null;
  /** Önceki kartların türleri (en yenisi sonda); chip'siz kart null. */
  recentKinds: readonly (InsightChipKind | null)[];
  hiddenKinds?: ReadonlySet<InsightChipKind>;
}

export const isWardrobeEvidenceKind = (kind: InsightChipKind): boolean =>
  kind === 'wardrobe_match' || kind === 'completes_wardrobe';

/** "Neden bu öneri?" sayfası: ürünün kendisi dışında kanıt yoksa dayanak gizli; dolap butonu yalnız dolap kanıtlı türlerde. */
export const getInsightWhySheetVisibility = (chip: InsightChip) => ({
  showEvidence: chip.evidence.some(item => item.source !== 'product'),
  showWardrobeButton: isWardrobeEvidenceKind(chip.kind),
});

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

/** Wardrobe subtype the user chose from the vocabulary; anything else is not trusted as evidence. */
const reliableSubtype = (item: InsightWardrobeItem): string | null => {
  const subtype = item.subcategory?.trim();
  return subtype && isGarmentCategory(item.category) && isValidSubtype(item.category, subtype) && !isUnknownSubtype(subtype)
    ? subtype : null;
};

const knownColors = (item: InsightWardrobeItem): string[] =>
  (item.colorSlugs ?? []).map(slug => slug.trim().toLocaleLowerCase('tr-TR')).filter(slug => COLORS.some(color => color.slug === slug));

/** "lacivert jean": written only when both a known color and a valid subtype are reliable. */
const describeWardrobeItem = (item: InsightWardrobeItem): string => {
  const subtype = reliableSubtype(item);
  const slug = knownColors(item)[0];
  const color = slug ? COLORS.find(entry => entry.slug === slug)?.label : undefined;
  const label = subtype && isGarmentCategory(item.category)
    ? subtypesForCategory(item.category).find(entry => entry.slug === subtype)?.label : undefined;
  return color && label
    ? `${color} ${label}`.toLocaleLowerCase('tr-TR')
    : WARDROBE_CATEGORY_LABEL_TR[item.category] ?? item.category;
};

const wardrobeEvidence = (item: InsightWardrobeItem): InsightEvidence => ({
  id: item.id,
  label: INSIGHT_CHIP_COPY.wardrobeEvidence(describeWardrobeItem(item)),
  source: 'wardrobe',
  imageUrl: item.imageUrl,
});

const productEvidence = (product: Product): InsightEvidence => ({
  id: product.id,
  label: INSIGHT_CHIP_COPY.productEvidence,
  source: 'product',
  imageUrl: product.imageUrl,
});

const chip = (
  kind: InsightChipKind,
  evidence: InsightEvidence[],
  matchedItem?: InsightWardrobeItem,
  text?: { label: string; summary: string },
): InsightChip => ({
  kind,
  label: text?.label ?? INSIGHT_CHIP_COPY.chipLabel[kind],
  summary: text?.summary ?? INSIGHT_CHIP_COPY.sheetSummary[kind],
  evidence,
  ...(matchedItem ? { matchedItem } : {}),
});

/** The product's pairing view; an upper-body product without a role gets one from its subtype only. */
const chipSubject = (product: Product): PairItem => {
  const item = pairItemFromProduct(product);
  if (item.role.value !== null || product.category !== 'upper_body') return item;
  const role = product.subcategory ? UPPER_SUBCATEGORY_ROLE[product.subcategory.trim().toLocaleLowerCase('tr-TR')] : undefined;
  return role ? { ...item, role: { value: role, source: 'category_rule', confidence: 'high' } } : item;
};

const wardrobePair = (item: InsightWardrobeItem): PairItem =>
  fromWardrobe({ ...item, subcategory: reliableSubtype(item), colorSlugs: knownColors(item) });

/** Eligible by the pairing decision AND a complementary (distinct body slot) role relation. */
const isComplementary = (subject: PairItem, partner: PairItem): boolean => {
  if (subject.role.value === null) return false;
  const decision = evaluatePair({ anchor: subject, candidate: partner, sessionGender: null, policy: ACTIVE_CATALOG_PAIRING_POLICY });
  return decision.outcome === 'eligible'
    && decision.checks.find(check => check.check === 'role')?.code === 'role_complementary';
};

const candidateChips = (product: Product, context: InsightChipContext): Map<InsightChipKind, () => InsightChip> => {
  const candidates = new Map<InsightChipKind, () => InsightChip>();
  const wardrobe = context.wardrobe;
  if (wardrobe.length >= MIN_WARDROBE_ITEMS_FOR_INSIGHT) {
    // The pairing module decides (Faz 4 S4): the chip needs an eligible pair whose roles are
    // complementary and whose colors are both known. An unknown color or role means no chip.
    const subject = chipSubject(product);
    const pairable = wardrobe.filter(item => {
      const partner = wardrobePair(item);
      return colorCompatibility(subject, partner) !== 'unknown' && isComplementary(subject, partner);
    });
    const match = pairable.find(item => colorCompatibility(subject, wardrobePair(item)) === 'compatible');
    // The text names only the evidence the pairing module found; no evidence text, no chip.
    const text = match ? evidenceCopy(pairEvidenceKinds(subject, wardrobePair(match), ACTIVE_CATALOG_PAIRING_POLICY)) : null;
    if (match && text) {
      candidates.set('wardrobe_match', () => chip('wardrobe_match', [wardrobeEvidence(match), productEvidence(product)], match, text));
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
    if (signal.kind === 'budget' && context.declaredPriceRange
      && (product.price < context.declaredPriceRange.min || product.price > context.declaredPriceRange.max)) continue;
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

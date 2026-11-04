import {
  STYLE_JOURNEY_GOALS, STYLE_VALUE_LABELS, type DeclaredKey, type JourneyTarget, type StyleJourney,
} from './profileStyleJourney';
import {
  brandLabel, colorHex, colorName, displayLabel, fitShape, priceBandIndex, uniqueLabels,
} from './profileDisplay';

// View model of the Profile tab. Pure: reads a StyleJourney, writes nothing, calls nothing.

/** Fewer distinct evaluations than this and a learned box is an empty state, not a trend. */
export const STYLE_TREND_MIN_EVALUATIONS = 5;
export const PREFERENCE_TOTAL = 5;
const LEARNED_SHOWN = 2;
const DECLARED_SHOWN = 3;
const LOADING_TEXT = 'Yükleniyor';

export type DeclarationSection = 'style' | 'body' | 'colors' | 'brands' | 'budget';

export interface JourneyBox {
  id: 'liked' | 'wardrobe' | 'preferences';
  label: string;
  value: string;
  state: 'complete' | 'missing' | 'loading';
  target: JourneyTarget;
}

export function buildJourneyBoxes(journey: StyleJourney): JourneyBox[] {
  const { counts, ready } = journey;
  const goals = STYLE_JOURNEY_GOALS;
  const box = (id: JourneyBox['id'], label: string, value: number | string, complete: boolean,
    loading: boolean, target: JourneyTarget): JourneyBox => ({
    id, label, target,
    value: loading ? LOADING_TEXT : String(value),
    state: loading ? 'loading' : complete ? 'complete' : 'missing',
  });
  return [
    box('liked', 'Beğeni', `${counts.liked} beğeni · ${counts.passed} geçilen`, counts.evaluations >= goals.evaluations, !ready.ratings, 'discover'),
    box('wardrobe', 'Dolap parçası', counts.wardrobe, counts.wardrobe >= goals.wardrobe, !ready.wardrobe, 'wardrobe'),
    box('preferences', 'Tercih', `${counts.preferences}/${PREFERENCE_TOTAL}`, counts.preferences >= PREFERENCE_TOTAL, false, 'preferences'),
  ];
}

export interface JourneyStep {
  id: JourneyBox['id'];
  number: 1 | 2 | 3;
  label: string;
  state: 'complete' | 'current' | 'upcoming' | 'loading';
  target: JourneyTarget;
}
export interface JourneyStepper {
  /** Distinct liked-or-passed products; null while ratings are not trustworthy. */
  total: number | null;
  subline: string | null;
  steps: JourneyStep[];
  next: { text: string; target: JourneyTarget } | null;
}

export function buildJourneyStepper(journey: StyleJourney): JourneyStepper {
  const boxes = buildJourneyBoxes(journey);
  const { counts } = journey;
  const goals = STYLE_JOURNEY_GOALS;
  const currentIndex = boxes.findIndex(box => box.state === 'missing');
  const labels: Record<JourneyBox['id'], string> = {
    liked: 'Beğeni',
    wardrobe: `Dolap ${counts.wardrobe}/${goals.wardrobe} parça`,
    preferences: `Tercih ${counts.preferences}/${PREFERENCE_TOTAL}`,
  };
  const loadingLabels: Record<JourneyBox['id'], string> = { liked: 'Yükleniyor', wardrobe: 'Dolap · Yükleniyor', preferences: 'Yükleniyor' };
  const steps = boxes.map((box, index): JourneyStep => ({
    id: box.id, number: (index + 1) as 1 | 2 | 3, target: box.target,
    label: box.state === 'loading' ? loadingLabels[box.id] : labels[box.id],
    state: box.state === 'missing' ? (index === currentIndex ? 'current' : 'upcoming') : box.state,
  }));
  const current = currentIndex < 0 ? null : boxes[currentIndex];
  const nextText = !current ? null : current.id === 'liked' ? 'Biraz daha beğen'
    : current.id === 'wardrobe' ? (counts.wardrobe === 0 ? 'Dolabına ilk parçanı ekle' : 'Dolabına parça ekle')
      : 'Tercihlerini belirt';
  return {
    total: journey.ready.ratings ? counts.evaluations : null,
    subline: journey.ready.ratings ? boxes[0].value : null,
    steps,
    next: current && nextText ? { text: nextText, target: current.target } : null,
  };
}

export const evaluationLine = (journey: StyleJourney): string | null =>
  journey.ready.ratings ? `Önerilerin şu an ${journey.counts.evaluations} değerlendirmene dayanıyor.` : null;

export type TileId = 'color' | 'category' | 'fit' | 'brand' | 'price';
export interface StyleTile {
  id: TileId;
  title: string;
  section: DeclarationSection;
  /** Only dimensions with their own declaration flow offer a "seç" button in the source sheet. */
  cta: boolean;
  state: 'learned' | 'declared' | 'empty' | 'loading';
  label: 'Senin seçimin' | null;
  emptyText: string | null;
  valueText: string;
  names: string[];
  swatches: string[];
  brands: string[];
  /** Learned price: band index (0-3), three-step tier (0-2) and the band name. */
  band: { index: number; tier: number; label: string } | null;
  declaredText: string | null;
}
export interface StyleGridModel {
  state: 'loading' | 'error' | 'ready';
  tiles: StyleTile[];
  errorText: string | null;
}

const DEFINITIONS: ReadonlyArray<{ id: TileId; title: string; section: DeclarationSection; cta: boolean }> = [
  { id: 'color', title: 'Renk', section: 'colors', cta: true },
  { id: 'category', title: 'Parça', section: 'style', cta: false },
  { id: 'fit', title: 'Kesim', section: 'body', cta: false },
  { id: 'brand', title: 'Marka', section: 'brands', cta: true },
  { id: 'price', title: 'Fiyat', section: 'budget', cta: true },
];

const emptyTile = (definition: (typeof DEFINITIONS)[number]): StyleTile => ({
  id: definition.id, title: definition.title, section: definition.section, cta: definition.cta,
  state: 'empty', label: null, emptyText: null, valueText: '', names: [], swatches: [],
  brands: [], band: null, declaredText: null,
});

const money = (value: number) => `₺${value.toLocaleString('tr-TR')}`;

function declaredTile(base: StyleTile, journey: StyleJourney): StyleTile | null {
  const declared = journey.declaredValues;
  const mark = { ...base, state: 'declared' as const, label: 'Senin seçimin' as const };
  if (base.id === 'color' && declared.colors.length) {
    const names = uniqueLabels(declared.colors).slice(0, DECLARED_SHOWN);
    return { ...mark, names, swatches: names.map(colorHex), valueText: names.join(', ') };
  }
  if (base.id === 'brand' && declared.brands.length) {
    const brands = uniqueLabels(declared.brands.map(brandLabel)).slice(0, DECLARED_SHOWN);
    return brands.length ? { ...mark, brands, valueText: brands.join(', ') } : null;
  }
  if (base.id === 'price' && declared.price) {
    const declaredText = `${money(declared.price.min)} – ${money(declared.price.max)}`;
    return { ...mark, declaredText, valueText: declaredText };
  }
  return null;
}

const BAND_NAME: Record<string, string> = { low: 'Uygun', mid: 'Orta', high: 'Yüksek', luxury: 'Lüks' };
const PRICE_TIERS = 3;
const KESIM_SUFFIX = /\s*kesim$/i;

function learnedTile(base: StyleTile, journey: StyleJourney): StyleTile {
  // All ranked values arrive; repeats are removed after normalisation and only then cut to the top two.
  const values = journey.insights.find(item => item.id === base.id)?.values ?? [];
  const learned = { ...base, state: 'learned' as const };
  const none: StyleTile = { ...base, emptyText: 'Yeterli veri yok', valueText: 'Yeterli veri yok' };
  if (!values.length) return none;
  const label = (value: string) => STYLE_VALUE_LABELS[value] ?? displayLabel(value);
  switch (base.id) {
    case 'color': {
      const names = uniqueLabels(values.map(colorName)).slice(0, LEARNED_SHOWN);
      return { ...learned, names, swatches: names.map(colorHex), valueText: names.join(', ') };
    }
    case 'category': {
      const names = uniqueLabels(values.map(label)).slice(0, LEARNED_SHOWN);
      return { ...learned, names, valueText: names.join(', ') };
    }
    case 'fit': {
      const names = uniqueLabels(values.filter(value => fitShape(value)).map(value => label(value).replace(KESIM_SUFFIX, '')))
        .slice(0, LEARNED_SHOWN);
      return names.length ? { ...learned, names, valueText: names.join(', ') } : none;
    }
    case 'brand': {
      const brands = uniqueLabels(values.map(brandLabel)).slice(0, LEARNED_SHOWN);
      return brands.length ? { ...learned, brands, valueText: brands.join(', ') } : none;
    }
    case 'price': {
      const index = priceBandIndex(values[0]);
      if (index < 0) return none;
      const name = BAND_NAME[values[0]] ?? label(values[0]);
      return { ...learned, band: { index, tier: Math.min(index, PRICE_TIERS - 1), label: name }, valueText: name };
    }
  }
}

export function buildStyleGrid(journey: StyleJourney): StyleGridModel {
  if (journey.insightState === 'error') {
    return { state: 'error', tiles: [], errorText: 'Stil profilin doğrulanamadı.' };
  }
  const loading = journey.insightState === 'loading' || !journey.ready.ratings;
  const tiles = DEFINITIONS.map((definition): StyleTile => {
    const base = emptyTile(definition);
    const declared = declaredTile(base, journey);
    if (declared) return declared;
    if (loading) return { ...base, state: 'loading', emptyText: LOADING_TEXT, valueText: LOADING_TEXT };
    if (journey.counts.evaluations < STYLE_TREND_MIN_EVALUATIONS) {
      return { ...base, emptyText: 'Biraz daha beğen', valueText: 'Biraz daha beğen' };
    }
    return learnedTile(base, journey);
  });
  return { state: journey.insightState === 'loading' ? 'loading' : 'ready', tiles, errorText: null };
}

export interface SourceSheetModel {
  tile: StyleTile;
  title: string;
  valueText: string;
  declared: boolean;
  heading: 'Nereden öğrendik?';
  sources: Array<{ id: 'liked' | 'passed' | 'wardrobe'; label: string; count: number; fraction: number }>;
  sourceNote: string;
  note: string;
  button: { label: string; section: DeclarationSection } | null;
}

export function buildSourceSheet(tile: StyleTile, journey: StyleJourney): SourceSheetModel {
  const declared = tile.state === 'declared';
  const { liked, passed, wardrobe } = journey.counts;
  const total = liked + passed + wardrobe;
  const part = (id: 'liked' | 'passed' | 'wardrobe', label: string, count: number) =>
    ({ id, label, count, fraction: total ? count / total : 0 });
  return {
    tile, declared, title: tile.title, valueText: tile.valueText, heading: 'Nereden öğrendik?',
    sources: declared ? [] : [part('liked', 'Beğeni', liked), part('passed', 'Geçilen', passed), part('wardrobe', 'Dolap', wardrobe)],
    sourceNote: 'Tüm etkileşimlerinden',
    note: declared ? 'Bu seçimi sen belirledin; öneriler buna göre çalışır.'
      : 'Bu bir tahmin. Sen seçersen öneriler senin seçimine göre çalışır.',
    button: tile.cta ? { label: `${tile.title} seç`, section: tile.section } : null,
  };
}

export interface OnlyYouBox {
  id: 'style' | 'body';
  title: string;
  value: string | null;
  section: DeclarationSection;
}

export const buildOnlyYou = (journey: StyleJourney): OnlyYouBox[] => [
  { id: 'style', title: 'Stil tarzı', value: journey.declaredValues.styleLabels.join(', ') || null, section: 'style' },
  { id: 'body', title: 'Beden', value: journey.declaredValues.body, section: 'body' },
];

export type { DeclaredKey };

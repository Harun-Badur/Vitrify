import type { Product } from '../types/product';
import { getDisplayPrice } from '../types/product';
import type {
  SessionIntent,
  SessionIntentConstraints,
  SessionIntentWeights,
  WeightMap,
} from '../types/recommendation';
import { emptySessionIntent } from './scoring';
import { inferProductAttributes } from './productAttributes';

const HALF_LIFE_MS = 10 * 60 * 1000;
const MAX_MEANINGFUL_ACTIONS = 12;

export type SessionActionType =
  | 'like'
  | 'pass'
  | 'dolap_add'
  | 'try_on_success'
  | 'store_click'
  | 'search'
  | 'filter';

export interface SessionProductAttrs {
  category: string;
  subcategory: string;
  brandSlug: string;
  colors: string[];
  fit: string;
  priceBand: string;
  gender: string;
}

interface SessionAction {
  type: SessionActionType;
  atMs: number;
  productId: string | null;
  attrs: SessionProductAttrs | null;
  query: string | null;
}

const ACTION_WEIGHT: Record<SessionActionType, number> = {
  like: 1,
  pass: 0,
  dolap_add: 1.2,
  try_on_success: 2,
  store_click: 3,
  search: 0,
  filter: 0,
};

const MEANINGFUL_TYPES: ReadonlySet<SessionActionType> = new Set([
  'like',
  'pass',
  'dolap_add',
  'try_on_success',
  'store_click',
  'search',
  'filter',
]);

let actions: SessionAction[] = [];
let activeConstraints: SessionIntentConstraints = {
  category: null,
  gender: null,
  size: null,
};
let activeQuery = '';

const decayFactor = (atMs: number, nowMs: number): number =>
  0.5 ** (Math.max(0, nowMs - atMs) / HALF_LIFE_MS);

const accum = (map: WeightMap, key: string | null, delta: number): void => {
  if (key === null || key.trim().length === 0 || delta === 0) {
    return;
  }
  const normalized = key.trim().toLocaleLowerCase('tr-TR');
  map[normalized] = (map[normalized] ?? 0) + delta;
};

const normalizeMap = (map: WeightMap): WeightMap => {
  const values = Object.values(map);
  const top = values.length === 0 ? 0 : Math.max(...values);
  if (top <= 0) {
    return {};
  }
  const next: WeightMap = {};
  for (const [key, value] of Object.entries(map)) {
    next[key] = value / top;
  }
  return next;
};

export const attrsFromProduct = (product: Product): SessionProductAttrs => {
  const inferred = inferProductAttributes({
    title: product.title,
    brand: product.brand,
    price: getDisplayPrice(product),
    category: product.category,
    existingColorNames: product.colors?.map((color) => color.name),
  });
  return {
    category: product.category,
    subcategory: product.subcategory ?? inferred.subcategory,
    brandSlug: product.brandSlug ?? inferred.brand_slug,
    colors:
      product.colorSlugs && product.colorSlugs.length > 0
        ? product.colorSlugs
        : inferred.colors,
    fit: product.fit ?? inferred.fit,
    priceBand: product.priceBand ?? inferred.price_band,
    gender: product.gender ?? inferred.gender ?? '',
  };
};

export const recordSessionAction = (
  type: SessionActionType,
  params: {
    productId?: string | null;
    attrs?: SessionProductAttrs | null;
    query?: string | null;
    atMs?: number;
  } = {},
): void => {
  if (!MEANINGFUL_TYPES.has(type)) {
    return;
  }
  actions.push({
    type,
    atMs: params.atMs ?? Date.now(),
    productId: params.productId ?? null,
    attrs: params.attrs ?? null,
    query: params.query ?? null,
  });
  if (actions.length > MAX_MEANINGFUL_ACTIONS * 3) {
    actions = actions.slice(-MAX_MEANINGFUL_ACTIONS * 2);
  }
};

export const recordSessionProductAction = (
  type: SessionActionType,
  product: Product,
): void => {
  recordSessionAction(type, {
    productId: product.id,
    attrs: attrsFromProduct(product),
  });
};

export const setSessionFilters = (
  constraints: SessionIntentConstraints,
): void => {
  activeConstraints = {
    category: constraints.category ?? null,
    gender: constraints.gender ?? null,
    size: constraints.size ?? null,
  };
  recordSessionAction('filter');
};

export const setSessionQuery = (query: string): void => {
  activeQuery = query.trim();
  if (activeQuery.length > 0) {
    recordSessionAction('search', { query: activeQuery });
  }
};

export const resetSessionIntent = (): void => {
  actions = [];
  activeConstraints = { category: null, gender: null, size: null };
  activeQuery = '';
};

export const buildIntent = (nowMs: number = Date.now()): SessionIntent => {
  const recent = actions
    .filter((action) => decayFactor(action.atMs, nowMs) >= 0.05)
    .sort((left, right) => left.atMs - right.atMs)
    .slice(-MAX_MEANINGFUL_ACTIONS);

  const weights: SessionIntentWeights = {
    colorW: {},
    subcategoryW: {},
    brandW: {},
    fitW: {},
    priceBandW: {},
    categoryW: {},
  };

  let lastCategory: string | null = null;
  let lastSubcategory: string | null = null;
  let lastTryShopSubcategory: string | null = null;

  for (const action of recent) {
    const delta = ACTION_WEIGHT[action.type] * decayFactor(action.atMs, nowMs);
    const attrs = action.attrs;
    if (attrs && delta > 0) {
      for (const color of attrs.colors) {
        accum(weights.colorW, color, delta);
      }
      accum(weights.subcategoryW, attrs.subcategory, delta);
      accum(weights.brandW, attrs.brandSlug, delta);
      accum(weights.fitW, attrs.fit, delta);
      accum(weights.priceBandW, attrs.priceBand, delta);
      accum(weights.categoryW, attrs.category, delta);
      lastCategory = attrs.category;
      lastSubcategory = attrs.subcategory;
    }
    if (
      (action.type === 'try_on_success' || action.type === 'store_click') &&
      attrs
    ) {
      lastTryShopSubcategory = attrs.subcategory;
    }
  }

  const empty = emptySessionIntent();
  return {
    weights: {
      colorW: normalizeMap(weights.colorW),
      subcategoryW: normalizeMap(weights.subcategoryW),
      brandW: normalizeMap(weights.brandW),
      fitW: normalizeMap(weights.fitW),
      priceBandW: normalizeMap(weights.priceBandW),
      categoryW: normalizeMap(weights.categoryW),
    },
    constraints: { ...activeConstraints },
    query: activeQuery,
    lastCategory: lastCategory ?? empty.lastCategory,
    lastSubcategory: lastSubcategory ?? empty.lastSubcategory,
    lastTryShopSubcategory:
      lastTryShopSubcategory ?? empty.lastTryShopSubcategory,
  };
};

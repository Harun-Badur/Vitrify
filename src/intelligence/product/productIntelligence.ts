import {
  catalogMetadataRepair,
  cleanDeclaredCatalogColors,
  declaredCatalogFit,
  declaredCatalogGender,
} from '../../../lib/catalogMetadata';
import {
  CURATED_ATTRIBUTE_OVERRIDES,
  FIT_VOCAB,
  PRICE_BANDS,
  inferColorsFromText,
  inferFitFromTitle,
  inferGenderFromTitle,
  inferPriceBand,
  matchSubcategoryFromTitle,
  normalizeTitleKey,
  slugify,
  type FitSlug,
  type InferredProductAttributes,
  type PriceBand,
} from '../../../lib/productAttributes';
import {
  getDisplayPrice,
  isOutfitRole,
  type GarmentCategory,
  type OutfitRole,
  type Product,
  type ProductGender,
} from '../../../types/product';
import {
  PRODUCT_INTELLIGENCE_VERSION,
  type ProductConflictCode,
  type ProductIntelligence,
  type ProductSemanticConflict,
  type ProductSemanticField,
  type ProductSignal,
  type ProductSignalConfidence,
  type ProductSignalOrigin,
  type ProductSignalSource,
} from '../../../types/productIntelligence';
import { resolveCatalogOutfitRole, type ProductAttributeRow } from '../style/productStyle';

/** Schema columns that the repository does not select yet; absent keys stay unknown. */
export interface ProductSemanticAttributeRow extends ProductAttributeRow {
  material?: string | null;
  season?: string | null;
  occasion?: string | null;
  style_tags?: unknown;
}

export interface ProductIntelligenceInput {
  /** Base catalog product; prepared gender/color/fit/subcategory are ignored, as in enrichProduct. */
  product: Product;
  attributes?: ProductSemanticAttributeRow;
}

/** `absent`: the query succeeded without a row; `error`: the row could not be read. */
export type ProductAttributeContextStatus = 'loaded' | 'absent' | 'error';

/** Raw product_attributes evidence captured at load time, keyed by product ID. */
export interface ProductAttributeContext {
  productId: string;
  status: ProductAttributeContextStatus;
  attributes: Readonly<ProductSemanticAttributeRow> | null;
  /** `unavailable` when the deployed schema lacks material/season/occasion/style_tags. */
  semanticColumns: 'loaded' | 'unavailable';
}

/**
 * Repository products carry an outfitRole that enrichProduct already derived from the
 * same row, so it is dropped to keep role provenance tied to the raw evidence.
 */
export const productIntelligenceInputFromContext = (
  product: Product,
  context: ProductAttributeContext | undefined,
): ProductIntelligenceInput => ({
  product: { ...product, outfitRole: null },
  attributes: context?.attributes ?? undefined,
});

type CuratedOverride = Partial<Pick<InferredProductAttributes, 'colors' | 'fit' | 'subcategory' | 'gender'>>;

const SOURCE_CONFIDENCE: Readonly<Record<ProductSignalSource, ProductSignalConfidence>> = {
  catalog_repair: 'high',
  curated_title_override: 'high',
  catalog_attribute: 'unknown',
  catalog_variant: 'medium',
  product_snapshot: 'unknown',
  category_rule: 'medium',
  price_rule: 'high',
  title_inferred: 'low',
  unknown: 'unknown',
};

const SOURCE_ORIGIN: Readonly<Record<ProductSignalSource, ProductSignalOrigin>> = {
  catalog_repair: 'declared',
  curated_title_override: 'declared',
  catalog_attribute: 'declared',
  catalog_variant: 'declared',
  product_snapshot: 'declared',
  category_rule: 'derived',
  price_rule: 'derived',
  title_inferred: 'derived',
  unknown: 'unknown',
};

const CATEGORY_ROLES: Readonly<Record<GarmentCategory, readonly OutfitRole[]>> = {
  upper_body: ['top', 'outerwear'],
  lower_body: ['bottom'],
  dresses: ['one_piece'],
  shoes: ['shoes'],
  bags: ['bag'],
  hats: ['hat'],
  accessories: ['accessory'],
};

/** Only unambiguous subtypes; blazer, jean, esofman and pareo can span roles. */
const SUBTYPE_IMPLIED_ROLE: Readonly<Record<string, OutfitRole>> = {
  elbise: 'one_piece',
  ceket: 'outerwear',
  tisort: 'top',
  gomlek: 'top',
  polo: 'top',
  hoodie: 'top',
  sweatshirt: 'top',
  pantolon: 'bottom',
  etek: 'bottom',
  sort: 'bottom',
  kargo: 'bottom',
  ayakkabi: 'shoes',
  canta: 'bag',
  sapka: 'hat',
  gozluk: 'accessory',
  aksesuar: 'accessory',
};

const SUIT_TITLE_TOKENS = ['takım elbise', 'takim elbise'] as const;

const UNKNOWN_TOKEN = 'unknown';

const unknownSignal = <T>(): ProductSignal<T> => ({
  value: null,
  origin: 'unknown',
  source: 'unknown',
  confidence: 'unknown',
});

const signal = <T>(
  value: T | null | undefined,
  source: ProductSignalSource,
  confidence: ProductSignalConfidence = SOURCE_CONFIDENCE[source],
): ProductSignal<T> =>
  value == null
    ? unknownSignal<T>()
    : { value, origin: SOURCE_ORIGIN[source], source, confidence };

const declaredText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length === 0 || text.toLocaleLowerCase('tr-TR') === UNKNOWN_TOKEN ? null : text;
};

const isFitSlug = (value: string): value is FitSlug =>
  (FIT_VOCAB as readonly string[]).includes(value);

const isPriceBand = (value: string): value is PriceBand =>
  (PRICE_BANDS as readonly string[]).includes(value);

class ConflictLog {
  readonly entries: ProductSemanticConflict[] = [];

  /** `values[0]` is the kept value; later entries are the competing evidence. */
  add(field: ProductSemanticField, code: ProductConflictCode, values: readonly string[]): void {
    this.entries.push({ field, code, values });
  }
}

const resolveRole = (
  product: Product,
  attributes: ProductSemanticAttributeRow | undefined,
  repairRole: OutfitRole | undefined,
  conflicts: ConflictLog,
): ProductSignal<OutfitRole> => {
  const declared = attributes?.outfit_role;
  if (!isOutfitRole(declared)) {
    const rejected = declaredText(declared);
    if (rejected) conflicts.add('role', 'declared_value_rejected', [rejected]);
  }
  if (repairRole) return signal(repairRole, 'catalog_repair');
  if (isOutfitRole(declared)) return signal(declared, 'catalog_attribute');
  if (isOutfitRole(product.outfitRole)) return signal(product.outfitRole, 'product_snapshot');
  // upper_body cannot tell a top from outerwear.
  return signal(
    resolveCatalogOutfitRole(product.category, undefined),
    'category_rule',
    product.category === 'upper_body' ? 'low' : 'medium',
  );
};

const resolveSubtype = (
  product: Product,
  attributes: ProductSemanticAttributeRow | undefined,
  repairSubtype: string | undefined,
  curated: CuratedOverride | undefined,
  conflicts: ConflictLog,
): ProductSignal<string> => {
  if (repairSubtype) return signal(repairSubtype, 'catalog_repair');
  const titleMatch = matchSubcategoryFromTitle(product.title, product.category) || null;
  const declared = declaredText(attributes?.subcategory);
  if (declared) {
    if (titleMatch && titleMatch !== declared) {
      conflicts.add('subtype', 'declared_inferred_mismatch', [declared, titleMatch]);
    }
    return signal(declared, 'catalog_attribute');
  }
  if (curated?.subcategory) return signal(curated.subcategory, 'curated_title_override');
  return signal(titleMatch, 'title_inferred');
};

const resolveGender = (
  product: Product,
  attributes: ProductSemanticAttributeRow | undefined,
  curated: CuratedOverride | undefined,
  conflicts: ConflictLog,
): ProductSignal<ProductGender> => {
  const declared = declaredCatalogGender(attributes?.gender);
  const inferred = curated?.gender ?? inferGenderFromTitle(product.title);
  const inferredSource: ProductSignalSource = curated?.gender ? 'curated_title_override' : 'title_inferred';
  if (!declared) {
    const rejected = declaredText(attributes?.gender);
    if (rejected) conflicts.add('gender', 'declared_value_rejected', [rejected]);
    return signal(inferred, inferredSource);
  }
  if (inferred && inferred !== declared) {
    conflicts.add('gender', 'declared_inferred_mismatch', [declared, inferred]);
  }
  return signal(declared, 'catalog_attribute');
};

const resolveFit = (
  product: Product,
  attributes: ProductSemanticAttributeRow | undefined,
  curated: CuratedOverride | undefined,
  conflicts: ConflictLog,
): ProductSignal<FitSlug> => {
  const declared = declaredCatalogFit(attributes?.fit).toLocaleLowerCase('tr-TR');
  const inferred = curated?.fit || inferFitFromTitle(product.title) || null;
  const inferredSource: ProductSignalSource = curated?.fit ? 'curated_title_override' : 'title_inferred';
  if (!isFitSlug(declared)) {
    if (declared) conflicts.add('fit', 'declared_value_rejected', [declared]);
    return signal(inferred, inferredSource);
  }
  if (inferred && inferred !== declared) {
    conflicts.add('fit', 'declared_inferred_mismatch', [declared, inferred]);
  }
  return signal(declared, 'catalog_attribute');
};

const inferredColorSignals = (
  product: Product,
  curated: CuratedOverride | undefined,
): ProductSignal<string>[] => {
  const candidates: { slug: string; source: ProductSignalSource }[] = curated?.colors
    ? curated.colors.map(slug => ({ slug, source: 'curated_title_override' }))
    : [
      ...(product.colors ?? []).flatMap(color =>
        inferColorsFromText(color.name).map(slug => ({ slug, source: 'catalog_variant' as const }))),
      ...inferColorsFromText(product.title, product.brand)
        .map(slug => ({ slug, source: 'title_inferred' as const })),
    ];
  const seen = new Set<string>();
  const signals: ProductSignal<string>[] = [];
  for (const candidate of candidates) {
    const slug = slugify(candidate.slug);
    if (slug.length === 0 || seen.has(slug)) continue;
    seen.add(slug);
    signals.push(signal(slug, candidate.source));
  }
  return signals;
};

const resolveColors = (
  product: Product,
  attributes: ProductSemanticAttributeRow | undefined,
  curated: CuratedOverride | undefined,
  conflicts: ConflictLog,
): ProductSignal<string>[] => {
  const declared = cleanDeclaredCatalogColors(product.id, attributes?.colors);
  const rawDeclared: readonly unknown[] = Array.isArray(attributes?.colors) ? attributes.colors : [];
  const kept = new Set(declared.map(color => color.trim()));
  const rejected = rawDeclared
    .map(declaredText)
    .filter((color): color is string => color !== null && !kept.has(color));
  if (rejected.length > 0) conflicts.add('colors', 'declared_value_rejected', rejected);
  const inferred = inferredColorSignals(product, curated);
  if (declared.length === 0) return inferred;
  const inferredSlugs = inferred.flatMap(color => (color.value ? [color.value] : []));
  if (inferredSlugs.length > 0 && !inferredSlugs.some(slug => declared.includes(slug))) {
    conflicts.add('colors', 'declared_inferred_mismatch', [declared.join(','), inferredSlugs.join(',')]);
  }
  return declared.map(color => signal(color, 'catalog_attribute'));
};

const resolveStyleTags = (value: unknown): ProductSignal<string>[] => {
  const items: readonly unknown[] = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const tags: ProductSignal<string>[] = [];
  for (const raw of items) {
    const tag = declaredText(raw);
    const key = tag?.toLocaleLowerCase('tr-TR');
    if (!tag || !key || seen.has(key)) continue;
    seen.add(key);
    tags.push(signal(tag, 'catalog_attribute'));
  }
  return tags;
};

const resolvePriceBand = (
  product: Product,
  attributes: ProductSemanticAttributeRow | undefined,
  conflicts: ConflictLog,
): ProductSignal<PriceBand> => {
  const declared = declaredText(attributes?.price_band);
  if (declared && isPriceBand(declared)) return signal(declared, 'catalog_attribute');
  if (declared) conflicts.add('priceBand', 'declared_value_rejected', [declared]);
  const price = getDisplayPrice(product);
  return Number.isFinite(price) && price > 0 ? signal(inferPriceBand(price), 'price_rule') : unknownSignal();
};

const recordRoleConflicts = (
  product: Product,
  role: ProductSignal<OutfitRole>,
  subtype: ProductSignal<string>,
  conflicts: ConflictLog,
): void => {
  const allowedRoles = CATEGORY_ROLES[product.category];
  if (role.value && !allowedRoles.includes(role.value)) {
    conflicts.add('role', 'role_category_mismatch', [role.value, product.category]);
  }
  const impliedRole = subtype.value ? SUBTYPE_IMPLIED_ROLE[subtype.value] : undefined;
  if (subtype.value && impliedRole && !allowedRoles.includes(impliedRole)) {
    conflicts.add('subtype', 'subtype_category_mismatch', [subtype.value, product.category]);
  }
  if (subtype.value && impliedRole && role.value && impliedRole !== role.value) {
    conflicts.add('role', 'role_subtype_mismatch', [role.value, subtype.value]);
  }
  const title = product.title.toLocaleLowerCase('tr-TR');
  if (SUIT_TITLE_TOKENS.some(token => title.includes(token))) {
    conflicts.add('subtype', 'suit_blazer_ambiguity', [subtype.value ?? UNKNOWN_TOKEN]);
  }
};

/** Pure and deterministic; reads catalog data only and never mutates its inputs. */
export const buildProductIntelligence = ({
  product,
  attributes,
}: ProductIntelligenceInput): ProductIntelligence => {
  const conflicts = new ConflictLog();
  const repair = catalogMetadataRepair(product.id);
  const curated: CuratedOverride | undefined = CURATED_ATTRIBUTE_OVERRIDES[normalizeTitleKey(product.title)];
  const role = resolveRole(product, attributes, repair?.outfitRole, conflicts);
  const subtype = resolveSubtype(product, attributes, repair?.subcategory, curated, conflicts);
  const gender = resolveGender(product, attributes, curated, conflicts);
  const fit = resolveFit(product, attributes, curated, conflicts);
  const colors = resolveColors(product, attributes, curated, conflicts);
  const priceBand = resolvePriceBand(product, attributes, conflicts);
  recordRoleConflicts(product, role, subtype, conflicts);
  return {
    version: PRODUCT_INTELLIGENCE_VERSION,
    productId: product.id,
    category: product.category,
    role,
    subtype,
    gender,
    colors,
    fit,
    material: signal(declaredText(attributes?.material), 'catalog_attribute'),
    season: signal(declaredText(attributes?.season), 'catalog_attribute'),
    occasion: signal(declaredText(attributes?.occasion), 'catalog_attribute'),
    styleTags: resolveStyleTags(attributes?.style_tags),
    priceBand,
    conflicts: conflicts.entries,
  };
};

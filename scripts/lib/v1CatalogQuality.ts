import { COLOR_ALIASES } from '../../lib/productAttributes';

export interface QualityProduct {
  id: string; title: string; image_url: string; product_url: string;
  brand?: string | null; category?: string; provider?: string;
  price?: number | string; current_price?: number | string | null; last_price_checked_at?: string | null;
  images?: string[] | null;
}
export interface QualityAttributes {
  product_id: string; colors?: unknown; gender?: string | null;
  outfit_role?: string | null; style_tags?: unknown;
}
export interface ReviewedColor {
  product_id: string; title: string; image_url: string;
  review_status: string; approved_color_slugs: string; reviewer_note: string;
}
const approvedColors = new Set(COLOR_ALIASES.map(color => color.slug));
const tally = (values: string[]) => values.reduce<Record<string, number>>((counts, value) => {
  counts[value] = (counts[value] ?? 0) + 1; return counts;
}, {});
const validHttps = (value: string) => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
};

/** Stored metadata census, not title inference or a remote availability claim. */
export function summarizeV1Catalog(products: readonly QualityProduct[], attributes: readonly QualityAttributes[]) {
  const byId = new Map(attributes.map(row => [row.product_id, row]));
  return {
    products: products.length, attributeRows: attributes.length,
    category: tally(products.map(row => row.category || 'unknown')),
    role: tally(products.map(row => byId.get(row.id)?.outfit_role || 'unknown')),
    provider: tally(products.map(row => row.provider || 'unknown')),
    missing: {
      brand: products.filter(row => !row.brand?.trim()).length,
      gender: products.filter(row => !byId.get(row.id)?.gender).length,
      colors: products.filter(row => !Array.isArray(byId.get(row.id)?.colors) || !(byId.get(row.id)!.colors as unknown[]).length).length,
      styleTags: products.filter(row => !Array.isArray(byId.get(row.id)?.style_tags) || !(byId.get(row.id)!.style_tags as unknown[]).length).length,
      attributeRow: products.filter(row => !byId.has(row.id)).length,
      category: products.filter(row => !row.category).length,
      imageUrl: products.filter(row => !row.image_url?.trim()).length,
    },
    invalidHttpsImage: products.filter(row => !validHttps(row.image_url)).map(row => row.id),
    invalidHttpsStoreLink: products.filter(row => !validHttps(row.product_url)).map(row => row.id),
    invalidPrice: products.filter(row => !Number.isFinite(Number(row.current_price ?? row.price)) || Number(row.current_price ?? row.price) <= 0).map(row => row.id),
    priceCheckTimestampPresent: products.filter(row => !!row.last_price_checked_at).length,
    genericBrand: products.filter(row => /^(genel markalar|unknown|bilinmiyor)$/i.test(row.brand ?? '')).map(row => row.id),
  };
}

/** Reuse explicit source-based human decisions; never infer new values or overwrite conflicts. */
export function buildVerifiedColorPatch(
  products: readonly QualityProduct[], attributes: readonly QualityAttributes[], reviews: readonly ReviewedColor[],
) {
  const byProduct = new Map(products.map(row => [row.id, row]));
  const byAttributes = new Map(attributes.map(row => [row.product_id, row]));
  const counts = tally(reviews.map(row => row.product_id));
  const patches: Array<{ product_id: string; title: string; image_url: string; product_url: string; expected_colors: unknown; colors: string[]; reviewer_note: string }> = [];
  const conflicts: Array<{ product_id: string; stored: unknown; reviewed: string[] }> = [];
  const rejected: Array<{ product_id: string; reason: string }> = [];
  let alreadyEqual = 0;
  for (const row of reviews) {
    const product = byProduct.get(row.product_id), attr = byAttributes.get(row.product_id);
    const reject = (reason: string) => rejected.push({ product_id: row.product_id, reason });
    if (counts[row.product_id] !== 1) { reject('duplicate_review'); continue; }
    if (row.review_status !== 'onaylandı' || !row.reviewer_note?.trim()) { reject('not_explicitly_approved'); continue; }
    if (!product || !attr || product.title !== row.title || product.image_url !== row.image_url) { reject('source_identity_changed'); continue; }
    const colors = [...new Set(row.approved_color_slugs.split('|').map(token => token.trim()).filter(Boolean))];
    if (!colors.length || colors.some(color => !approvedColors.has(color))) { reject('unknown_color'); continue; }
    const stored = attr.colors;
    if (Array.isArray(stored) && JSON.stringify([...stored].sort()) === JSON.stringify([...colors].sort())) { alreadyEqual++; continue; }
    if (stored != null && (!Array.isArray(stored) || stored.length > 0)) {
      conflicts.push({ product_id: row.product_id, stored, reviewed: colors }); continue;
    }
    patches.push({ product_id: row.product_id, title: product.title, image_url: product.image_url,
      product_url: product.product_url, expected_colors: stored ?? null, colors, reviewer_note: row.reviewer_note });
  }
  return { patches, conflicts, rejected, alreadyEqual };
}

import * as cheerio from 'cheerio';
import { extractJsonLd, isType } from './structured';

export const MAX_IMAGES = 8;
export const MAX_CANDIDATES = 12;

const REJECT = /\.svg(\?|$)|logo|banner|icon|swatch|renk|color|payment|odeme|ödeme|visa|mastercard|troy|taksit/i;

export const isRejectedImage = (u: string): boolean => REJECT.test((u.split('?')[0].split('/').pop() ?? u));

/** Dedupe key: lowercase file name without query. */
export const imageKey = (u: string): string => (u.split('?')[0].split('/').pop() ?? u).toLowerCase();

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];

export const extractLcwImages = (html: string): string[] => {
  const p = extractJsonLd(html).find((n) => isType(n, 'Product'));
  const img = (p as { image?: unknown } | undefined)?.image;
  return typeof img === 'string' ? [img] : strings(img);
};

export const extractFloImages = (html: string, code: string): string[] => {
  const $ = cheerio.load(html);
  const out: string[] = [];
  $('img[data-type]').each((_, el) => {
    if (!/^[A-Za-z]\d+$/.test($(el).attr('data-type') ?? '')) return;
    const u = $(el).attr('data-src');
    if (u && /^https?:\/\/floimages\./.test(u) && u.includes(code)) out.push(u);
  });
  return out;
};

/** Rewrites a page URL into the format of the product's DB main image. */
export const matchMainFormat = (url: string, main: string): string => {
  if (/\/mnresize\/\d+\//.test(main)) return url; // DB already uses the page's resize format
  return url.replace(/\/mnresize\/\d+\/-\//, '/').split('?')[0];
};

export interface GalleryPlan {
  images: string[] | null;
  added: number;
  skipped: 'noise' | null;
}

export const planProductImages = (input: {
  id: string;
  mainImage: string | null;
  dbImages: string[];
  found: string[];
}): GalleryPlan => {
  const raw = [...new Map(input.found.map((u) => [imageKey(u), u])).values()];
  if (raw.length > MAX_CANDIDATES) return { images: null, added: 0, skipped: 'noise' };
  const base = input.dbImages.length > 0 ? input.dbImages : input.mainImage ? [input.mainImage] : [];
  if (base.length === 0) return { images: null, added: 0, skipped: null };
  const seen = new Set(base.map(imageKey));
  const next = [...base];
  for (const u of raw) {
    if (next.length >= MAX_IMAGES) break;
    if (isRejectedImage(u)) continue;
    const converted = matchMainFormat(u, base[0]);
    if (seen.has(imageKey(converted))) continue;
    seen.add(imageKey(converted));
    next.push(converted);
  }
  const added = next.length - base.length;
  return { images: added > 0 ? next : null, added, skipped: null };
};

import * as cheerio from 'cheerio';
import { absoluteUrl, asArray, extractJsonLd, isType, str } from '../structured';
import type { VariantColor, VariantParser, VariantSize } from '../types';

export const parseLcw: VariantParser = (html, pageUrl) => {
  const $ = cheerio.load(html);

  const colors: VariantColor[] = [];
  $('a.product-detail-colors__option').each((_, el) => {
    const href = $(el).attr('href');
    const url = href ? absoluteUrl(href, pageUrl) : undefined;
    const name = $(el).attr('aria-label')?.replace(/\s*\(Selected\)\s*$/i, '').trim();
    if (!url || !name) return;
    const imageUrl = str($(el).find('img').attr('src'));
    colors.push(imageUrl ? { name, url, imageUrl } : { name, url });
  });

  const sizes: VariantSize[] = [];
  $('.option-size-box').each((_, el) => {
    const label = ($(el).attr('data-label') ?? $(el).text()).trim();
    if (!label) return;
    sizes.push({
      label,
      inStock: !$(el).hasClass('option-size-box__out-of-stock'),
    });
  });

  if (colors.length === 0 || sizes.length === 0) {
    const product = extractJsonLd(html).find((n) => isType(n, 'Product'));
    if (product) {
      const color = str(product.color);
      if (colors.length === 0 && color) colors.push({ name: color, url: pageUrl });
      if (sizes.length === 0) {
        for (const s of asArray(product.size)) {
          const label = str(s);
          if (label) sizes.push({ label });
        }
      }
    }
  }
  return { colors, sizes };
};

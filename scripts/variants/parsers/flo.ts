import * as cheerio from 'cheerio';
import { absoluteUrl, str } from '../structured';
import type { VariantColor, VariantParser, VariantSize } from '../types';

export const parseFlo: VariantParser = (html, pageUrl) => {
  const $ = cheerio.load(html);

  // Only the active color's name is exposed on the page; sibling colors are image links.
  const activeName = $('.detail__section--color .detail__section-title--value')
    .first()
    .text()
    .trim();
  const colors: VariantColor[] = [];
  $('a.detail__colors-item').each((_, el) => {
    const href = $(el).attr('href');
    const url = href ? absoluteUrl(href, pageUrl) : undefined;
    if (!url) return;
    const imageUrl = str($(el).find('img').attr('src'));
    const name = $(el).hasClass('active') ? activeName : '';
    colors.push(imageUrl ? { name, url, imageUrl } : { name, url });
  });

  // The size list is rendered twice (main + sticky bar); keep first occurrence per label.
  const sizes: VariantSize[] = [];
  const seen = new Set<string>();
  $('input.js-product-size-input').each((_, el) => {
    const label = ($(el).attr('value') ?? '').trim();
    if (!label || seen.has(label)) return;
    seen.add(label);
    sizes.push({ label, inStock: !$(el).hasClass('not-stock') });
  });

  return { colors, sizes };
};

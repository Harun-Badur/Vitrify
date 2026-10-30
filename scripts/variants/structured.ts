import * as cheerio from 'cheerio';

type Json = unknown;

/** All JSON-LD objects on the page, with @graph / array wrappers flattened. */
export const extractJsonLd = (html: string): Record<string, Json>[] => {
  const $ = cheerio.load(html);
  const out: Record<string, Json>[] = [];
  const visit = (node: Json): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node && typeof node === 'object') {
      const obj = node as Record<string, Json>;
      out.push(obj);
      if (obj['@graph']) visit(obj['@graph']);
    }
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    const text = $(el).contents().text().trim();
    if (!text) return;
    try {
      visit(JSON.parse(text));
    } catch {
      /* malformed block: skip */
    }
  });
  return out;
};

export const isType = (node: Record<string, Json>, type: string): boolean => {
  const t = node['@type'];
  return Array.isArray(t) ? t.includes(type) : t === type;
};

export const asArray = <T>(value: T | T[] | undefined | null): T[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];

export const str = (value: Json): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Reads the first balanced JSON object/array that follows `marker` inside any inline script. */
export const extractInlineJson = (html: string, marker: RegExp): Json | null => {
  const $ = cheerio.load(html);
  let result: Json | null = null;
  $('script:not([src])').each((_, el) => {
    if (result !== null) return;
    const text = $(el).contents().text();
    const m = marker.exec(text);
    if (!m) return;
    const start = m.index + m[0].length;
    const open = text[start];
    if (open !== '{' && open !== '[') return;
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i += 1) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === open) depth += 1;
      else if (c === close) {
        depth -= 1;
        if (depth === 0) {
          try {
            result = JSON.parse(text.slice(start, i + 1));
          } catch {
            /* not valid JSON */
          }
          return;
        }
      }
    }
  });
  return result;
};

export const absoluteUrl = (href: string, base: string): string | undefined => {
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
};

import { XMLParser } from 'fast-xml-parser';

export type FeedFormat = 'rss' | 'atom';

/** One feed item: every tag (without its `g:` prefix) mapped to its text values in document order. */
export type RawFeedItem = Readonly<Record<string, readonly string[]>>;

export interface ParsedFeed {
  format: FeedFormat;
  items: RawFeedItem[];
}

type Node = Record<string, unknown>;

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Ids and sizes ("0042", "38") must stay strings.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
});

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asList = (value: unknown): unknown[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];

const textOf = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (isNode(value) && value['#text'] !== undefined) return textOf(value['#text']);
  return '';
};

const linkOf = (value: unknown): string => {
  const links = asList(value);
  const nodes = links.filter(isNode);
  // Atom: prefer rel="alternate" (or no rel), read the href attribute.
  const alternate = nodes.find((node) => node['@_rel'] === undefined || node['@_rel'] === 'alternate') ?? nodes[0];
  if (alternate) return textOf(alternate['@_href']) || textOf(alternate);
  return textOf(links[0]);
};

const toItem = (node: Node): RawFeedItem => {
  const item: Record<string, string[]> = {};
  for (const [rawKey, value] of Object.entries(node)) {
    if (rawKey.startsWith('@_')) continue;
    const key = rawKey.replace(/^g:/, '');
    const values = key === 'link'
      ? [linkOf(value)]
      : asList(value).map(textOf);
    item[key] = [...(item[key] ?? []), ...values.filter((text) => text.length > 0)];
  }
  return item;
};

export const parseMerchantFeed = (source: string): ParsedFeed => {
  let tree: Node;
  try {
    const parsed: unknown = xml.parse(source);
    if (!isNode(parsed)) throw new Error('invalid_feed');
    tree = parsed;
  } catch {
    throw new Error('invalid_feed');
  }
  const rss = tree.rss;
  if (isNode(rss) && isNode(rss.channel)) {
    return { format: 'rss', items: asList(rss.channel.item).filter(isNode).map(toItem) };
  }
  const atom = tree.feed;
  if (isNode(atom)) {
    return { format: 'atom', items: asList(atom.entry).filter(isNode).map(toItem) };
  }
  throw new Error('invalid_feed');
};

export const fieldAll = (item: RawFeedItem, name: string): string[] => [...(item[name] ?? [])];

export const field = (item: RawFeedItem, name: string): string => item[name]?.[0] ?? '';

import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseMerchantFeed } from '../scripts/lib/merchantFeed/parse';
import { buildMerchantImport } from '../scripts/lib/merchantFeed/mapRow';
import { buildReport, renderMarkdown, reportFileBase } from '../scripts/lib/merchantFeed/report';
import { parseCliArgs, runMerchantFeedDryRun } from '../scripts/importMerchantFeed';
import { OUTFIT_ROLES } from '../types/product';

const fixtureText = (name: string): string =>
  readFileSync(path.join(__dirname, '..', 'tests', 'fixtures', 'merchantFeed', name), 'utf8');
const run = (name = 'rss-full.xml') => buildMerchantImport(parseMerchantFeed(fixtureText(name)).items, 'ornekmarka');
const product = (result: ReturnType<typeof run>, id: string) =>
  result.payloads.find((payload) => payload.product.id === id)!;

describe('buildMerchantImport (rss-full fixture)', () => {
  const result = run();

  it('accepts one product per item_group_id + color and rejects the rest with reasons', () => {
    expect(result.payloads.map((p) => p.product.id)).toEqual([
      'ornekmarka-D2001',
      'ornekmarka-J3001',
      'ornekmarka-M6001',
      'ornekmarka-P1201',
      'ornekmarka-S9001',
      'ornekmarka-TS1-beyaz',
      'ornekmarka-TS1-navy-blue',
      'ornekmarka-TS1-siyah',
    ]);
    const reasons = Object.fromEntries(result.rejected.map((r) => [r.id, r.reason]));
    expect(reasons).toEqual({
      K4001: 'child',
      N1101: 'missing_image',
      O5001: 'out_of_stock',
      P1202: 'duplicate_in_input',
      U7001: 'unsupported_category',
      U7002: 'unmapped_category',
      X8001: 'unsupported_currency',
    });
  });

  it('counts children and out-of-stock items separately from product rejections', () => {
    expect(result.stats.totalItems).toBe(24);
    expect(result.stats.units).toBe(15);
    expect(result.stats.childItems).toBe(1);
    expect(result.stats.outOfStockItems).toBe(2);
  });

  it('groups colors and sizes of one item_group_id into variant fields', () => {
    const siyah = product(result, 'ornekmarka-TS1-siyah').product;
    expect(siyah.size_options).toEqual([
      { label: 'S', inStock: true },
      { label: 'M', inStock: true },
      { label: 'L', inStock: true },
      { label: 'XL', inStock: true },
    ]);
    expect(siyah.color_variants).toEqual([
      { name: 'Siyah', url: 'https://www.ornekmarka.example/urun/basic-tisort-siyah', imageUrl: 'https://img.ornekmarka.example/ts1/siyah/1.jpg' },
      { name: 'Beyaz', url: 'https://www.ornekmarka.example/urun/basic-tisort-beyaz', imageUrl: 'https://img.ornekmarka.example/ts1/beyaz/1.jpg' },
      { name: 'Navy Blue', url: 'https://www.ornekmarka.example/urun/basic-tisort-lacivert', imageUrl: 'https://img.ornekmarka.example/ts1/lacivert/1.jpg' },
    ]);
    const beyaz = product(result, 'ornekmarka-TS1-beyaz').product;
    expect(beyaz.size_options?.find((s) => s.label === 'XL')).toEqual({ label: 'XL', inStock: false });
    expect(beyaz.color_variants).toEqual(siyah.color_variants);
  });

  it('leaves variant fields null for ungrouped single products', () => {
    const jean = product(result, 'ornekmarka-J3001').product;
    expect(jean.color_variants).toBeNull();
    expect(jean.size_options).toEqual([{ label: '32', inStock: true }]);
    expect(product(result, 'ornekmarka-M6001').product.size_options).toBeNull();
  });

  it('maps price, sale price, urls and images', () => {
    const siyah = product(result, 'ornekmarka-TS1-siyah').product;
    expect(siyah.price).toBe(299.9);
    expect(siyah.current_price).toBe(249.9);
    expect(siyah.currency).toBe('TRY');
    expect(siyah.product_url).toBe('https://www.ornekmarka.example/urun/basic-tisort-siyah');
    expect(siyah.images).toEqual([
      'https://img.ornekmarka.example/ts1/siyah/1.jpg',
      'https://img.ornekmarka.example/ts1/siyah/2.jpg',
    ]);
    expect(siyah.image_url).toBe(siyah.images[0]);
    const beyaz = product(result, 'ornekmarka-TS1-beyaz').product;
    expect(beyaz.current_price).toBe(299.9);
    expect(product(result, 'ornekmarka-D2001').product.price).toBe(1299);
    expect(product(result, 'ornekmarka-D2001').product.images).toHaveLength(3);
    expect(product(result, 'ornekmarka-M6001').product.price).toBe(549);
  });

  it('writes attributes in the existing payload shape', () => {
    const dress = product(result, 'ornekmarka-D2001');
    expect(dress.product.category).toBe('dresses');
    expect(dress.product.gender).toBe('kadin');
    expect(dress.attributes).toMatchObject({
      product_id: 'ornekmarka-D2001',
      gender: 'women',
      colors: ['siyah', 'beyaz'],
      subcategory: 'elbise',
      outfit_role: 'one_piece',
      brand_slug: 'ornek-marka',
      price_band: 'mid',
    });
    expect(product(result, 'ornekmarka-TS1-navy-blue').attributes.colors).toEqual(['navy']);
    expect(product(result, 'ornekmarka-S9001').attributes.colors).toEqual(['beyaz']);
    for (const payload of result.payloads) {
      expect(OUTFIT_ROLES).toContain(payload.attributes.outfit_role);
    }
  });

  it('judges eligibility with existing rules and lists missing fields', () => {
    const eligible = result.payloads.filter((p) => p.product.feed_eligible).map((p) => p.product.id);
    expect(eligible).toEqual([
      'ornekmarka-D2001',
      'ornekmarka-J3001',
      'ornekmarka-S9001',
      'ornekmarka-TS1-beyaz',
      'ornekmarka-TS1-navy-blue',
      'ornekmarka-TS1-siyah',
    ]);
    expect(product(result, 'ornekmarka-M6001').product.eligibility_missing).toEqual(['renk']);
    expect(product(result, 'ornekmarka-P1201').product.eligibility_missing).toEqual(['renk']);
    expect(product(result, 'ornekmarka-P1201').product.gender).toBe('kadin');
    expect(product(result, 'ornekmarka-M6001').active).toBe(false);
    expect(product(result, 'ornekmarka-D2001').active).toBe(true);
  });

  it('records unmapped colors and categories with frequencies', () => {
    expect(result.stats.unmappedColors).toEqual({ pudra: 1 });
    expect(result.stats.unmappedCategories).toEqual({ havlu: 1, swimwear: 1 });
  });

  it('counts variant groups', () => {
    expect(result.stats.variantGroups).toBe(1);
    expect(result.stats.multiColorGroups).toBe(1);
  });
});

describe('buildMerchantImport (atom fixture and edge cases)', () => {
  it('maps Atom entries with sale price and Google text categories', () => {
    const result = run('atom-basic.xml');
    expect(result.rejected).toEqual([]);
    const blazer = product(result, 'ornekmarka-A1001');
    expect(blazer.product.current_price).toBe(1999);
    expect(blazer.product.price).toBe(2499);
    expect(blazer.attributes.outfit_role).toBe('outerwear');
    expect(blazer.attributes.subcategory).toBe('blazer');
    expect(product(result, 'ornekmarka-A1002').product.category).toBe('bags');
  });

  it('rejects items without id or title and non-https images', () => {
    const feed = '<rss xmlns:g="http://base.google.com/ns/1.0"><channel>'
      + '<item><g:title>x</g:title></item>'
      + '<item><g:id>T1</g:id></item>'
      + '<item><g:id>H1</g:id><g:title>Siyah Tişört</g:title><link>https://a.example/p/h1</link>'
      + '<g:image_link>http://a.example/i.jpg</g:image_link><g:price>10 TRY</g:price><g:product_type>Tişört</g:product_type></item>'
      + '<item><g:id>L1</g:id><g:title>Siyah Tişört</g:title><link>notaurl</link>'
      + '<g:image_link>https://a.example/i.jpg</g:image_link><g:price>10 TRY</g:price><g:product_type>Tişört</g:product_type></item>'
      + '<item><g:id>P1</g:id><g:title>Siyah Tişört</g:title><link>https://a.example/p/p1</link>'
      + '<g:image_link>https://a.example/i.jpg</g:image_link><g:product_type>Tişört</g:product_type></item>'
      + '</channel></rss>';
    const result = buildMerchantImport(parseMerchantFeed(feed).items, 'ornekmarka');
    expect(result.payloads).toEqual([]);
    expect(result.rejected.map((r) => r.reason).sort()).toEqual([
      'invalid_image', 'invalid_url', 'missing_id', 'missing_price', 'missing_title',
    ]);
  });

  it('treats unknown availability and missing age_group as importable', () => {
    const feed = '<rss xmlns:g="http://base.google.com/ns/1.0"><channel><item><g:id>A</g:id>'
      + '<g:title>Siyah Tişört</g:title><link>https://a.example/p/a</link><g:image_link>https://a.example/i.jpg</g:image_link>'
      + '<g:price>10 TRY</g:price><g:availability>preorder</g:availability><g:age_group>adult</g:age_group>'
      + '<g:product_type>Tişört</g:product_type><g:gender>male</g:gender></item></channel></rss>';
    const result = buildMerchantImport(parseMerchantFeed(feed).items, 'ornekmarka');
    expect(result.payloads).toHaveLength(1);
    expect(result.payloads[0].product.gender).toBe('erkek');
  });

  it('rejects an invalid provider slug', () => {
    expect(() => buildMerchantImport([], 'Bad Slug')).toThrow('invalid_provider');
  });
});

describe('report', () => {
  const result = run();
  const report = buildReport(result, { provider: 'ornekmarka', format: 'rss', generatedOn: '2026-11-05' });

  it('summarizes totals, reasons and eligibility', () => {
    expect(report).toMatchObject({
      provider: 'ornekmarka',
      mode: 'dry-run',
      format: 'rss',
      generatedOn: '2026-11-05',
      totals: { items: 24, units: 15, accepted: 8, rejected: 7, childItems: 1, outOfStockItems: 2, variantGroups: 1 },
      rejectedByReason: {
        child: 1, missing_image: 1, out_of_stock: 1, duplicate_in_input: 1,
        unsupported_category: 1, unmapped_category: 1, unsupported_currency: 1,
      },
      eligibility: { feedEligible: 6, notFeedEligible: 2, active: 6, missing: { renk: 2 } },
    });
    expect(report.unmappedCategories).toEqual([{ key: 'havlu', count: 1 }, { key: 'swimwear', count: 1 }]);
    expect(report.unmappedColors).toEqual([{ key: 'pudra', count: 1 }]);
  });

  it('renders markdown with the same numbers and a stable file name', () => {
    const md = renderMarkdown(report);
    expect(md).toContain('# Merchant feed dry-run: ornekmarka');
    expect(md).toContain('child');
    expect(md).toContain('havlu');
    expect(reportFileBase('ornekmarka', '2026-11-05')).toBe('ornekmarka-2026-11-05');
  });
});

describe('CLI', () => {
  it('requires --file and a valid --provider and is dry-run only', () => {
    expect(() => parseCliArgs([])).toThrow('--file');
    expect(() => parseCliArgs(['--file', 'a.xml'])).toThrow('--provider');
    expect(() => parseCliArgs(['--file', 'a.xml', '--provider', 'Bad'])).toThrow('invalid_provider');
    expect(() => parseCliArgs(['--file', 'a.xml', '--provider', 'koton', '--apply'])).toThrow('dry-run');
    expect(() => parseCliArgs(['--file', 'https://x.example/feed.xml', '--provider', 'koton'])).toThrow('local');
    expect(parseCliArgs(['--file', 'a.xml', '--provider', 'koton', '--dry-run'])).toMatchObject({
      file: 'a.xml', provider: 'koton',
    });
  });

  it('writes json and md reports and nothing else', async () => {
    const outDir = mkdtempSync(path.join(os.tmpdir(), 'merchant-feed-'));
    const file = path.join(__dirname, '..', 'tests', 'fixtures', 'merchantFeed', 'rss-full.xml');
    const report = await runMerchantFeedDryRun({
      file, provider: 'ornekmarka', outDir, now: new Date('2026-11-05T10:00:00Z'),
    });
    expect(report.totals.accepted).toBe(8);
    const json = JSON.parse(readFileSync(path.join(outDir, 'ornekmarka-2026-11-05.json'), 'utf8'));
    expect(json.totals.items).toBe(24);
    expect(readFileSync(path.join(outDir, 'ornekmarka-2026-11-05.md'), 'utf8')).toContain('ornekmarka');
  });
});

import type { FeedFormat } from './parse';
import type { MerchantImportResult } from './mapRow';

export interface FrequencyEntry {
  key: string;
  count: number;
}

export interface MerchantFeedReport {
  provider: string;
  mode: 'dry-run';
  format: FeedFormat;
  generatedOn: string;
  totals: {
    items: number;
    /** One unit = one product candidate (item_group_id + color, or a single ungrouped item). */
    units: number;
    accepted: number;
    rejected: number;
    childItems: number;
    outOfStockItems: number;
    variantGroups: number;
    multiColorGroups: number;
  };
  rejectedByReason: Record<string, number>;
  unmappedCategories: FrequencyEntry[];
  unmappedColors: FrequencyEntry[];
  eligibility: {
    feedEligible: number;
    notFeedEligible: number;
    /** isActiveCatalogRecord verdict, ignoring the provider check that waits for the constraint migration. */
    active: number;
    missing: Record<string, number>;
  };
  enrichmentReview: number;
}

const frequencies = (counts: Readonly<Record<string, number>>): FrequencyEntry[] =>
  Object.entries(counts)
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || (left.key < right.key ? -1 : 1));

export const reportFileBase = (provider: string, date: string): string => `${provider}-${date}`;

export const buildReport = (
  result: MerchantImportResult,
  meta: { provider: string; format: FeedFormat; generatedOn: string },
): MerchantFeedReport => {
  const rejectedByReason: Record<string, number> = {};
  for (const rejection of result.rejected) {
    rejectedByReason[rejection.reason] = (rejectedByReason[rejection.reason] ?? 0) + 1;
  }
  const missing: Record<string, number> = {};
  let feedEligible = 0;
  let active = 0;
  for (const { product, active: isActive } of result.payloads) {
    if (product.feed_eligible) feedEligible += 1;
    if (isActive) active += 1;
    for (const field of product.eligibility_missing) missing[field] = (missing[field] ?? 0) + 1;
  }
  const { stats } = result;
  return {
    provider: meta.provider,
    mode: 'dry-run',
    format: meta.format,
    generatedOn: meta.generatedOn,
    totals: {
      items: stats.totalItems,
      units: stats.units,
      accepted: result.payloads.length,
      rejected: result.rejected.length,
      childItems: stats.childItems,
      outOfStockItems: stats.outOfStockItems,
      variantGroups: stats.variantGroups,
      multiColorGroups: stats.multiColorGroups,
    },
    rejectedByReason,
    unmappedCategories: frequencies(stats.unmappedCategories),
    unmappedColors: frequencies(stats.unmappedColors),
    eligibility: {
      feedEligible,
      notFeedEligible: result.payloads.length - feedEligible,
      active,
      missing,
    },
    enrichmentReview: stats.enrichmentReview,
  };
};

const table = (rows: ReadonlyArray<readonly [string, string | number]>): string[] =>
  rows.length === 0 ? ['_yok_'] : ['| Anahtar | Değer |', '| --- | ---: |', ...rows.map(([key, value]) => `| ${key} | ${value} |`)];

export const renderMarkdown = (report: MerchantFeedReport): string => {
  const { totals, eligibility } = report;
  return [
    `# Merchant feed dry-run: ${report.provider}`,
    '',
    `Tarih: ${report.generatedOn} · Format: ${report.format} · Mod: dry-run (DB yazımı yok)`,
    '',
    '## Toplam',
    ...table([
      ['feed item', totals.items],
      ['ürün adayı (item_group_id + renk)', totals.units],
      ['kabul edilen', totals.accepted],
      ['reddedilen', totals.rejected],
      ['çocuk item (age_group)', totals.childItems],
      ['stok dışı item', totals.outOfStockItems],
      ['varyant grubu (item_group_id, 2+ item)', totals.variantGroups],
      ['birden fazla renkli grup', totals.multiColorGroups],
    ]),
    '',
    '## Red nedenleri',
    ...table(Object.entries(report.rejectedByReason)),
    '',
    '## Eşlenemeyen kategoriler',
    ...table(report.unmappedCategories.map((entry) => [entry.key || '(boş)', entry.count] as const)),
    '',
    '## Eşlenemeyen renkler',
    ...table(report.unmappedColors.map((entry) => [entry.key, entry.count] as const)),
    '',
    '## Uygunluk (mevcut kurallar)',
    ...table([
      ['feed_eligible olacak', eligibility.feedEligible],
      ['feed_eligible olmayacak', eligibility.notFeedEligible],
      ['isActiveCatalogRecord (provider kontrolü hariç)', eligibility.active],
      ...Object.entries(eligibility.missing).map(([key, count]) => [`eksik: ${key}`, count] as const),
    ]),
    '',
    `Başlık kuralının feed değerini değiştirdiği (review) alan sayısı: ${report.enrichmentReview}`,
    '',
  ].join('\n');
};

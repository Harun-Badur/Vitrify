/**
 * Google Merchant (RSS 2.0 g: / Atom) feed -> catalog import, DRY-RUN ONLY.
 *
 *   npx tsx scripts/importMerchantFeed.ts --file <local.xml> --provider <slug> [--out-dir <dir>] [--dry-run]
 *
 * Reads one local file and writes a report under reports/merchant-feed/. It never loads
 * environment files, opens a network connection or writes to a database.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildMerchantImport, isValidProviderSlug } from './lib/merchantFeed/mapRow';
import { parseMerchantFeed } from './lib/merchantFeed/parse';
import { buildReport, renderMarkdown, reportFileBase, type MerchantFeedReport } from './lib/merchantFeed/report';

export interface CliOptions {
  file: string;
  provider: string;
  outDir: string;
}

const DEFAULT_OUT_DIR = path.join('reports', 'merchant-feed');

export const parseCliArgs = (argv: readonly string[]): CliOptions => {
  let file = '';
  let provider = '';
  let outDir = DEFAULT_OUT_DIR;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--file') file = argv[++index] ?? '';
    else if (arg === '--provider') provider = argv[++index] ?? '';
    else if (arg === '--out-dir') outDir = argv[++index] ?? '';
    else if (arg === '--dry-run') continue;
    else throw new Error(`Bilinmeyen veya desteklenmeyen argüman: ${arg}. Bu araç yalnız dry-run çalışır.`);
  }
  if (file.length === 0) throw new Error('--file <yerel.xml> gerekli.');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(file)) throw new Error('--file yalnız local dosya olabilir (ağ isteği yok).');
  if (provider.length === 0) throw new Error('--provider <slug> gerekli.');
  if (!isValidProviderSlug(provider)) {
    throw new Error('invalid_provider: küçük harf ve rakamdan oluşan 2-24 karakterlik slug olmalı.');
  }
  if (outDir.length === 0) throw new Error('--out-dir boş olamaz.');
  return { file, provider, outDir };
};

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

export const runMerchantFeedDryRun = async (
  options: CliOptions & { now?: Date },
): Promise<MerchantFeedReport> => {
  const source = await readFile(path.resolve(options.file), 'utf8');
  const feed = parseMerchantFeed(source);
  const result = buildMerchantImport(feed.items, options.provider);
  const date = isoDate(options.now ?? new Date());
  const report = buildReport(result, { provider: options.provider, format: feed.format, generatedOn: date });
  const outDir = path.resolve(options.outDir);
  const base = path.join(outDir, reportFileBase(options.provider, date));
  await mkdir(outDir, { recursive: true });
  await writeFile(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(`${base}.md`, renderMarkdown(report), 'utf8');
  return report;
};

if (require.main === module) {
  Promise.resolve()
    .then(() => runMerchantFeedDryRun(parseCliArgs(process.argv.slice(2))))
    .then((report) => {
      const { totals, eligibility } = report;
      console.log(
        `dry-run ${report.provider}: ${totals.items} item, ${totals.accepted} kabul, ${totals.rejected} red, `
        + `feed_eligible ${eligibility.feedEligible}/${totals.accepted}`,
      );
    })
    .catch((error: unknown) => {
      console.error(`Merchant feed dry-run başarısız: ${error instanceof Error ? error.message : 'bilinmeyen hata'}`);
      process.exitCode = 1;
    });
}

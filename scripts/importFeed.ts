import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { parse } from 'csv-parse/sync';
import { createClient } from '@supabase/supabase-js';
import { isFeedProvider, isGarmentCategory, type FeedProvider, type FeedProductRow } from '../types/product';

// Importing validation helpers must never start a CLI write or load credentials.
if (require.main === module && !process.argv.includes('--staging-insert-only')) loadEnv({ quiet: true });

interface ColumnMapping {
  provider: string;
  external_id: string;
  title: string;
  brand: string;
  price: string;
  currency: string;
  image_url: string;
  product_url: string;
  category: string;
  affiliate_url: string;
}

const MARKETPLACE_COLUMN_MAPPING: ColumnMapping = {
  provider: 'provider',
  external_id: 'external_id',
  title: 'title',
  brand: 'brand',
  price: 'price',
  currency: 'currency',
  image_url: 'image_url',
  product_url: 'product_url',
  category: 'category',
  affiliate_url: 'affiliate_url',
};

const PROVIDER_MAPPINGS: Record<FeedProvider, ColumnMapping> = {
  mock: MARKETPLACE_COLUMN_MAPPING,
  amazon: MARKETPLACE_COLUMN_MAPPING,
  trendyol: MARKETPLACE_COLUMN_MAPPING,
  hepsiburada: MARKETPLACE_COLUMN_MAPPING,
  boyner: MARKETPLACE_COLUMN_MAPPING,
  mavi: MARKETPLACE_COLUMN_MAPPING,
  lcw: MARKETPLACE_COLUMN_MAPPING,
  defacto: MARKETPLACE_COLUMN_MAPPING,
  flo: MARKETPLACE_COLUMN_MAPPING,
};

const looksLikeSource = (value: string): boolean =>
  value.endsWith('.csv') ||
  value.startsWith('http://') ||
  value.startsWith('https://') ||
  value.includes('/') ||
  value.includes('\\');

const parsePrice = (raw: string): number => {
  const normalized = raw.trim().replace(/\s/g, '').replace(',', '.');
  const parsed = Number(normalized.replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Geçersiz fiyat: ${raw}`);
  }
  return parsed;
};

const readCsvText = async (source: string): Promise<string> => {
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`CSV indirilemedi (HTTP ${response.status}): ${source}`);
    }
    return response.text();
  }

  const absolutePath = path.isAbsolute(source)
    ? source
    : path.resolve(process.cwd(), source);
  return readFile(absolutePath, 'utf8');
};

const cell = (
  row: Record<string, string>,
  column: string,
  required: boolean,
): string => {
  if (!column) {
    if (required) {
      throw new Error('Zorunlu kolon adı boş.');
    }
    return '';
  }

  const value = row[column]?.trim() ?? '';
  if (required && value.length === 0) {
    throw new Error(`Zorunlu kolon boş: ${column}`);
  }
  return value;
};

const resolveProvider = (
  raw: Record<string, string>,
  mapping: ColumnMapping,
  fallbackProvider: FeedProvider | null,
): FeedProvider => {
  const fromCsv = cell(raw, mapping.provider, false);
  if (fromCsv.length > 0) {
    if (!isFeedProvider(fromCsv)) {
      throw new Error(
        `CSV provider geçersiz: ${fromCsv}. Kullanılabilenler: amazon, trendyol, hepsiburada, mock`,
      );
    }
    return fromCsv;
  }

  if (fallbackProvider) {
    return fallbackProvider;
  }

  throw new Error('Satırda provider yok ve CLI provider verilmedi.');
};

const mapRow = (
  raw: Record<string, string>,
  fallbackProvider: FeedProvider | null,
  mapping: ColumnMapping,
): FeedProductRow => {
  const provider = resolveProvider(raw, mapping, fallbackProvider);
  const externalId = cell(raw, mapping.external_id, true);
  const title = cell(raw, mapping.title, true);
  const brand = cell(raw, mapping.brand, false);
  const price = parsePrice(cell(raw, mapping.price, true));
  const currency = cell(raw, mapping.currency, false) || 'TRY';
  const imageUrl = cell(raw, mapping.image_url, true);
  const productUrl = cell(raw, mapping.product_url, true);
  const category = cell(raw, mapping.category, true);
  if (!isGarmentCategory(category)) {
    throw new Error(`CSV category geçersiz: ${category}`);
  }
  const affiliateUrl = cell(raw, mapping.affiliate_url, false);

  return {
    id: `${provider}-${externalId}`,
    provider,
    external_id: externalId,
    title,
    brand: brand.length > 0 ? brand : null,
    price,
    currency,
    image_url: imageUrl,
    images: [imageUrl],
    product_url: productUrl,
    category,
    affiliate_url: affiliateUrl.length > 0 ? affiliateUrl : null,
  };
};

const countByProvider = (rows: FeedProductRow[]): string => {
  const counts = new Map<FeedProvider, number>();
  for (const row of rows) {
    counts.set(row.provider, (counts.get(row.provider) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([provider, count]) => `${provider}: ${count}`)
    .join(', ');
};

const STAGING_URL = 'https://sdjxseqfkturkfohkfni.supabase.co';
export function stagingImportTarget(env: Readonly<Record<string,string|undefined>>, dryRun: boolean) {
  if (env.CATALOG_STAGING_URL !== STAGING_URL) throw new Error('STAGING_TARGET_REQUIRED');
  if (!dryRun && (env.CATALOG_STAGING_ALLOW_INSERT !== 'yes' || !env.CATALOG_STAGING_ADMIN_KEY)) {
    throw new Error('STAGING_INSERT_APPROVAL_REQUIRED');
  }
  return { url: STAGING_URL, key: env.CATALOG_STAGING_ADMIN_KEY ?? '' };
}

export function validateStagingCatalog(rows: FeedProductRow[]): void {
  if (rows.length !== 20) throw new Error('EXACTLY_20_PRODUCTS_REQUIRED');
  const ids = new Set<string>(), keys = new Set<string>(), urls = new Set<string>();
  for (const p of rows) {
    const key = JSON.stringify([p.provider,p.external_id]);
    const product = new URL(p.product_url), image = new URL(p.image_url);
    product.search='';product.hash='';
    const url = product.href.replace(/\/+$/,'');
    if (!isFeedProvider(p.provider) || p.provider==='mock' || !p.external_id || p.id!==`${p.provider}-${p.external_id}`
      || !p.title.trim() || !p.brand?.trim() || !Number.isFinite(p.price) || Number(p.price)<=0 || p.currency!=='TRY'
      || !['upper_body','lower_body','dresses'].includes(p.category)
      || product.protocol!=='https:' || image.protocol!=='https:'
      || /unsplash|example\.(com|invalid)|placeholder|picsum/i.test(image.hostname)
      || !['www.flo.com.tr','flo.com.tr','www.lcw.com','lcw.com'].includes(product.hostname)
      || ids.has(p.id) || keys.has(key) || urls.has(url)) throw new Error('STAGING_CATALOG_INVALID');
    ids.add(p.id);keys.add(key);urls.add(url);
  }
}

export const importFeed = async (): Promise<void> => {
  const stagingInsertOnly = process.argv.includes('--staging-insert-only');
  const dryRun = process.argv.includes('--dry-run');
  const args = process.argv.slice(2).filter(arg=>!['--staging-insert-only','--dry-run'].includes(arg));
  const firstArg = args[0];
  const secondArg = args[1];
  if (dryRun && !stagingInsertOnly) throw new Error('STAGING_MODE_REQUIRED');

  if (!firstArg) {
    throw new Error(
      'Kullanım: npx tsx scripts/importFeed.ts [provider] <csv-url-veya-yol>',
    );
  }

  let fallbackProvider: FeedProvider | null = null;
  let sourceArg = firstArg;

  if (secondArg) {
    if (!isFeedProvider(firstArg)) {
      throw new Error(
        `Bilinmeyen provider: ${firstArg}. Kullanılabilenler: amazon, trendyol, hepsiburada, mock`,
      );
    }
    fallbackProvider = firstArg;
    sourceArg = secondArg;
  } else if (!looksLikeSource(firstArg)) {
    throw new Error(
      'CSV yolu eksik. Kullanım: npx tsx scripts/importFeed.ts [provider] <csv-url-veya-yol>',
    );
  }

  const target = stagingInsertOnly ? stagingImportTarget(process.env,dryRun) : null;
  const supabaseUrl = target?.url ?? process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = target ? target.key : process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || (!dryRun && !serviceRoleKey)) {
    throw new Error(
      'EXPO_PUBLIC_SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY eksik.',
    );
  }
  if (stagingInsertOnly && /^https?:\/\//i.test(sourceArg)) throw new Error('LOCAL_APPROVED_CSV_REQUIRED');

  const mapping = fallbackProvider
    ? PROVIDER_MAPPINGS[fallbackProvider]
    : MARKETPLACE_COLUMN_MAPPING;
  const csvText = await readCsvText(sourceArg);
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  if (records.length === 0) {
    throw new Error('CSV boş; içe aktarılacak satır yok.');
  }

  const rows = records.map((record) =>
    mapRow(record, fallbackProvider, mapping),
  );
  if (stagingInsertOnly) validateStagingCatalog(rows);
  if (dryRun) {console.log('PASS LOCAL_CATALOG_VALIDATION count=20 no_connection=true');return;}
  const supabase = createClient(supabaseUrl, serviceRoleKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Narrow contract for this existing CLI; no generated database schema is available here.
  const writer = supabase as unknown as {from(table:'products'):{upsert(values:FeedProductRow[],options:{onConflict:string;ignoreDuplicates?:boolean}):{
    select(columns:'id'):PromiseLike<{data:{id:string}[]|null;error:{message:string}|null}>}}};
  const { data, error } = await writer.from('products').upsert(rows, {
    onConflict: 'provider,external_id',
    ...(stagingInsertOnly ? {ignoreDuplicates:true} : {}),
  }).select('id');

  if (error) {
    if (stagingInsertOnly) throw new Error('STAGING_IMPORT_FAILED_NO_OVERWRITE');
    throw new Error(`Upsert başarısız: ${error.message}`);
  }

  if (stagingInsertOnly) {console.log(`PASS STAGING_CATALOG_INSERT inserted=${data?.length ?? 0} skipped=${rows.length-(data?.length ?? 0)}`);return;}

  console.log(`${rows.length} ürün içe aktarıldı`);
  console.log(countByProvider(rows));
};

if (require.main === module) importFeed().catch((error: unknown) => {
  if (process.argv.includes('--staging-insert-only')) {console.error('FAIL STAGING_CATALOG_IMPORT');process.exitCode=1;return;}
  const message = error instanceof Error ? error.message : 'Bilinmeyen hata';
  console.error(`Feed ithalatı başarısız: ${message}`);
  process.exit(1);
});

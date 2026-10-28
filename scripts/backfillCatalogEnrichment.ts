/**
 * Catalog enrichment backfill: products.gender / feed_eligible / eligibility_missing /
 * attribute_source / attribute_version, and product_attributes colors / subcategory / fit,
 * all from lib/catalogEnrichment.ts (the same title rules as the preview).
 *
 * DRY-RUN by default: reads only and prints the plan. Writes only with --apply.
 *   npx tsx scripts/backfillCatalogEnrichment.ts [--verbose]
 *   npx tsx scripts/backfillCatalogEnrichment.ts --apply
 *
 * Requires supabase/migrations/202610280001_products_feed_eligibility.sql for --apply.
 * --apply needs SUPABASE_SERVICE_ROLE_KEY in the environment (never in a file or log).
 * Before any write it saves previous values to scripts/backups/ (gitignored);
 * undo with scripts/rollbackCatalogEnrichment.ts --backup <file>.
 */
import { config as loadEnv } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  buildBackfillBackup,
  formatBackfillPlan,
  parseBackfillArgs,
  planCatalogBackfill,
  type BackfillAttributeRow,
  type BackfillProductRow,
} from './lib/catalogBackfill';

loadEnv();

const PAGE_SIZE = 1000;
const BASE_COLUMNS = 'id,title,brand,category,product_url,price,current_price,image_url';
const ENRICHMENT_COLUMNS = 'gender,feed_eligible,eligibility_missing,attribute_source,attribute_version';
const MISSING_COLUMN = /column .*(gender|feed_eligible|eligibility_missing|attribute_source|attribute_version).* does not exist/i;

const fetchAll = async <T>(client: SupabaseClient, table: string, select: string, order: string): Promise<T[]> => {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client.from(table).select(select).order(order).range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`${table} okunamadı: ${error.message}`);
    rows.push(...(data as T[]));
    if ((data ?? []).length < PAGE_SIZE) return rows;
  }
};

const main = async () => {
  const args = parseBackfillArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Dry-run reads with the public anon key (GET only); writes need the service role.
  const key = args.apply ? serviceKey : process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? serviceKey;
  if (!url) throw new Error('SUPABASE_URL / EXPO_PUBLIC_SUPABASE_URL tanımlı değil');
  if (!key) throw new Error(args.apply ? '--apply için SUPABASE_SERVICE_ROLE_KEY ortam değişkeni gerekli' : 'Okuma anahtarı tanımlı değil');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  let products: BackfillProductRow[];
  try {
    products = await fetchAll<BackfillProductRow>(client, 'products', `${BASE_COLUMNS},${ENRICHMENT_COLUMNS}`, 'id');
  } catch (error) {
    if (args.apply || !(error instanceof Error && MISSING_COLUMN.test(error.message))) throw error;
    console.log('UYARI: migration henüz uygulanmamış; mevcut değerler boş kabul edildi.');
    products = (await fetchAll<BackfillProductRow>(client, 'products', BASE_COLUMNS, 'id')).map(row => ({
      ...row, gender: null, feed_eligible: false, eligibility_missing: null, attribute_source: null, attribute_version: null }));
  }
  const attributes = await fetchAll<BackfillAttributeRow>(client, 'product_attributes', 'product_id,gender,colors,fit,subcategory', 'product_id');
  const plan = planCatalogBackfill(products, attributes);
  formatBackfillPlan(plan, args).forEach(line => console.log(line));
  if (!args.apply) return;

  const createdAt = new Date().toISOString();
  const dir = join(__dirname, 'backups');
  const backupPath = join(dir, `catalog-enrichment-${createdAt.replace(/[:.]/g, '-')}.json`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(backupPath, `${JSON.stringify(buildBackfillBackup(plan, createdAt), null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  console.log(`Yedek: ${backupPath}`);

  let written = 0;
  try {
    for (const change of plan.products) {
      const { error } = await client.from('products').update(change.after).eq('id', change.id);
      if (error) throw new Error(`products ${change.id}: ${error.message}`);
      written++;
    }
    for (const write of plan.attributes) {
      const { error } = write.mode === 'update'
        ? await client.from('product_attributes').update(write.patch).eq('product_id', write.product_id)
        : await client.from('product_attributes').insert({ product_id: write.product_id, ...write.patch });
      if (error) throw new Error(`product_attributes ${write.product_id}: ${error.message}`);
      written++;
    }
  } catch (error) {
    console.error(`Yazma ${written}. adımdan sonra durdu. Geri almak için: npx tsx scripts/rollbackCatalogEnrichment.ts --backup "${backupPath}" --apply`);
    throw error;
  }

  const { count, error } = await client.from('products').select('id', { count: 'exact', head: true }).eq('feed_eligible', true);
  if (error) throw new Error(`Doğrulama okunamadı: ${error.message}`);
  console.log(`Yazıldı: ${written} satır. Doğrulama: feed_eligible=true ${count} (beklenen ${plan.summary.eligible}).`);
  if (count !== plan.summary.eligible) process.exitCode = 1;
};

main().catch(error => { console.error(error instanceof Error ? error.message : 'Bilinmeyen hata'); process.exit(1); });

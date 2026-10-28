/**
 * Restores the values saved by scripts/backfillCatalogEnrichment.ts --apply.
 * DRY-RUN by default; writes only with --apply. Needs SUPABASE_SERVICE_ROLE_KEY in the
 * environment for --apply (never in a file or log).
 *   npx tsx scripts/rollbackCatalogEnrichment.ts --backup scripts/backups/<file>.json [--apply]
 *
 * product_attributes rows the backfill inserted are deleted (they did not exist before).
 * Restoring every products.feed_eligible to false empties every feed; deploy order matters.
 */
import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { planCatalogRollback, type BackfillBackup } from './lib/catalogBackfill';

loadEnv();

const parseArgs = (argv: readonly string[]) => {
  let backup = '';
  let apply = false;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--apply') apply = true;
    else if (argv[index] === '--backup' && argv[index + 1]) backup = argv[++index];
    else throw new Error(`Bilinmeyen argüman: ${argv[index]}`);
  }
  if (!backup) throw new Error('--backup <dosya> gerekli');
  return { backup, apply };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const plan = planCatalogRollback(JSON.parse(readFileSync(args.backup, 'utf8')) as BackfillBackup);
  const deletes = plan.attributes.filter(item => item.mode === 'delete').length;
  console.log(`${args.apply ? 'APPLY' : 'DRY-RUN'}: products geri yükleme ${plan.products.length}; `
    + `product_attributes geri yükleme ${plan.attributes.length - deletes}, silinecek eklenmiş satır ${deletes}.`);
  if (!args.apply) {
    console.log('Gerçek geri alma için --apply ekleyin.');
    return;
  }

  const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('--apply için SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY ortam değişkenleri gerekli');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  for (const item of plan.products) {
    const { error } = await client.from('products').update(item.values).eq('id', item.id);
    if (error) throw new Error(`products ${item.id}: ${error.message}`);
  }
  for (const item of plan.attributes) {
    const { error } = item.mode === 'restore'
      ? await client.from('product_attributes').update(item.values).eq('product_id', item.product_id)
      : await client.from('product_attributes').delete().eq('product_id', item.product_id);
    if (error) throw new Error(`product_attributes ${item.product_id}: ${error.message}`);
  }
  console.log('Geri alma tamamlandı.');
};

main().catch(error => { console.error(error instanceof Error ? error.message : 'Bilinmeyen hata'); process.exit(1); });

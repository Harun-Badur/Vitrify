import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import type { VariantRecord } from './types';
import { planVariantUpdates } from './variantRows';

// Deliberately no dotenv: for --apply, pass EXPO_PUBLIC_SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY in that one command's process env only.
const INPUT = path.resolve(process.cwd(), 'scripts/data/variants_pilot.json');

const run = async (): Promise<void> => {
  const apply = process.argv.includes('--apply');
  const records = JSON.parse(await readFile(INPUT, 'utf8')) as VariantRecord[];
  const plan = planVariantUpdates(records);

  console.log(`mode: ${apply ? 'APPLY' : 'dry-run'}`);
  console.log(
    `records=${records.length} to_update=${plan.updates.length} colors=${plan.colorCount} sizes=${plan.sizeCount} skipped_manual_review=${plan.skippedManualReview} skipped_errors=${plan.skippedErrors}`,
  );
  if (!apply) {
    console.log('dry-run: nothing written. Re-run with --apply to write.');
    return;
  }

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error('EXPO_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY gerekli.');
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let written = 0;
  let failed = 0;
  let missing = 0;
  for (const { id, values } of plan.updates) {
    const { data, error } = await supabase.from('products').update(values).eq('id', id).select('id');
    if (error) {
      failed += 1;
      console.error(`${id}: ${error.message}`);
    } else if (!data || data.length === 0) {
      missing += 1;
    } else {
      written += 1;
    }
  }
  console.log(`written=${written} missing_rows=${missing} failed=${failed}`);
  if (failed > 0) process.exit(1);
};

run().catch((error: unknown) => {
  console.error(`Varyant yüklemesi başarısız: ${error instanceof Error ? error.message : 'bilinmeyen hata'}`);
  process.exit(1);
});

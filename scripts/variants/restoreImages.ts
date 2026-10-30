import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Rollback: restores products.images from a backup written by applyGalleryImages.ts --apply.
// Usage: SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/variants/restoreImages.ts <backup.json> [--apply]
loadEnv({ quiet: true });

const run = async (): Promise<void> => {
  const file = process.argv.find((a) => a.endsWith('.json'));
  if (!file) throw new Error('Yedek dosyasi gerekli: scripts/data/images_backup_<tarih>.json');
  const apply = process.argv.includes('--apply');
  const rows = JSON.parse(await readFile(path.resolve(process.cwd(), file), 'utf8')) as Array<{ id: string; images: string[] }>;
  console.log(`mode: ${apply ? 'APPLY' : 'dry-run'} rows=${rows.length}`);
  if (!apply) return;

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error('EXPO_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY gerekli.');
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  let written = 0;
  let failed = 0;
  for (const r of rows) {
    const { data, error } = await sb.from('products').update({ images: r.images }).eq('id', r.id).select('id');
    if (error || !data || data.length === 0) {
      failed += 1;
      console.error(`${r.id}: ${error?.message ?? 'satir yok'}`);
    } else {
      written += 1;
    }
  }
  console.log(`restored=${written} failed=${failed}`);
  if (failed > 0) process.exit(1);
};

run().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : 'hata');
  process.exit(1);
});

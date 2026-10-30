import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { extractFloImages, extractLcwImages, planProductImages } from './galleryImages';
import { MANUAL_REVIEW_PRODUCT_IDS } from './variantRows';

// Cached pages only (no page requests). Reads with the anon key from .env; for --apply the
// service role key must be in this command's process env (never read from a file here).
loadEnv({ quiet: true });

const DATA_DIR = path.resolve(process.cwd(), 'scripts/data');
const CACHE_DIR = path.join(DATA_DIR, '.variants-cache');

interface Row {
  id: string;
  provider: string;
  product_url: string | null;
  image_url: string | null;
  images: unknown;
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];

const readPage = async (productUrl: string): Promise<string | null> => {
  const file = path.join(CACHE_DIR, `page-${createHash('sha1').update(productUrl).digest('hex')}.json`);
  try {
    const j = JSON.parse(await readFile(file, 'utf8')) as { status?: number; body?: string };
    return j.status === 200 && typeof j.body === 'string' ? j.body : null;
  } catch {
    return null;
  }
};

const client = (key: string) => {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (!url || !key) throw new Error('Supabase URL/key eksik.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
};

const loadAll = async (key: string): Promise<Row[]> => {
  const sb = client(key);
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('products')
      .select('id, provider, product_url, image_url, images')
      .in('provider', ['lcw', 'flo'])
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
};

interface Update {
  id: string;
  provider: string;
  before: string[];
  after: string[];
  added: number;
}

const run = async (): Promise<void> => {
  const apply = process.argv.includes('--apply');
  const head = process.argv.includes('--head');
  const readKey = apply ? process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() : process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const rows = await loadAll(readKey ?? '');
  const manual = new Set(MANUAL_REVIEW_PRODUCT_IDS);

  const updates: Update[] = [];
  const skippedNoise: Record<string, number> = {};
  const withPage: Record<string, number> = {};
  for (const r of rows) {
    if (manual.has(r.id) || !r.product_url) continue;
    const html = await readPage(r.product_url);
    if (!html) continue;
    withPage[r.provider] = (withPage[r.provider] ?? 0) + 1;
    const db = strings(r.images);
    const main = db[0] ?? r.image_url;
    const code = /^flo-(\d+)$/.exec(r.id)?.[1] ?? /\/(\d{6,})[-_]/.exec(main ?? '')?.[1] ?? '';
    const found = r.provider === 'lcw' ? extractLcwImages(html) : code ? extractFloImages(html, code) : [];
    const plan = planProductImages({ id: r.id, mainImage: main, dbImages: db, found });
    if (plan.skipped) skippedNoise[r.provider] = (skippedNoise[r.provider] ?? 0) + 1;
    if (plan.images) updates.push({ id: r.id, provider: r.provider, before: db, after: plan.images, added: plan.added });
  }

  const summary: Record<string, unknown> = {};
  for (const p of ['lcw', 'flo']) {
    const u = updates.filter((x) => x.provider === p);
    const dist: Record<string, number> = {};
    for (const x of u) {
      const total = x.after.length;
      const b = total >= 4 ? '4+' : String(total);
      dist[b] = (dist[b] ?? 0) + 1;
    }
    summary[p] = {
      pages: withPage[p] ?? 0,
      to_update: u.length,
      images_added: u.reduce((s, x) => s + x.added, 0),
      skipped_noise: skippedNoise[p] ?? 0,
      dist_total_images: dist,
    };
  }
  console.log(`mode: ${apply ? 'APPLY' : head ? 'HEAD' : 'dry-run'}`);
  console.log(JSON.stringify(summary));

  if (head) {
    const pick = (p: string, n: number) =>
      updates.filter((x) => x.provider === p).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / n)) === 0).slice(0, n)
        .map((x) => x.after[x.after.length - 1]);
    const urls = [...pick('flo', 3), ...pick('lcw', 3)];
    for (const u of urls) {
      const res = await fetch(u, { method: 'HEAD' });
      console.log(`${res.status} ${res.headers.get('content-type') ?? '-'} ${u}`);
    }
    return;
  }
  if (!apply) {
    console.log('dry-run: nothing written.');
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const backupFile = path.join(DATA_DIR, `images_backup_${stamp}.json`);
  await writeFile(backupFile, JSON.stringify(updates.map((x) => ({ id: x.id, images: x.before })), null, 2), 'utf8');
  console.log(`backup: ${path.relative(process.cwd(), backupFile)} (${updates.length} rows)`);

  const sb = client(readKey ?? '');
  let written = 0;
  let failed = 0;
  for (const x of updates) {
    const { data, error } = await sb.from('products').update({ images: x.after }).eq('id', x.id).select('id');
    if (error || !data || data.length === 0) {
      failed += 1;
      console.error(`${x.id}: ${error?.message ?? 'satir yok'}`);
    } else {
      written += 1;
    }
  }
  console.log(`written=${written} failed=${failed}`);
  if (failed > 0) process.exit(1);
};

run().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : 'hata');
  process.exit(1);
});

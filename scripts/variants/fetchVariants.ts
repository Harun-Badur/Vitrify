import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { parseFlo } from './parsers/flo';
import { parseLcw } from './parsers/lcw';
import { createFetcher } from './polite';
import type { VariantParser, VariantRecord } from './types';

loadEnv();

const PARSERS: Record<string, VariantParser> = { lcw: parseLcw, flo: parseFlo };
const DATA_DIR = path.resolve(process.cwd(), 'scripts/data');
const CACHE_DIR = path.join(DATA_DIR, '.variants-cache');
const OUT_FILE = path.join(DATA_DIR, 'variants_pilot.json');

interface ProductRow {
  id: string;
  provider: string;
  product_url: string;
}

const parseArgs = (): { perProvider: number } => {
  const arg = process.argv.find((a) => a.startsWith('--per-provider='));
  const n = arg ? Number(arg.split('=')[1]) : 5;
  return { perProvider: Number.isFinite(n) && n > 0 ? n : 5 };
};

/** Read-only SELECT with the public anon key; nothing is ever written to the DB. */
const loadProducts = async (perProvider: number): Promise<ProductRow[]> => {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) throw new Error('Supabase URL/anon key eksik.');
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rows: ProductRow[] = [];
  for (const provider of Object.keys(PARSERS)) {
    let query = supabase
      .from('products')
      .select('id, provider, product_url')
      .eq('provider', provider)
      .not('product_url', 'is', null)
      .order('id', { ascending: true });
    if (perProvider < 1000) query = query.limit(perProvider);
    const { data, error } = await query;
    if (error) throw new Error(`Ürünler okunamadı (${provider}): ${error.message}`);
    rows.push(...((data ?? []) as ProductRow[]));
  }
  return rows;
};

const run = async (): Promise<void> => {
  const { perProvider } = parseArgs();
  const products = await loadProducts(perProvider);
  const fetcher = createFetcher(CACHE_DIR);
  const records: VariantRecord[] = [];
  const errors: Record<string, number> = {};
  const bump = (k: string): void => {
    errors[k] = (errors[k] ?? 0) + 1;
  };

  for (const p of products) {
    const parser = PARSERS[p.provider];
    const base = {
      product_id: p.id,
      provider: p.provider,
      product_url: p.product_url,
      fetched_at: new Date().toISOString(),
    };
    if (!parser) continue;
    const outcome = await fetcher.fetchPage(p.product_url);
    if (outcome.kind !== 'ok') {
      const reason = outcome.reason;
      bump(`${p.provider}:${reason}`);
      records.push({ ...base, colors: [], sizes: [], found: false, error: reason });
      continue;
    }
    const parsed = parser(outcome.html, p.product_url);
    const found = parsed.colors.length > 0 || parsed.sizes.length > 0;
    if (!found) bump(`${p.provider}:no_structured_data`);
    records.push({ ...base, ...parsed, found });
  }

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(records, null, 2), 'utf8');

  for (const provider of Object.keys(PARSERS)) {
    const rs = records.filter((r) => r.provider === provider);
    const withColors = rs.filter((r) => r.colors.length > 0).length;
    const withSizes = rs.filter((r) => r.sizes.length > 0).length;
    const withStock = rs.filter((r) => r.sizes.some((s) => s.inStock !== undefined)).length;
    console.log(
      `${provider}: products=${rs.length} colors=${withColors} sizes=${withSizes} inStock=${withStock}`,
    );
  }
  console.log('errors:', JSON.stringify(errors));
  console.log('blocked hosts:', JSON.stringify([...fetcher.blockedHosts()]));
  console.log(`network requests: ${fetcher.networkRequests()}`);
  records
    .filter((r) => r.found)
    .slice(0, 3)
    .forEach((r) =>
      console.log(
        `sample ${r.provider} ${r.product_id.slice(0, 8)} colors=${r.colors.map((c) => c.name).slice(0, 4).join('/')} sizes=${r.sizes.map((s) => s.label).slice(0, 6).join(',')}`,
      ),
    );
};

run().catch((error: unknown) => {
  console.error(`Varyant pilotu başarısız: ${error instanceof Error ? error.message : 'bilinmeyen hata'}`);
  process.exit(1);
});

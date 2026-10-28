import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { runInNewContext } from 'node:vm';
import { transpileModule, ModuleKind } from 'typescript';

const file = resolve(__dirname, '../supabase/functions/recs-feed/index.ts');
const source = readFileSync(file, 'utf8');
function fixture(options: { empty?: boolean; errors?: Record<string, string>; throws?: string; profile?:Record<string,unknown>; profileMode?:Record<string,unknown>; extraProducts?: Record<string, unknown>[] } = {}) {
  let handler: ((request: Request) => Promise<Response>) | undefined;
  const filters: Array<[string, string, unknown]> = [];
  const products = [
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `fixture-${index}`, provider: 'flo', external_id: `fixture-${index}`,
      title: `Siyah Fixture ${index}`, brand: 'Fixture', price: 100, currency: 'TRY',
      image_url: 'https://example.invalid/image.jpg', product_url: 'https://example.invalid/product',
      category: 'shoes', affiliate_url: null, created_at: '2026-10-12T00:00:00Z', feed_eligible: true,
    })),
    ...(options.extraProducts ?? []),
  ];
  const getUser = jest.fn(async (token: string) => ({
    data: { user: token === 'valid' ? { id: 'test-owner' } : null }, error: null,
  }));
  const from = jest.fn((table: string) => {
    if (options.throws === table) throw new Error('private-sql-detail test-owner fixture-0');
    let selection = '';
    const result = () => {
      const fault = options.errors?.[table];
      const legacySuccess = fault === 'column outfit_role does not exist' && !selection.includes('outfit_role');
      return { data: fault && !legacySuccess ? null : table === 'products' && !options.empty ? products : table==='recs_config' && options.profileMode ? [{key:'style_profile_v2',value:options.profileMode,updated_at:'2026-10-13T00:00:00Z'}] : [],
        error: fault && !legacySuccess ? { message: fault } : null };
    };
    const query = {
      select: (columns: string) => { selection = columns; return query; },
      eq: (column: string, value: unknown) => { filters.push([table, column, value]); return query; },
      gte: () => query,
      maybeSingle: async () => ({ ...result(), data: table==='user_style_profiles'?options.profile??null:null }),
      then: (fulfilled: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(fulfilled),
    };
    return query;
  });
  const logs = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  runInNewContext(transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText, {
    exports: {},
    require: (name: string) => name === 'jsr:@supabase/supabase-js@2'
      ? { createClient: () => ({ auth: { getUser }, from }) }
      : require(resolve(dirname(file), name)),
    Deno: { serve: (value: typeof handler) => { handler = value; }, env: { get: () => 'local-fixture' } },
    Request, Response, crypto: { randomUUID: () => 'fixture-response-id' },
    console: logs,
  });
  if (!handler) throw new Error('Handler not registered');
  return { handler, filters, from, getUser, logs };
}
const request = (body: object, token = 'valid') => new Request('https://example.invalid/recs-feed', {
  method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body),
});
test('V2 stale profile is suppressed without blocking catalog or adding queries',async()=>{
 const f=fixture({profileMode:{algorithm:'style-preference-v2',legacy_policy:'exclude_with_approval',activated_at:'2026-10-13T12:00:00Z'},
  profile:{user_id:'test-owner',color_w:{red:1},subcategory_w:{},brand_w:{},fit_w:{},price_band_w:{},style_tag_weights:{},negative_preferences:[],computed_at:'2026-10-12T12:00:00Z'}});
 const response=await f.handler(request({limit:20}));expect(response.status).toBe(200);
 expect((await response.json()).items).toHaveLength(20);expect(response.headers.get('X-Recs-Warnings')).toContain('PROFILE_STALE');
 expect(f.from.mock.calls.filter(([table])=>table==='recs_config')).toHaveLength(1);
 expect(f.from.mock.calls.filter(([table])=>table==='user_style_profiles')).toHaveLength(1);
});
test('rows with no usable color stay out of ranking and do not change the eligible order', async () => {
  const baseline = fixture();
  const baselineIds = (await (await baseline.handler(request({ limit: 20 }))).json()).items.map(
    (item: { product: { id: string } }) => item.product.id,
  );
  const f = fixture({ extraProducts: [
    { id: 'missing-color', provider: 'flo', external_id: 'missing-color', title: 'Duz Model',
      brand: 'Fixture', price: 100, currency: 'TRY', image_url: 'https://example.invalid/image.jpg',
      product_url: 'https://example.invalid/product', category: 'shoes', affiliate_url: null,
      created_at: '2026-10-12T00:00:00Z', feed_eligible: true },
    { id: 'missing-category', provider: 'flo', external_id: 'missing-category', title: 'Siyah No Category',
      brand: 'Fixture', price: 100, currency: 'TRY', image_url: 'https://example.invalid/image.jpg',
      product_url: 'https://example.invalid/product', category: 'not-a-category', affiliate_url: null,
      created_at: '2026-10-12T00:00:00Z', feed_eligible: true },
  ] });
  const response = await f.handler(request({ limit: 20 }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.items.map((item: { product: { id: string } }) => item.product.id)).toEqual(baselineIds);
  expect(body.items).toHaveLength(20);
});

test('only stored feed_eligible=true rows are ranked; the query filters on the flag', async () => {
  const ineligible = (id: string, flag: unknown) => ({ id, provider: 'flo', external_id: id, title: 'Siyah Fixture',
    brand: 'Fixture', price: 100, currency: 'TRY', image_url: 'https://example.invalid/image.jpg',
    product_url: 'https://example.invalid/product', category: 'shoes', affiliate_url: null,
    created_at: '2026-10-12T00:00:00Z', feed_eligible: flag });
  const f = fixture({ extraProducts: [ineligible('flag-false', false), ineligible('flag-null', null),
    { ...ineligible('flag-missing', undefined), feed_eligible: undefined }] });
  const response = await f.handler(request({ limit: 50 }));
  expect(response.status).toBe(200);
  const ids = (await response.json()).items.map((item: { product: { id: string } }) => item.product.id);
  expect(ids).toHaveLength(20);
  expect(ids).not.toEqual(expect.arrayContaining(['flag-false']));
  expect(ids.filter((id: string) => id.startsWith('flag-'))).toEqual([]);
  expect(f.filters).toContainEqual(['products', 'feed_eligible', true]);
});

test('real handler retains 200 response shape and can rank 20 FLO rows without profile', async () => {
  const f = fixture(); const response = await f.handler(request({ limit: 20 }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ recommendation_id: 'fixture-response-id', score_id: 'fixture-response-id',
    has_more: false, fallback: false, relaxed: [] });
  expect(body.items).toHaveLength(20);
  expect(response.headers.has('X-Recs-Warnings')).toBe(false);
  expect(f.filters).toContainEqual(['user_style_profiles', 'user_id', 'test-owner']);
  expect(f.filters).toContainEqual(['user_events', 'user_id', 'test-owner']);
});

test('catalog SQL failure is 503 with a fixed code, never successful empty results', async () => {
  const f = fixture({ errors: { products: 'private-sql-detail test-owner fixture-0' } });
  const response = await f.handler(request({}));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ code: 'FEED_CATALOG_READ_FAILED', detail: 'Öneri verileri okunamadı. Lütfen tekrar dene.' });
  expect(JSON.stringify(f.logs.error.mock.calls)).toContain('FEED_CATALOG_READ_FAILED');
  expect(JSON.stringify([...f.logs.error.mock.calls, ...f.logs.warn.mock.calls])).not.toMatch(/private-sql-detail|test-owner|fixture-0/);
});

test('successful empty catalog remains HTTP 200 with exhausted pagination', async () => {
  const f = fixture({ empty: true }); const response = await f.handler(request({}));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ items: [], has_more: false, fallback: false, relaxed: [] });
  expect(f.logs.error).not.toHaveBeenCalled();
});
test.each([
  ['user_style_profiles', 'FEED_PROFILE_READ_FAILED'],
  ['product_attributes', 'FEED_ATTRIBUTES_READ_FAILED'],
])('required %s error is explicit and sanitized', async (table, code) => {
  const f = fixture({ errors: { [table]: 'private-sql-detail test-owner fixture-0' } });
  const response = await f.handler(request({}));
  expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code });
  expect(JSON.stringify(f.logs.error.mock.calls)).toContain(code);
  expect(JSON.stringify([...f.logs.error.mock.calls, ...f.logs.warn.mock.calls])).not.toMatch(/private-sql-detail|test-owner|fixture-0/);
});
test.each([
  ['recs_config', 'CONFIG_FALLBACK'], ['style_tag_priors', 'PRIORS_FALLBACK'],
  ['user_events', 'IMPRESSION_HISTORY_FALLBACK'],
])('optional %s fallback is visible and sanitized', async (table, code) => {
  const f = fixture({ errors: { [table]: 'private-sql-detail test-owner fixture-0' } });
  const response = await f.handler(request({}));
  expect(response.status).toBe(200); expect((await response.json()).items).toHaveLength(20);
  expect(response.headers.get('X-Recs-Warnings')).toBe(table==='recs_config'?code+',PROFILE_FRESHNESS_UNVERIFIED':code);
  expect(response.headers.get('Access-Control-Expose-Headers')).toContain('X-Recs-Warnings');
  expect(JSON.stringify(f.logs.warn.mock.calls)).toContain(code);
  expect(JSON.stringify([...f.logs.error.mock.calls, ...f.logs.warn.mock.calls])).not.toMatch(/private-sql-detail|test-owner|fixture-0/);
});
test('cached optional fallback remains explicit on the next request', async () => {
  const f = fixture({ errors: { style_tag_priors: 'private-sql-detail' } });
  await f.handler(request({}));
  const response = await f.handler(request({}));
  expect(response.headers.get('X-Recs-Warnings')).toBe('PRIORS_FALLBACK');
  expect(f.from.mock.calls.filter(([table]) => table === 'style_tag_priors')).toHaveLength(1);
});
test('legacy outfit_role retry keeps feed working but reports the fallback', async () => {
  const f = fixture({ errors: { product_attributes: 'column outfit_role does not exist' } });
  const response = await f.handler(request({}));
  expect(response.status).toBe(200); expect((await response.json()).items).toHaveLength(20);
  expect(response.headers.get('X-Recs-Warnings')).toBe('ATTRIBUTES_LEGACY_SCHEMA');
});
test('unexpected read exception is a sanitized error rather than a successful empty feed', async () => {
  const f = fixture({ throws: 'products' }); const response = await f.handler(request({}));
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ code: 'FEED_INTERNAL_FAILED' });
  expect(JSON.stringify(f.logs.error.mock.calls)).not.toMatch(/private-sql-detail|test-owner|fixture-0/);
});
test('JWT denial happens before any table reads', async () => {
  const f = fixture();
  expect((await f.handler(request({}, ''))).status).toBe(401);
  expect((await f.handler(request({}, 'invalid'))).status).toBe(401);
  expect(f.from).not.toHaveBeenCalled();
});
test('limit, exclusion pagination and hard category filters retain their contracts', async () => {
  const f = fixture();
  const first = await (await f.handler(request({ limit: 5 }))).json();
  expect(first.items).toHaveLength(5); expect(first.has_more).toBe(true);
  const excluded = first.items.map((item: { product: { id: string } }) => item.product.id);
  const next = await (await f.handler(request({ limit: 20, exclude_ids: excluded }))).json();
  expect(next.items).toHaveLength(15); expect(next.has_more).toBe(false);
  next.items.forEach((item: { product: { id: string } }) => expect(excluded).not.toContain(item.product.id));
  const filtered = await (await f.handler(request({ intent: { constraints: { category: 'upper_body' } } }))).json();
  expect(filtered.items).toEqual([]); expect(filtered.has_more).toBe(false);
});

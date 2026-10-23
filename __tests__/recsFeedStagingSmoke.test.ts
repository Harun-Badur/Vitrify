const { run } = require('../scripts/backend/recs-feed-staging-smoke.cjs');
const jwt = (payload: Record<string, unknown>) => `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.fixture`;
const url = 'https://sdjxseqfkturkfohkfni.supabase.co';
const env = () => ({ STAGING_SUPABASE_URL: url, STAGING_TEST_ACCOUNT_CONFIRMED: 'true',
  STAGING_ANON_KEY: jwt({ ref: 'sdjxseqfkturkfohkfni', role: 'anon', exp: 4102444800 }),
  STAGING_USER_JWT: jwt({ iss: `${url}/auth/v1`, role: 'authenticated', sub: 'fixture', exp: 4102444800 }) });
test('wrong target blocks before any request', async () => {
  const fetcher = jest.fn();
  await expect(run({ ...env(), STAGING_SUPABASE_URL: 'https://example.invalid' }, fetcher)).rejects.toThrow('TARGET_BLOCKED');
  expect(fetcher).not.toHaveBeenCalled();
});
test('service-role key blocks before any request', async () => {
  const fetcher = jest.fn();
  await expect(run({ ...env(), STAGING_ANON_KEY: jwt({ role: 'service_role' }) }, fetcher)).rejects.toThrow('KEY_BLOCKED');
  expect(fetcher).not.toHaveBeenCalled();
});
test('read-only authenticated smoke emits only fixed results and counts', async () => {
  const emit = jest.fn();
  const fetcher = jest.fn(async (target: string, options: RequestInit) => {
    if (target.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'fixture' }));
    const headers = options.headers as Record<string, string>;
    if (headers.Authorization !== `Bearer ${env().STAGING_USER_JWT}`) return new Response('{}', { status: 401 });
    return new Response(JSON.stringify({ items: [{ product: { id: 'product-fixture', provider: 'flo',
      title: 'Fixture', imageUrl: 'https://example.invalid/image.jpg', price: 100 }, score: 1 }], has_more: false }));
  });
  await run(env(), fetcher, emit);
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(fetcher.mock.calls.map(([, options]) => options.method)).toEqual(['GET','POST','POST','POST']);
  expect(emit.mock.calls.flat()).toEqual(['AUTH PASS','NO_JWT PASS','INVALID_JWT PASS','FEED PASS HTTP_200 COUNT_1']);
});
test('empty 200 is a failure rather than fake acceptance', async () => {
  const fetcher = jest.fn(async (target: string, options: RequestInit) => {
    if (target.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'fixture' }));
    const headers = options.headers as Record<string, string>;
    return headers.Authorization === `Bearer ${env().STAGING_USER_JWT}`
      ? new Response(JSON.stringify({ items: [], has_more: false })) : new Response('{}', { status: 401 });
  });
  await expect(run(env(), fetcher)).rejects.toThrow('FEED_EMPTY');
});

import { readCachedFinals } from '../services/discoverRecommendationCacheService';
import { getSupabaseClient } from '../lib/supabase';
jest.mock('../lib/supabase', () => ({ getSupabaseClient: jest.fn() }));

function client() {
  const scopes: unknown[] = [];
  const from = jest.fn();
  const q: any = { select: () => q, eq: () => q, gt: () => q, abortSignal: () => q,
    in: (column: string, values: unknown) => { if (column === 'scope') scopes.push(values); return q; },
    limit: () => Promise.resolve({ data: [], error: null }) };
  from.mockReturnValue(q);
  jest.mocked(getSupabaseClient).mockReturnValue({ from } as never);
  return { scopes, from };
}
const read = (productPref: unknown, owner: string | null) =>
  readCachedFinals({ anchors: [], productPref } as never, owner, new AbortController().signal);

test.each([undefined, null, 'hepsi'])('productPref %p keeps the public cache scope', async pref => {
  const c = client();
  await read(pref, 'A'); await read(pref, null);
  expect(c.scopes).toEqual([['public', 'A'], ['public']]);
});
test.each(['kadin', 'erkek'])('productPref %s skips the public cache scope', async pref => {
  const c = client();
  expect(await read(pref, 'A')).toEqual([]);
  expect(c.scopes).toEqual([['A']]);
});
test('signed-out non-hepsi preference reads no cache at all', async () => {
  const c = client();
  expect(await read('kadin', null)).toEqual([]);
  expect(c.from).not.toHaveBeenCalled();
});

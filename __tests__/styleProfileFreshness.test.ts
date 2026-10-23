import { styleProfileFreshness } from '../supabase/functions/_shared/styleProfileFreshness';
const gate={algorithm:'style-preference-v2',legacy_policy:'exclude_with_approval',activated_at:'2026-10-13T12:00:00.123Z'};
test('V1 mode keeps existing semantics',()=>{expect(styleProfileFreshness(undefined,'old')).toBe('v1');});
test('V2 cutoff never accepts stale or equal-millisecond V1 row',()=>{
 for(const stamp of ['2026-10-13T11:59:59Z','2026-10-13T12:00:00.123Z','2026-10-13T12:00:00.123456Z',null,'broken'])
  expect(styleProfileFreshness(gate,stamp)).toBe('stale');
 expect(styleProfileFreshness(gate,'2026-10-13T12:00:00.124Z')).toBe('v2_fresh');
});
test('missing cutoff or wrong legacy policy cannot validate V2',()=>{
 expect(styleProfileFreshness({...gate,activated_at:undefined},'2026-10-13T13:00:00Z')).toBe('unverified');
 expect(styleProfileFreshness({...gate,legacy_policy:'preserve_v1'},'2026-10-13T13:00:00Z')).toBe('unverified');
});

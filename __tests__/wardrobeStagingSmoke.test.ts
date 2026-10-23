const smoke = require('../scripts/backend/wardrobe-staging-smoke.cjs');

test('staging runner rejects wrong target, missing explicit approval and elevated JWT', () => {
  const jwt = (role: string) => `x.${Buffer.from(JSON.stringify({role})).toString('base64url')}.x`;
  const env = {WARDROBE_STAGING_URL: smoke.STAGING, WARDROBE_ALLOW_TEST_WRITES:'yes',
    WARDROBE_DISPOSABLE_USERS_ONLY:'yes', WARDROBE_STAGING_ANON_KEY:jwt('anon'),
    WARDROBE_USER_A_JWT:jwt('authenticated'), WARDROBE_USER_B_JWT:jwt('authenticated'),
    WARDROBE_USER_A_ID:'a', WARDROBE_USER_B_ID:'b'};
  expect(() => smoke.config({...env, WARDROBE_STAGING_URL:'https://production.invalid'})).toThrow();
  expect(() => smoke.config({...env, WARDROBE_ALLOW_TEST_WRITES:''})).toThrow();
  expect(() => smoke.config({...env, WARDROBE_USER_A_JWT:jwt('service_role')})).toThrow();
  expect(() => smoke.config({...env, WARDROBE_STAGING_ANON_KEY:jwt('service_role')})).toThrow();
});

test('failed assertion still cleans only generated fixture IDs and verifies remaining counts', async () => {
  const calls: any[] = [];
  const make = () => ({count:async () => ({items:0,outfits:0,relations:0}),
    rpc:async () => ({data:null,error:{code:'XX000',message:'secret user payload'}}),
    cleanup:async (ids:any) => {calls.push(ids);}, remaining:async () => 0});
  const labels: string[] = [];
  const result = await smoke.runCases(make(), make(), 'a', 'b', (s:string) => labels.push(s));
  expect(result.ok).toBe(false); expect(result.cleanup).toBe(true);
  expect(calls).toHaveLength(2);
  expect(calls[0].item).toMatch(/^[0-9a-f-]{36}$/);
  expect(calls[0].outfits).toHaveLength(2);
  expect(calls[1].item).toBeNull(); expect(calls[1].outfits).toHaveLength(1);
  expect(labels.join(' ')).not.toMatch(/secret|payload|XX000/);
});

test('cleanup failure is not reported as success', async () => {
  const port = {count:async () => ({items:0,outfits:0,relations:0}),
    rpc:async () => ({error:{code:'XX000'}}), cleanup:async () => {throw Error('credential');}, remaining:async () => 0};
  const result = await smoke.runCases(port,port,'a','b',()=>{});
  expect(result.ok).toBe(false); expect(result.cleanup).toBe(false);
});

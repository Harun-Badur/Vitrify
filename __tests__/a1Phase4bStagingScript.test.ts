import { readFileSync } from 'node:fs';
it('operator smoke is staging-bound, synthetic-only, redacts data and tests cleanup/ownership',()=>{
  const source=readFileSync('scripts/backend/a1-phase4b-staging-smoke.cjs','utf8');
  expect(source).toContain('https://sdjxseqfkturkfohkfni.supabase.co');
  expect(source).toContain('A1_SYNTHETIC_FIXTURES_ONLY');expect(source).toContain('A1_STAGING_SERVICE_ROLE_KEY');
  expect(source).toContain('finally');expect(source).toContain('T11');expect(source).toContain('T2');
  expect(source).toContain('UNINVENTORIED_STAGING_USER_TABLE');
  expect(source).toContain("select count(*)::int as count from auth.users");
  expect(source).not.toMatch(/console\.(log|error)|process\.stdout\.write\([^\n]*(?:password|jwt|serviceKey)/i);
});

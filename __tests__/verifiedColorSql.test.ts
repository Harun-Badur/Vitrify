import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateVerifiedColorScope, renderVerifiedColorSql } from '../scripts/lib/verifiedColorSql';

const proposal = JSON.parse(readFileSync(resolve(__dirname, '../reports/release/catalog-v1-20261016/color-fill-proposal.json'), 'utf8'));

test('binds exactly 66 unique empty fields and excludes conflicting/unapproved decisions', () => {
  expect(() => validateVerifiedColorScope(proposal)).not.toThrow();
  for (const altered of [
    { ...proposal, patches: proposal.patches.slice(1) },
    { ...proposal, patches: [...proposal.patches.slice(1), proposal.patches[1]] },
    { ...proposal, patches: [{ ...proposal.patches[0], expected_colors: ['siyah'] }, ...proposal.patches.slice(1)] },
    { ...proposal, conflicts: [{ product_id: proposal.patches[0].product_id }] },
    { ...proposal, sourceReviewSha256: 'changed' },
  ]) expect(() => validateVerifiedColorScope(altered)).toThrow();
});

test('guards the intended main target, verifies the entire scope before commit, and rejects changed identity', () => {
  const sql = renderVerifiedColorSql(proposal);
  expect(sql).toContain('hnujkabyyrlsxohjhxlg');
  expect(sql).toContain("current_setting('vitrify.target_project_ref', true)");
  expect(sql).toContain('for share');
  expect(sql).toContain('for update');
  expect(sql).toContain('verified <> 66');
  expect(sql.indexOf('verified <> 66')).toBeLessThan(sql.indexOf('commit;'));
  expect(sql).not.toMatch(/\b(delete|truncate|alter|drop)\s/i);
});

test('the production runner rejects wrong targets and missing explicit approval before connecting', async () => {
  const runner = require('../reports/release/catalog-v1-20261016/apply-66-colors.cjs');
  expect(runner.checkPackage().manifest.scopeCount).toBe(66);
  expect(() => runner.validateDbTarget({ host: 'db.sdjxseqfkturkfohkfni.supabase.co', port: '5432', user: 'postgres', database: 'postgres', password: 'fixture' })).toThrow('DB_TARGET_MISMATCH');
  expect(() => runner.validateDbTarget({ host: 'aws-0-eu-central-1.pooler.supabase.com', port: '5432', user: 'postgres.other', database: 'postgres', password: 'fixture' })).toThrow('DB_TARGET_MISMATCH');
  await expect(runner.run({ approval: '' })).rejects.toThrow('EXPLICIT_66_COLOR_APPROVAL_REQUIRED');
});

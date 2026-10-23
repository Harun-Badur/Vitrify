import { readFileSync } from 'node:fs';

test('revocation patch expands targets once and matches owner/product/action without changing legacy branch', () => {
  const sql = readFileSync('reports/backend/proposals/20261013_style_v2_revocation_lookup_performance.sql', 'utf8');
  expect(sql).toContain('revoked as materialized');
  expect(sql).toContain('unnest(cancel.revokes)');
  expect(sql).toContain('r.user_id=a.user_id and r.product_id=a.product_id and r.action_id=a.action_id');
  expect(sql).not.toContain('a.action_id=any(cancel.revokes)');
  expect(sql).toContain("p_legacy_policy='preserve_v1'");
  expect(sql).toContain('452972666bba9de777629473fff8afdd');
  expect(sql).not.toMatch(/\b(?:grant|revoke|delete|insert|update)\b\s+(?:execute|all|from|into|public\.)/i);
});

test('real PostgreSQL equivalence test covers null/duplicate targets, cross-product/owner and both policies', () => {
  const sql = readFileSync('supabase/tests/style_v2_revocation_equivalence_local.sql', 'utf8');
  for (const code of ['REVOCATION_EXCLUDE_EQUIVALENT', 'REVOCATION_PRESERVE_EQUIVALENT',
    'REVOCATION_PROFILE_EQUIVALENT', 'REVOCATION_WRONG_OWNER_DENIED', 'REVOCATION_INSTALL_ROLLBACK']) {
    expect(sql).toContain(code);
  }
});

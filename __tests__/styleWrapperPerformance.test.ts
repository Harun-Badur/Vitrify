import { readFileSync } from 'node:fs';

test('V1 candidate uses native UUID validation and keeps exact mirror matching before history limit', () => {
  const sql = readFileSync('reports/backend/proposals/20261013_style_v1_mirror_lookup_performance.sql', 'utf8');
  expect(sql).toContain("pg_input_is_valid(e.payload->>'action_id','uuid')");
  expect(sql).toContain("registered.action_id::text=e.payload->>'action_id'");
  expect(sql.indexOf('and coalesce')).toBeLessThan(sql.indexOf('limit 1000'));
});

test('benchmark records individual calls and real query plans, not p95 of batch averages', () => {
  const sql = readFileSync('supabase/tests/style_wrapper_performance_local.sql', 'utf8');
  expect(sql).toContain('percentile_cont(0.95)');
  expect(sql).toContain('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)');
  expect(sql).toContain('SAMPLES_100_PER_PATH_');
});

test('activation benchmark exercises real V2 canonical history and committed RPC separately', () => {
  const sql = readFileSync('supabase/tests/style_v2_activation_performance_local.sql', 'utf8');
  expect(sql).toContain('exclude_with_approval');
  expect(sql).toContain('repeated_eight_products');
  expect(sql).toContain('public.style_apply_preference_v2(');
  expect(sql).toContain('percentile_cont(0.95)');
  expect(sql).toContain('V2_BENCH_LEGACY_ROWS_PRESERVED');
});

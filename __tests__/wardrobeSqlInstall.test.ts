import { readFileSync } from 'fs';

const tables = readFileSync('supabase/deferred/20260924_wardrobe_outfits_v1.sql', 'utf8');
const rpc = readFileSync('reports/backend/proposals/20261012_wardrobe_cloud_persistence.sql', 'utf8');

test('table installation is transactional and stops before DDL on dependency drift or existing objects', () => {
  expect(tables).toMatch(/begin;/i);
  expect(tables).toMatch(/commit;/i);
  expect(tables).toContain('Wardrobe installation requires absent target objects');
  expect(tables).toContain('Wardrobe dependency mismatch');
  expect(tables.indexOf('Wardrobe dependency mismatch')).toBeLessThan(tables.indexOf('create table'));
  expect(tables).not.toMatch(/create table if not exists|create or replace function/i);
});

test('row versions strictly advance even for multiple updates in one transaction', () => {
  expect(tables).toContain("greatest(clock_timestamp(), old.updated_at + interval '1 microsecond')");
  expect(tables).toContain('revoke all on public.wardrobe_items, public.outfits, public.outfit_items from public, anon');
});

test('RPC ownership, CAS, row locks and fail-atomic outfit changes remain intact', () => {
  expect(rpc).not.toMatch(/security definer|exception\s+when/i);
  expect(rpc).toContain('who is distinct from p_owner');
  expect(rpc).toContain('current_version is distinct from p_expected');
  expect(rpc.match(/for update;/g)).toHaveLength(2);
  expect(rpc).toContain('Foreign or missing wardrobe reference');
  expect(rpc).toContain('RPC installation requires absent target functions');
  expect(rpc).toContain('RPC table prerequisites mismatch');
  expect(rpc.indexOf('RPC table prerequisites mismatch')).toBeLessThan(rpc.indexOf('create function'));
  expect(rpc).toContain('from public,anon');
  expect(rpc).toContain('commit;');
});

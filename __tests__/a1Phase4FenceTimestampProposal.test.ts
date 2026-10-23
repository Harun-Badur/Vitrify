import { readFileSync } from 'node:fs';

const proposal = 'reports/backend/proposals/20261012_a1_phase4_fence_timestamp.sql';
const migration18 = 'reports/backend/isolated-a1-migration20/supabase/migrations/20261011000018_vitrify_a1_18.sql';

describe('FAZ 4 first prerequisite — unapplied timestamp proposal only', () => {
  it('persists first fence time without resetting it on retry', () => {
    const sql = readFileSync(proposal, 'utf8').split('-- ROLLBACK')[0];
    expect(sql).toContain('add column fenced_at timestamptz');
    expect(sql).toContain('fenced_at=coalesce(fenced_at,clock_timestamp())');
    expect(sql).not.toMatch(/create\s+table/i);
    expect(sql).toContain("interval '120 seconds'");
    expect(sql).toContain("return jsonb_build_object('receipt',entry.receipt,'lease',token)");
  });
  it('backfills legacy fenced rows conservatively and supplies rollback', () => {
    const sql = readFileSync(proposal, 'utf8');
    expect(sql).toContain('where fenced and fenced_at is null');
    expect(sql).toContain('-- ROLLBACK');
    expect(sql).toContain('drop column fenced_at');
    expect(sql).toContain('lease_held_by_other');
  });
  it('migration 18 attaches fence triggers to writes, not DELETE', () => {
    const sql = readFileSync(migration18, 'utf8');
    expect(sql).toContain('deletion_storage_metadata_fence before insert or update on storage.objects');
    expect(sql).toContain('deletion_auth_metadata_fence before update on auth.users');
    expect(sql).toContain('account_deletion_fence before insert or update on public.%I');
    expect(sql).not.toMatch(/create trigger[^;]+before[^;]*\bdelete\b/i);
  });
});

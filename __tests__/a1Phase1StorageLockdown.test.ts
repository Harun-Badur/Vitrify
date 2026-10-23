import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const proposal = () => readFileSync(resolve(root, 'reports/backend/proposals/20261011_a1_phase1_storage_policy_removal.sql'), 'utf8');
const smoke = () => require('../scripts/backend/a1-phase1-storage-smoke.cjs');

describe('A1 phase 1 operator contract (not a live RLS test)', () => {
  it('new cutover removes the old DELETE exception only with the Edge removal binding', () => {
    const sql=readFileSync(resolve(root,'reports/backend/proposals/20261014_a1_storage_policy_cutover.sql'),'utf8');
    expect(sql).toContain('drop policy model_photos_delete_own');
    expect(sql).toContain('Storage policy fingerprint mismatch');
    expect(sql).toContain('Storage RLS must remain enabled');
    expect(sql).toContain('Client RLS bypass role detected');
    expect(sql).toContain('Client can assume RLS bypass authority');
    expect(sql).toContain('Client Storage write policy remains');
    expect(sql).toContain("pg_has_role(client.oid,policy_role.oid,'USAGE')");
    expect(sql).not.toMatch(/revoke insert,update,delete on storage\.(objects|buckets)/i);
    const profile=readFileSync(resolve(root,'services/profileService.ts'),'utf8');
    expect(profile).toContain("method: 'DELETE'"); expect(profile).toContain('vitrify.storage-remove.v1');
    expect(profile).not.toMatch(/[.]remove\(\[path\]\)/);
  });
  it('removes four write policies while preserving the explicit model DELETE exception', () => {
    const sql = proposal().split('-- ROLLBACK SQL')[0];
    for (const policy of ['model_photos_insert_own', 'model_photos_update_own', 'wardrobe_cutouts_insert_own', 'wardrobe_cutouts_update_own']) {
      expect(sql).toContain(`drop policy ${policy} on storage.objects;`);
    }
    expect(sql).not.toMatch(/drop policy .*select|drop policy model_photos_delete_own|as restrictive/i);
    expect(proposal()).toContain('-- ROLLBACK SQL');
  });
  it('does not mistake an expired JWT, network error or missing bucket for an RLS denial', () => {
    const { requireWriteDenial } = smoke();
    for (const error of [{ statusCode: '401' }, { statusCode: '404' }, { statusCode: '500' }, { statusCode: '400', message: 'Invalid bucket' }, null]) {
      expect(() => requireWriteDenial({ error })).toThrow('WRITE_NOT_PROVEN_DENIED');
    }
    expect(() => requireWriteDenial({ error: { statusCode: '403' } })).not.toThrow();
    expect(() => requireWriteDenial({ error: { statusCode: '400', message: 'new row violates row-level security policy' } })).not.toThrow();
  });
  it('accepts silent filtered DELETE only when the existing fixture remains readable', () => {
    const { requireRemoveDenial } = smoke();
    expect(() => requireRemoveDenial({ data: [], error: null }, true)).not.toThrow();
    expect(() => requireRemoveDenial({ data: [], error: null }, false)).toThrow();
    expect(() => requireRemoveDenial({ data: [{ name: 'removed' }], error: null }, true)).toThrow();
    expect(() => requireRemoveDenial({ error: { statusCode: '401' } }, true)).toThrow();
  });
  it('refuses every target except the named staging project before sending requests', () => {
    const { requireStaging } = smoke();
    expect(() => requireStaging('https://sdjxseqfkturkfohkfni.supabase.co')).not.toThrow();
    for (const url of ['https://hnujkabyyrlsxohjhxlg.supabase.co', 'http://localhost:54321', 'https://example.com', 'https://sdjxseqfkturkfohkfni.supabase.co/other']) {
      expect(() => requireStaging(url)).toThrow('STAGING_TARGET_REQUIRED');
    }
  });
  it('rejects service-role credentials in the synthetic user JWT slots', () => {
    const { requireUserJwt } = smoke();
    const jwt = (role: string) => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
    expect(() => requireUserJwt(jwt('authenticated'))).not.toThrow();
    for (const role of ['service_role', 'anon', '']) expect(() => requireUserJwt(jwt(role))).toThrow();
    expect(() => requireUserJwt('not-a-jwt')).toThrow();
  });
  it('audits all policies and effective PUBLIC/client grants with only a SELECT', () => {
    const sql = readFileSync(resolve(root, 'reports/backend/proposals/20261011_a1_phase1_storage_configuration_check.sql'), 'utf8')
      .replace(/--[^\n]*/g, '');
    expect(sql.trim()).toMatch(/^with clients as/i);
    expect(sql.replace(/'(?:''|[^'])*'/g, "''").match(/;/g)).toHaveLength(1);
    expect(sql).not.toMatch(/\b(create|drop|alter|insert into|update storage|delete from|set local|begin|commit)\b/i);
    expect(sql).toContain('r.role_oid=0');
    expect(sql).toContain("polcmd in ('a','w','d','*')");
    expect(sql).toContain("has_table_privilege(cl.oid,'storage.buckets'");
    expect(sql).toContain("has_any_column_privilege(cl.oid,'storage.buckets'");
    expect(sql).not.toMatch(/predicate\s+(?:like|ilike).*bucket_id/i);
  });
  it('keeps both download SELECT policies and does not replace them with upload signing', () => {
    expect(readFileSync(resolve(root, 'supabase/model_studio.sql'), 'utf8')).toContain('create policy model_photos_select_own');
    expect(readFileSync(resolve(root, 'supabase/migrations/20260930_wardrobe_cutout_storage.sql'), 'utf8')).toContain('create policy wardrobe_cutouts_select_own');
    expect(proposal().split('-- ROLLBACK SQL')[0]).not.toMatch(/create policy/i);
  });
});

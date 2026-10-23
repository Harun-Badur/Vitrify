// Local SQL contract tests only: no database connection or PostgreSQL execution.
import { readFileSync } from 'fs';
import { resolve } from 'path';
const sql = readFileSync(resolve(__dirname, '../supabase/tests/client_admin_acl_guard.sql'), 'utf8');

// Read the actual guard's declarative applicability matrix, not a duplicate policy.
const matrices = [...sql.matchAll(/values\s+((?:\s*\('[A-Z]+', '[a-z]+'\),?)+)\s*\) as privileges\(privilege_name, applicable_kinds\)/g)]
  .map(match => new Map([...match[1].matchAll(/\('([A-Z]+)', '([a-z]+)'\)/g)]
    .map(row => [row[1], row[2]])));
const applies = (matrix: ReadonlyMap<string, string>, kind: string, privilege: string) =>
  matrix.get(privilege)?.includes(kind) ?? false;
const failureGate = sql.match(/if (object_violations[\s\S]*?) then\s+raise exception/)?.[1];
if (!failureGate) throw new Error('Missing SQL failure condition');
// Fail on unexpected SQL rather than silently approximating changed conditions.
const terms = failureGate.trim().split(/\s+or\s+/);
const rejects = (state: Readonly<Record<string, unknown>>) => terms.some(term => {
  const match = term.match(/^(\w+) is not null$/);
  if (!match) throw new Error('Unsupported SQL failure condition');
  return state[match[1]] != null;
});

describe('client admin ACL guard SQL contracts (not PostgreSQL behavior tests)', () => {
  test('all three scans use the declared kind/privilege matrix', () => {
    expect(matrices).toHaveLength(3);
    expect(sql.match(/position\(relations\.relkind::text in privileges\.applicable_kinds\) > 0/g)).toHaveLength(3);
    expect([...matrices[1]]).toEqual([...matrices[2]]);
  });
  test.each(['TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN'])('real table %s is a failure', privilege => {
    expect(applies(matrices[0], 'r', privilege)).toBe(true);
    expect(applies(matrices[0], 'p', privilege)).toBe(true);
    expect(rejects({ object_violations: privilege })).toBe(true);
  });
  test('ordinary view REFERENCES alone produces no administrative violation', () => {
    expect(applies(matrices[0], 'v', 'REFERENCES')).toBe(false);
    expect(applies(matrices[1], 'v', 'REFERENCES')).toBe(false);
    expect(rejects({})).toBe(false);
  });
  test.each(['TRIGGER', 'TRUNCATE', 'MAINTAIN'])('view %s still authorizes an operation and fails', privilege => {
    expect(applies(matrices[0], 'v', privilege)).toBe(true);
    expect(rejects({ object_violations: privilege })).toBe(true);
  });
  test('materialized view ignores trigger/reference bits but retains refresh and lock authority', () => {
    expect(applies(matrices[0], 'm', 'TRIGGER')).toBe(false);
    expect(applies(matrices[0], 'm', 'REFERENCES')).toBe(false);
    expect(applies(matrices[0], 'm', 'MAINTAIN')).toBe(true);
    expect(applies(matrices[0], 'm', 'TRUNCATE')).toBe(true);
  });
  test('foreign table operations remain covered', () => {
    for (const privilege of ['TRUNCATE', 'TRIGGER', 'MAINTAIN']) {
      expect(applies(matrices[0], 'f', privilege)).toBe(true);
    }
    expect(applies(matrices[0], 'f', 'REFERENCES')).toBe(false);
  });
  test('platform defaults alone are reported without hard failure', () => {
    expect(rejects({ platform_constraints: 'supabase_admin default grant' })).toBe(false);
    expect(sql).toContain("raise notice 'platform_default_constraint");
    expect(sql).toContain("'platform_default_constraint_blocking', false");
    expect(sql).toContain("'platform_default_constraint', coalesce((");
  });
  test('postgres defaults still fail, including global grants', () => {
    expect(rejects({ postgres_defaults: 'TRIGGER' })).toBe(true);
    expect(sql.match(/schemas\.nspname = 'public' or defaults\.defaclnamespace = 0/g)).toHaveLength(3);
  });
  test.each(['table SELECT', 'view TRIGGER', 'sequence USAGE', 'function EXECUTE'])('exposed platform %s fails closed', exposure => {
    expect(rejects({ admin_owned: exposure })).toBe(true);
    expect(sql).toContain("pg_get_userbyid(relations.relowner) = 'supabase_admin'");
    expect(sql).toContain("has_sequence_privilege(roles.role_name, sequences.oid, privileges.privilege_name)");
    expect(sql).toContain("has_function_privilege(roles.role_name, functions.oid, 'EXECUTE')");
  });
  test('exposed views require security_invoker and view failures reach the exception', () => {
    expect(sql).toContain("relations.reloptions @> array['security_invoker=true']");
    expect(rejects({ view_violations: 'security_invoker_required' })).toBe(true);
    expect(sql).toContain('VIEW_POLICY_VIOLATIONS:%');
  });
  test('v_funnel requires authenticated SELECT, rejects anon SELECT and client DML', () => {
    const viewPolicy = sql.split("select 'v_funnel_read_only_client_policy'")[1].split(') as checks')[0];
    for (const privilege of ['INSERT', 'UPDATE', 'DELETE']) {
      expect(viewPolicy).toContain(`has_table_privilege(roles.role_name, relations.oid, '${privilege}')`);
    }
    expect(viewPolicy).toContain("roles.role_name = 'anon' and has_table_privilege");
    expect(viewPolicy).toContain("roles.role_name = 'authenticated' and not has_table_privilege");
    expect(rejects({ view_violations: 'v_funnel_read_only_client_policy' })).toBe(true);
  });
  test('guard uses effective privilege checks and a read-only rollback transaction', () => {
    expect(sql).toContain('begin transaction isolation level repeatable read read only;');
    expect(sql.trim()).toMatch(/rollback;$/);
    expect(sql).not.toMatch(/^\s*(grant|revoke|alter|create|insert|update|delete)\b/im);
    expect(sql).toContain('has_table_privilege(roles.role_name, relations.oid, privileges.privilege_name)');
  });
});

import { readFileSync } from 'node:fs';
import { runScheduledStorageJanitor, JANITOR_BUCKETS, JANITOR_MAX_OBJECTS, type ScheduledJanitorPort } from '../supabase/functions/_shared/accountStorageJanitor';
import { storageJanitorHandler } from '../supabase/functions/_shared/accountStorageJanitorHandler';

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const now = Date.parse('2026-10-12T12:00:00Z');
function fixture() {
  const rows = [{ name: 'private-image.jpg', id: 'object', created_at: new Date(now - 7_200_000).toISOString() }];
  const metadata = jest.fn(async (owners: string[]) => owners.map(subject => ({ subject, authExists: false, staleFailed: false, activeLease: false })));
  const list = jest.fn(async (_bucket: string, prefix: string, offset: number) => offset ? [] : prefix === '' ? [{ name: owner, id: null }] : rows);
  const remove = jest.fn(async (_bucket: string, _paths: string[]) => {});
  const retention = jest.fn(async (_dry: boolean) => ({ found: 1, deleted: 0 }));
  const log = jest.fn();
  const port: ScheduledJanitorPort = { list, metadata, remove, retention, log, now: () => now };
  return { port, rows, metadata, list, remove, retention, log };
}
test('T4 orphan is removed only through allowlisted Storage API; idempotent rerun', async () => {
  const f = fixture(); const result = await runScheduledStorageJanitor(f.port, true);
  expect(result.deleted).toBe(2); expect(f.remove).toHaveBeenCalledTimes(2);
  expect(new Set(f.list.mock.calls.map(x => x[0]))).toEqual(new Set(JANITOR_BUCKETS));
  f.rows.splice(0); expect((await runScheduledStorageJanitor(f.port, true)).deleted).toBe(0);
});
test('default dry-run never removes Storage or retention rows', async () => {
  const f = fixture(); expect((await runScheduledStorageJanitor(f.port)).deleted).toBe(0);
  expect(f.remove).not.toHaveBeenCalled(); expect(f.retention).toHaveBeenCalledWith(true);
});
test('only boolean true enables deletion, not a truthy configuration string', async () => {
  const f = fixture(); await runScheduledStorageJanitor(f.port, 'true' as unknown as boolean);
  expect(f.remove).not.toHaveBeenCalled(); expect(f.retention).toHaveBeenCalledWith(true);
});
test('retention dry-run claiming deletions is an error, never reported as success', async () => {
  const f = fixture(); f.retention.mockResolvedValue({ found: 1, deleted: 1 });
  const result = await runScheduledStorageJanitor(f.port);
  expect(result.errors).toBe(1); expect(result.retentionDeleted).toBe(0);
});
test('existence RPC error is conservative and contains no identity in logs', async () => {
  const f = fixture(); f.metadata.mockRejectedValue(new Error(owner + '/private-image.jpg secret'));
  expect((await runScheduledStorageJanitor(f.port, true)).errors).toBeGreaterThan(0);
  expect(f.remove).not.toHaveBeenCalled();
  expect(JSON.stringify(f.log.mock.calls)).not.toMatch(/aaaaaaaa|private-image|secret/);
});
test('missing/duplicate metadata is not proof of Auth absence', async () => {
  for (const response of [[], [{ subject: owner, authExists: false, staleFailed: false, activeLease: false }, { subject: owner, authExists: false, staleFailed: false, activeLease: false }]]) {
    const f = fixture(); f.metadata.mockResolvedValue(response); await runScheduledStorageJanitor(f.port, true);
    expect(f.remove).not.toHaveBeenCalled();
  }
});
test('UUID olmayan kök klasör ve kökteki nesne atlanır', async () => {
  const f = fixture(); f.list.mockImplementation(async () => [{ name: 'not-a-uuid', id: null }, { name: owner, id: 'root-object' }] as any);
  await runScheduledStorageJanitor(f.port, true); expect(f.remove).not.toHaveBeenCalled(); expect(f.metadata).not.toHaveBeenCalled();
});
test('young, future or missing object timestamps are skipped', async () => {
  for (const date of [new Date(now - 3_599_999).toISOString(), new Date(now + 1).toISOString(), 'invalid']) {
    const f = fixture(); f.rows[0].created_at = date; await runScheduledStorageJanitor(f.port, true); expect(f.remove).not.toHaveBeenCalled();
  }
});
test('a recent update prevents removing a replaced object', async () => {
  const f = fixture(); Object.assign(f.rows[0], { updated_at: new Date(now).toISOString() });
  await runScheduledStorageJanitor(f.port, true); expect(f.remove).not.toHaveBeenCalled();
});
test('existing active owner is not touched', async () => {
  const f = fixture(); f.metadata.mockImplementation(async ids => ids.map(subject => ({ subject, authExists: true, staleFailed: false, activeLease: false })));
  await runScheduledStorageJanitor(f.port, true); expect(f.remove).not.toHaveBeenCalled();
});
test('Auth absent but post-Auth deletion lease is active: no removal', async () => {
  const f = fixture(); f.metadata.mockImplementation(async ids => ids.map(subject => ({ subject, authExists: false, staleFailed: false, activeLease: true })));
  await runScheduledStorageJanitor(f.port, true); expect(f.remove).not.toHaveBeenCalled();
});
test('old failed owner is eligible but fresh metadata is checked before every remove', async () => {
  const f = fixture(); f.metadata.mockImplementation(async ids => ids.map(subject => ({ subject, authExists: true, staleFailed: true, activeLease: false })));
  expect((await runScheduledStorageJanitor(f.port, true)).deleted).toBe(2);
  expect(f.metadata.mock.calls.length).toBeGreaterThan(1);
});
test('lease becomes active after inventory: deletion is skipped', async () => {
  const f = fixture(); f.metadata.mockResolvedValueOnce([{ subject: owner, authExists: true, staleFailed: true, activeLease: false }]);
  f.metadata.mockResolvedValue([{ subject: owner, authExists: true, staleFailed: false, activeLease: false }]);
  await runScheduledStorageJanitor(f.port, true); expect(f.remove).not.toHaveBeenCalled();
});
test('remove failure is counted; logs are fixed events and counts', async () => {
  const f = fixture(); f.remove.mockRejectedValue(new Error(owner + '/private-image.jpg'));
  const result = await runScheduledStorageJanitor(f.port, true);
  expect(result.deleted).toBe(0); expect(result.errors).toBe(2);
  expect(JSON.stringify(f.log.mock.calls)).not.toMatch(/aaaaaaaa|private-image/);
});
test('pagination collects inventory before deletion; object limit bounds work', async () => {
  const f = fixture(); let removed = false;
  f.list.mockImplementation(async (_bucket, prefix, offset) => {
    expect(removed).toBe(false);
    return prefix === '' ? (offset ? [] : [{ name: owner, id: null }] as any) :
      Array.from({ length: 100 }, (_, i) => ({ name: `file-${offset+i}`, id: 'object', created_at: new Date(now-7_200_000).toISOString() }));
  });
  f.remove.mockImplementation(async () => { removed = true; });
  const result = await runScheduledStorageJanitor(f.port, true);
  expect(result.found).toBeLessThanOrEqual(JANITOR_MAX_OBJECTS); expect(result.deleted).toBeLessThanOrEqual(JANITOR_MAX_OBJECTS);
});
test('handler rejects missing/wrong credentials and different project before adapters', async () => {
  const f = fixture(); const run = jest.fn(() => runScheduledStorageJanitor(f.port));
  const handler = storageJanitorHandler({ token: 'test-only-token', projectUrl: 'https://sdjxseqfkturkfohkfni.supabase.co', run });
  for (const token of ['', 'wrong']) expect((await handler(new Request('https://local.invalid', { method: 'POST', headers: { authorization: `Bearer ${token}` } }))).status).toBe(401);
  expect(run).not.toHaveBeenCalled();
  const unsafe = storageJanitorHandler({ token: 'test-only-token', projectUrl: 'https://other.supabase.co', run });
  expect((await unsafe(new Request('https://local.invalid', { method: 'POST' }))).status).toBe(503);
});
test('authorized handler returns counts only and server controls dry-run', async () => {
  const f = fixture(); const run = jest.fn((enabled: boolean) => runScheduledStorageJanitor(f.port, enabled));
  const handler = storageJanitorHandler({ token: 'test-only-token', projectUrl: 'https://sdjxseqfkturkfohkfni.supabase.co', run });
  const res = await handler(new Request('https://local.invalid', { method: 'POST', headers: { authorization: 'Bearer test-only-token' }, body: '{"deleteEnabled":true}' }));
  expect(res.status).toBe(200); expect(run).toHaveBeenCalledWith(false); expect(f.remove).not.toHaveBeenCalled();
  expect(JSON.stringify(await res.json())).not.toMatch(/aaaaaaaa|private-image/);
});

test('Kabin janitor requires explicit matching server target and remains dry-run', async () => {
  const f = fixture(); const run = jest.fn((enabled: boolean) => runScheduledStorageJanitor(f.port, enabled));
  const projectUrl = 'https://hnujkabyyrlsxohjhxlg.supabase.co';
  const request = () => new Request('https://local.invalid', { method: 'POST', headers: { authorization: 'Bearer test-only-token' }, body: '{"deleteEnabled":true}' });
  expect((await storageJanitorHandler({ projectUrl, token: 'test-only-token', run })(request())).status).toBe(503);
  const handler = storageJanitorHandler({ projectUrl, targetProjectRef: 'hnujkabyyrlsxohjhxlg', token: 'test-only-token', run });
  expect((await handler(request())).status).toBe(200);
  expect(run).toHaveBeenCalledTimes(1); expect(run).toHaveBeenCalledWith(false); expect(f.remove).not.toHaveBeenCalled();
});

test.each(['sdjxseqfkturkfohkfni', 'unknown-project'])('Kabin URL rejects mismatched or unapproved target %s', async targetProjectRef => {
  const run = jest.fn();
  const handler = storageJanitorHandler({ projectUrl: 'https://hnujkabyyrlsxohjhxlg.supabase.co', targetProjectRef, token: 'test-only-token', run });
  expect((await handler(new Request('https://local.invalid', { method: 'POST', headers: { authorization: 'Bearer test-only-token' } }))).status).toBe(503);
  expect(run).not.toHaveBeenCalled();
});
test('SQL retention has completed-only, 90-day, Auth-absent and inactive-lease guards; no Storage SQL delete', () => {
  const sql = readFileSync('reports/backend/proposals/20261012_a1_janitor_retention.sql', 'utf8').split('-- ROLLBACK')[0];
  expect(sql).toContain("interval '90 days'"); expect(sql).toContain("interval '24 hours'");
  expect(sql).toContain("'RETRY_REQUIRED'"); expect(sql).toContain('>=2');
  expect(sql).toContain('auth.users'); expect(sql).toContain('lease_until'); expect(sql).toContain('SKIP LOCKED');
  expect(sql).toContain('p_dry_run'); expect(sql).toContain("'VERIFIED'");
  // Filter completed pairs before LIMIT so old failed receipts cannot starve retention.
  const selection = sql.slice(sql.indexOf('select g.subject'), sql.indexOf('limit 200'));
  expect(selection).toContain("'VERIFIED'");
  expect(sql).not.toMatch(/delete\s+from\s+storage\./i);
  expect(sql).toContain('from public,anon,authenticated,service_role');
});
test('schedule reads Vault names, is disabled on installation and contains no literal credential', () => {
  const sql = readFileSync('reports/backend/proposals/20261012_a1_janitor_schedule.sql', 'utf8');
  expect(sql).toContain('a1_janitor_authorization'); expect(sql).toContain('a1_janitor_endpoint');
  expect(sql).toContain('active=false'); expect(sql).toContain("'0 2 * * *'");
  expect(sql).not.toMatch(/eyJ[A-Za-z0-9_-]{10}|sb_secret_/);
});

test('Kabin schedule proposal is disabled, target-bound and does not create secrets', () => {
  const sql = readFileSync('reports/backend/proposals/20261013_a1_kabin_janitor_schedule.sql', 'utf8');
  expect(sql).toContain('https://hnujkabyyrlsxohjhxlg.supabase.co/functions/v1/account-storage-janitor');
  expect(sql).not.toContain('sdjxseqfkturkfohkfni');
  expect(sql).toContain('active=false'); expect(sql).toContain('-- ROLLBACK');
  expect(sql).toContain('a1_janitor_authorization'); expect(sql).toContain('a1_janitor_endpoint');
  expect(sql).not.toMatch(/create_secret|eyJ[A-Za-z0-9_-]{10}|sb_secret_/);
});

test('janitor gateway delegates authorization to the fail-closed server token handler', () => {
  const toml = readFileSync('supabase/config.toml', 'utf8');
  expect(toml).toMatch(/\[functions[.]account-storage-janitor\]\s*(?:#[^\n]*\n\s*)*verify_jwt\s*=\s*false/);
});

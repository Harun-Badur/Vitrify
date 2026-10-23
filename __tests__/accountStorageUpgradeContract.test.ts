import { readFileSync } from 'node:fs';

// Source contracts only. No PostgreSQL parser, transaction, RLS or provider execution.
const read = (path: string) => readFileSync(path, 'utf8').replace(/\r/g, '');
const old = read('reports/backend/proposals/20261010_account_deletion_coordinator.sql');
const upgrade = read('reports/backend/proposals/20261011_account_storage_upload_upgrade.sql');
const handler = read('supabase/functions/_shared/accountStorageUploadHandler.ts');
const entry = read('supabase/functions/account-storage-upload/index.ts');
const executable = upgrade.replace(/--[^\n]*/g, '');
const body = (name: string) => {
  const match = upgrade.match(new RegExp(`create function public\\.${name}\\(([^)]*)\\) returns (\\w+)[\\s\\S]*?as \\$\\$([\\s\\S]*?)end \\$\\$;`));
  if (!match) throw new Error(`Missing SQL function: ${name}`);
  return { params: match[1], result: match[2], sql: match[3] };
};

test('entry binds the real handler; new RPC argument names and return contracts match it', () => {
  expect(entry).toContain("../_shared/accountStorageUploadHandler.ts");
  expect(body('storage_upload_admit').params).toBe('p_bucket text,p_path text,p_request text');
  expect(body('storage_upload_admit').result).toBe('jsonb');
  expect(body('storage_upload_start').params).toBe('p_operation uuid,p_lease uuid,p_subject uuid,p_bucket text,p_path text');
  expect(body('storage_upload_start').result).toBe('boolean');
  expect(body('storage_upload_succeed').params).toBe('p_operation uuid,p_lease uuid,p_subject uuid,p_bucket text,p_path text,p_proof jsonb');
  expect(body('storage_upload_succeed').result).toBe('boolean');
  expect(handler).toContain("user.rpc('storage_upload_admit', { p_bucket: bucket, p_path: path, p_request: requestId })");
  expect(handler).toContain('p_operation: op.operation, p_lease: op.lease, p_subject: op.owner, p_bucket: op.bucket, p_path: op.path');
  expect(handler).toContain("admin.rpc('storage_upload_succeed', { ...args(op), p_proof: JSON.parse(proof) })");
});

test('known legacy columns are explicitly checked against the coordinator layout', () => {
  const table = old.split('create table deletion_private.storage_operations (')[1].split('\n);')[0];
  const columns = ['operation', 'subject', 'bucket', 'path', 'lease', 'state', 'expires_at', 'created_at', 'terminal_proof'];
  for (const column of columns) {
    expect(table).toMatch(new RegExp(`\\b${column} (uuid|text|timestamptz)\\b`));
    expect(upgrade).toContain(`('${column}',`);
  }
  expect(upgrade).toContain(`and attnum>0 and not attisdropped)<>${columns.length}`);
  expect(upgrade).toContain("('terminal_proof','text')");
  expect(upgrade).toContain('Unsupported admission table layout');
  expect(upgrade).toContain('format_type(a.atttypid,a.atttypmod)<>expected.typ');
});

test('optional legacy table is migrated under an exclusive lock in one transaction', () => {
  expect(executable.trim().startsWith('begin;')).toBe(true);
  expect(executable.trim().endsWith('commit;')).toBe(true);
  expect(upgrade).toContain("if to_regclass('deletion_private.storage_operations') is not null then");
  expect(upgrade.indexOf('lock table deletion_private.storage_operations in access exclusive mode'))
    .toBeLessThan(upgrade.indexOf('rename to storage_operations_legacy'));
  expect(upgrade.indexOf('rename to storage_operations_legacy')).toBeLessThan(upgrade.indexOf('create table deletion_private.storage_operations'));
  expect(upgrade.indexOf('from deletion_private.storage_operations_legacy;')).toBeLessThan(upgrade.indexOf('drop table deletion_private.storage_operations_legacy;'));
  expect(executable).not.toMatch(/\bcascade\b/i);
  expect(upgrade).toContain('storage_upload_operations_pk'); // Avoid legacy PK index name collision.
});

test('all old rows retain identity/time/evidence and become un-dispatchable UNKNOWN', () => {
  expect(upgrade).toContain("select operation,subject,'legacy-'||operation::text,bucket,path,lease,'UNKNOWN',false,expires_at,created_at,true,");
  expect(upgrade).toContain("jsonb_build_object('state',state,'terminal_proof',terminal_proof)");
  expect(upgrade).toContain('legacy_record boolean not null default false, legacy_evidence jsonb');
  expect(body('storage_upload_start').sql).toContain("op.state<>'ADMITTED'");
  expect(body('storage_upload_succeed').sql).toContain('not op.dispatch_started');
});

test('legacy duplicate paths survive and still block new admission under the owner lock', () => {
  expect(upgrade).toContain("where state in ('ADMITTED','UNKNOWN') and not legacy_record;");
  const sql = body('storage_upload_admit').sql;
  const check = "where subject=who and bucket=p_bucket and path=p_path and state in ('ADMITTED','UNKNOWN')";
  expect(sql).toContain(check);
  expect(sql.indexOf('lock_writer(who)')).toBeLessThan(sql.indexOf(check));
  expect(sql.indexOf(check)).toBeLessThan(sql.indexOf('insert into deletion_private.storage_operations'));
  expect(sql).not.toContain('and not legacy_record');
  expect(upgrade).toContain('unique(subject,request)');
});

test('obsolete RPCs are removed, not kept as accessible overloads or state mutators', () => {
  for (const signature of ['storage_upload_admit(text,text)', 'storage_upload_start(uuid,uuid)', 'storage_upload_unknown(uuid,uuid)']) {
    expect(old.replace(/\s/g, '')).toContain(`functionpublic.${signature.replace(/\s/g, '')}`.replace(/\(.*$/, '('));
    expect(upgrade).toContain(`drop function if exists public.${signature};`);
  }
  expect(executable).not.toMatch(/grant execute[^;]*storage_upload_unknown/);
});

test('ownership is Auth-derived and the same gate protects admission, dispatch and deletion', () => {
  expect(upgrade).toContain('who uuid:=auth.uid()');
  expect(body('storage_upload_admit').sql).toContain('from auth.users where id=who');
  expect(body('storage_upload_admit').sql).toContain('lock_writer(who)');
  expect(body('storage_upload_start').sql).toContain('lock_writer(p_subject)');
  expect(old).toContain('select fenced into stopped from deletion_private.owner_gates where subject=p_subject for update');
  expect(old).toContain('update deletion_private.owner_gates set fenced=true where subject=p_subject');
  expect(body('storage_upload_succeed').sql).toContain('from deletion_private.owner_gates where subject=p_subject for update');
  expect(body('storage_upload_succeed').sql).not.toMatch(/set fenced\s*=\s*false/);
});

test('dispatch consumes the full identity once and expiry never terminalizes a row', () => {
  const sql = body('storage_upload_start').sql;
  expect(sql).toContain('operation=p_operation and lease=p_lease');
  expect(sql).toContain('subject=p_subject and bucket=p_bucket and path=p_path for update');
  expect(sql).toContain('eligible:=op.expires_at>clock_timestamp()');
  expect(sql).toContain("set state='UNKNOWN',dispatch_started=eligible");
  expect(sql.indexOf("set state='UNKNOWN'")).toBeLessThan(sql.indexOf('return eligible'));
  expect(sql).not.toContain("state='SUCCEEDED'");
});

test('success requires matched UNKNOWN dispatch and structured server Storage proof', () => {
  const sql = body('storage_upload_succeed').sql;
  expect(sql).toContain("op.state<>'UNKNOWN' or not op.dispatch_started");
  for (const fragment of ["jsonb_typeof(p_proof)<>'object'", "'STORAGE_SUCCESS'", "is distinct from op.bucket", "is distinct from op.path", "p_proof->>'objectId'"]) {
    expect(sql).toContain(fragment);
  }
  expect(sql.indexOf('Upload success evidence unavailable')).toBeLessThan(sql.indexOf("set state='SUCCEEDED',terminal_proof=p_proof"));
  expect(sql.indexOf("set state='SUCCEEDED'")).toBeLessThan(sql.indexOf('return true'));
  expect(handler).toContain("if (result.error || result.data !== true) throw new Error('TERMINAL_CHECKPOINT_UNAVAILABLE')");
});

test('private records remain RLS-protected and clients cannot execute terminal RPCs', () => {
  expect(upgrade).toContain('alter table deletion_private.storage_operations enable row level security');
  expect(upgrade).toContain('revoke all on deletion_private.storage_operations from public,anon,authenticated,service_role');
  expect(upgrade).toContain('from public,anon,authenticated,service_role;\ngrant execute on function');
  expect(upgrade).toContain('grant execute on function public.storage_upload_admit(text,text,text) to authenticated;');
  expect(upgrade).toContain('grant execute on function public.storage_upload_start(uuid,uuid,uuid,text,text),\n public.storage_upload_succeed(uuid,uuid,uuid,text,text,jsonb) to service_role;');
  expect(executable).not.toMatch(/grant[^;]*on (?:table )?deletion_private\.storage_operations/i);
});

test('upgrade neither attests readiness nor replaces the false physical barrier', () => {
  expect(executable).not.toMatch(/(?:create|replace|alter) function (?:public\.deletion_storage_barrier|deletion_private\.storage_transport_ready)/i);
  expect(executable).not.toMatch(/update deletion_private\.(?:readiness|owner_gates)/i);
  expect(executable).not.toMatch(/\b(?:delete from|truncate)\b/i);
  expect(old).toContain('as $$ select false $$;');
});

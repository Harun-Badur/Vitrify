const { inventory, sourceInventory, parseTables, audit, exceptions } = require('../scripts/backend/a1-user-table-audit.cjs');
it('T8: all canonical user tables cascade to Auth or match exactly the reasoned exceptions',()=>{
  const rows=inventory();expect(rows.length).toBeGreaterThan(15);expect(rows.filter((r:any)=>r.disposition.startsWith('FAIL'))).toEqual([]);
  expect(Object.keys(exceptions).sort()).toEqual(['deletion_private.owner_gates','deletion_private.receipts','deletion_private.storage_operations','deletion_private.provider_operations','deletion_private.storage_resolutions'].sort());
  expect(rows.find((r:any)=>r.table==='public.discover_recommendation_job_payloads').disposition).toContain('CASCADE');
});
it('T8 also scans root SQL, migration and proposal definitions including deferred tables',()=>{
  expect(sourceInventory().filter((r:any)=>r.disposition.startsWith('FAIL'))).toEqual([]);
});
it.each(['user_id','owner_id','subject'])('T8 rejects a new unprotected %s table outside the allowlist',column=>{
  expect(audit(parseTables(`create table public.unexpected(${column} uuid not null, payload text);`))[0].disposition).toContain('FAIL');
});
it('T8 does not accept a non-cascading FK',()=>{
  expect(audit(parseTables('create table public.unexpected(user_id uuid references auth.users(id) on delete restrict);'))[0].disposition).toContain('FAIL');
});
it('T8 detects an owner column introduced later through ALTER TABLE',()=>{
  expect(audit(parseTables('create table public.unexpected(id uuid); alter table public.unexpected add column user_id uuid;'))[0].disposition).toContain('FAIL');
});

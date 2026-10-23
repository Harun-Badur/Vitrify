'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const dir = path.join(root, 'reports/backend/isolated-a1-migration20/supabase/migrations');
const exceptions = Object.freeze({
  'deletion_private.owner_gates': 'permanent fence tombstone',
  'deletion_private.receipts': 'recovery receipt tombstone',
  'deletion_private.storage_operations': 'explicit pre-Auth purge',
  'deletion_private.provider_operations': 'explicit pre-Auth purge',
  'deletion_private.storage_resolutions': 'explicit pre-Auth purge before storage_operations',
});
function parseTables(source) {
  const sql = source.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const tables = [];
  const pattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w]+\.[\w]+)\s*\(/gi;
  for (let match; (match = pattern.exec(sql));) {
    let depth = 1, cursor = pattern.lastIndex, quoted = false;
    for (; cursor < sql.length && depth; cursor++) {
      const c = sql[cursor];
      if (c === "'") { if (quoted && sql[cursor + 1] === "'") { cursor++; continue; } quoted = !quoted; }
      if (!quoted) { if (c === '(') depth++; if (c === ')') depth--; }
    }
    if (depth) throw new Error('UNPARSED_TABLE');
    const body = sql.slice(pattern.lastIndex, cursor - 1);
    const owner = /\b(user_id|owner_id|subject)\s+uuid\b/i.exec(body)?.[1] ??
      (['public.users','public.profiles'].includes(match[1]) ? 'id' : null);
    const references = [...body.matchAll(/references\s+(\w+\.\w+)\s*\([^)]*\)\s+on\s+delete\s+cascade/gi)].map(m => m[1]);
    tables.push({ table: match[1], owner, references });
    pattern.lastIndex = cursor;
  }
  for (const match of sql.matchAll(/alter\s+table\s+(\w+\.\w+)([^;]*);/gi)) {
    const owner=/add\s+column\s+(?:if\s+not\s+exists\s+)?(user_id|owner_id|subject)\s+uuid\b/i.exec(match[2])?.[1];
    if (!owner) continue;
    let table=tables.find(t=>t.table===match[1]);
    if(!table){table={table:match[1],owner:null,references:[]};tables.push(table);}
    table.owner=owner;
    table.references.push(...[...match[2].matchAll(/references\s+(\w+\.\w+)\s*\([^)]*\)\s+on\s+delete\s+cascade/gi)].map(m=>m[1]));
  }
  return tables;
}
function audit(tables) {
  const byName = new Map(tables.map(t => [t.table,t]));
  function reachesUser(table, seen = new Set()) {
    if (table === 'auth.users') return true;
    if (seen.has(table)) return false;
    return (byName.get(table)?.references ?? []).some(parent => reachesUser(parent,new Set([...seen,table])));
  }
  return tables.filter(t => t.owner).map(t => ({ ...t,
    disposition: exceptions[t.table] ?? (reachesUser(t.table) ? 'FK CASCADE path to auth.users' : 'FAIL: missing user cascade/exception'),
  }));
}
function inventory() {
  // Canonical installed-schema sources 1-20; proposal SQL is checked separately.
  const tables = new Map();
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort())
    for (const table of parseTables(fs.readFileSync(path.join(dir,file),'utf8'))) tables.set(table.table,table);
  return audit([...tables.values()]);
}
function sourceInventory() {
  const tables = new Map();
  function walk(directory) {
    for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      const file=path.join(directory,entry.name);
      if(entry.isDirectory())walk(file);
      else if(entry.name.endsWith('.sql'))for(const table of parseTables(fs.readFileSync(file,'utf8').split('-- ROLLBACK')[0]))tables.set(table.table,table);
    }
  }
  // Include root schema/migrations/deferred and proposal variants, then canonical
  // 1-20 overrides known versions. Unexpected new tables remain visible/fail.
  walk(path.join(root,'supabase'));walk(path.join(root,'reports/backend/proposals'));
  for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())
    for(const table of parseTables(fs.readFileSync(path.join(dir,file),'utf8')))tables.set(table.table,table);
  return audit([...tables.values()]);
}
if (require.main === module) {
  const rows = inventory();
  for (const row of rows) process.stdout.write(`${row.table} ${row.owner} ${row.disposition}\n`);
  if (rows.some(r => r.disposition.startsWith('FAIL'))) process.exitCode = 1;
}
module.exports = { parseTables, audit, inventory, sourceInventory, exceptions };

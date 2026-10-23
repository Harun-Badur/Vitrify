// Offline contract test for the operator's read-only release inventory.
const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const sql = readFileSync('reports/backend/proposals/20261012_a1_staging_release_check.sql', 'utf8');
assert.match(sql, /^--[\s\S]*\nwith expected/);
assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), /\b(?:insert|update|delete|alter|create|drop|grant|revoke|truncate|call|do)\s+(?:table|function|into|from|on|public\.|deletion_private\.)/i);
assert.doesNotMatch(sql, /decrypted_secrets|cron\.job|auth\.users\s+(?:where|limit)|net\.http_post/i);
const sources = [
  '20261011_a1_phase2_deletion_gates.sql',
  '20261012_a1_phase3b_upload_fence.sql',
  '20261012_a1_phase4_fence_timestamp.sql',
  '20261012_a1_phase4b_purge_operations.sql',
];
const latest = new Map();
for (const file of sources) {
  const forward = readFileSync('reports/backend/proposals/' + file, 'utf8').split('-- ROLLBACK')[0];
  for (const m of forward.matchAll(/create (?:or replace )?function ([\w.]+)\(([^)]*)\)([\s\S]*?)\bas\s+\$\$([\s\S]*?)\$\$/gi)) {
    latest.set(m[1], createHash('md5').update(m[4].replace(/\r/g, '')).digest('hex'));
  }
}
assert.equal(latest.size, 6);
for (const [name, hash] of latest) {
  assert(sql.includes(name), name);
  assert(sql.includes(hash), name + ': final source fingerprint absent');
}
for (const required of ['storage_resolutions', 'provider_operations', 'fenced_at', 'model-photos', 'wardrobe-cutouts', 'MISSING', 'DIFF', 'NOT_VERIFIED']) assert(sql.includes(required), required);
console.log('PASS: read-only query contract; six final proposal fingerprints; no network/DB execution');

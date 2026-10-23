import { readFileSync } from 'node:fs';
const proposal='reports/backend/proposals/20261013_style_preference_v2_production.sql';
test('production writer explicitly revokes inherited service-role execute and leaves only authenticated caller',()=>{
  const sql=readFileSync(proposal,'utf8');
  expect(sql).toContain('from public,anon,service_role;');
  expect(sql).toContain('to authenticated;');
  expect(sql).toContain('MAIN_V1_FINGERPRINT_MISMATCH');
  expect(sql).toContain('PUBLIC_SCHEMA_CLIENT_CREATE_STOP');
  expect(sql).not.toMatch(/insert\s+into\s+public\.recs_config/i);
});
test('production adaptation preserves existing V2 math, exact cancellation and V1 wrapper function bodies',()=>{
  const bodies=(text:string)=>[...text.matchAll(/as \$\$([\s\S]*?)\$\$/g)].map(x=>x[1]);
  expect(bodies(readFileSync(proposal,'utf8'))).toEqual(bodies(readFileSync('reports/backend/proposals/20261012_style_preference_v2.sql','utf8')));
});

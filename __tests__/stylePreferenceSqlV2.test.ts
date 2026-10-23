import { canonicalPreferenceHistory, type CommittedStyleAction, type HistoricalStyleEvent } from '../src/intelligence/evidence/canonicalPreferenceHistory';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const action=(patch:Partial<CommittedStyleAction>={}):CommittedStyleAction=>({owner:'A',id:'a',productId:'p',kind:'favorite',at:'2026-10-12T10:00:00Z',eventIds:['like','add'],revokes:[],...patch});
const event=(patch:Partial<HistoricalStyleEvent>={}):HistoricalStyleEvent=>({owner:'A',id:'like',productId:'p',type:'like',at:'2026-10-12T10:00:00Z',payload:{action_id:'a',action_origin:'favorite',outcome:'committed'},...patch});
const weights={like:1,dolap_add:1.2,pass:-0.8,impression:0.05}; // fixture config, not live config
const history=(actions:CommittedStyleAction[],events:HistoricalStyleEvent[]=[],policy:'preserve_v1'|'exclude_with_approval'='preserve_v1')=>canonicalPreferenceHistory('A',actions,events,policy,1000,weights);
test('trusted favorite pair is one canonical like, even if transport only delivers one source event',()=>{
  expect(history([action()],[event(),event({id:'add',type:'dolap_add'})]).events.map(row=>row.type)).toEqual(['like']);
  expect(history([action()],[event()]).events).toHaveLength(1);
  expect(history([action()],[]).events).toHaveLength(1); // committed ledger, NOT a claim from an incomplete client pair
});
test('distinct actions remain distinct; duplicate event delivery adds no preference',()=>{
  const result=history([action(),action({id:'b',eventIds:['b-like','b-add']})],[event(),event()]);
  expect(result.events).toHaveLength(2);
});
test('new event IDs copying a registered action never create extra legacy contributions',()=>{
  expect(history([action()],[event({id:'copy1'}),event({id:'copy2',type:'dolap_add'})]).events).toHaveLength(1);
});
test('wardrobe ledger actions remain ownership-only',()=>{
  const result=history([action({kind:'wardrobe',eventIds:['add']})]);
  expect(result.events).toEqual([]);expect(result.ownedActionIds).toEqual(['a']);
});
test('unlike resolves all explicit targets before limiting events and survives reversed delivery',()=>{
  const rows=[action(),action({id:'cancel',kind:'unlike',eventIds:['cancel-event'],revokes:['a']})];
  expect(history(rows).events).toEqual([]);
  expect(history([...rows].reverse())).toEqual(history(rows));
});
test('new like after unlike survives; stale unlike cannot target it implicitly',()=>{
  expect(history([action(),action({id:'cancel',kind:'unlike',eventIds:['cancel-event'],revokes:['a']}),action({id:'new',eventIds:['new-like','new-add']})]).events.map(row=>row.actionId)).toEqual(['new']);
});
test('undo pass removes negative evidence while other passes remain',()=>{
  const rows=[action({kind:'pass',eventIds:['pass']}),action({id:'b',productId:'q',kind:'pass',eventIds:['b-pass']}),action({id:'undo',kind:'undo_pass',eventIds:['undo-event'],revokes:['a']})];
  expect(history(rows).events.map(row=>[row.actionId,row.type])).toEqual([['b','pass']]);
});
test('legacy choice is explicit: preserve unchanged or opt-in exclusion, never timestamp merge',()=>{
  const rows=[event({id:'old-like',payload:{}}),event({id:'old-add',type:'dolap_add',payload:{}})];
  expect(history([],rows).events.map(row=>row.type)).toEqual(['like','dolap_add']);
  expect(history([],rows,'exclude_with_approval').events).toEqual([]);
  expect(history([],rows).unverifiedEventCount).toBe(2);
});
test('forged client committed/action metadata is never promoted to verified action',()=>{
  const result=history([],[event()],'exclude_with_approval');
  expect(result.events).toEqual([]);expect(result.unverifiedEventCount).toBe(1);
});
test('preserving unverified legacy explicitly preserves its security risk',()=>{
  expect(history([],[event()]).events[0].authority).toBe('legacy_unverified');
});
test('owner B ledger/cancellations/events cannot affect owner A',()=>{
  expect(history([action(),action({owner:'B',id:'cancel',kind:'unlike',revokes:['a']})],[event({owner:'B'})]).events).toHaveLength(1);
});
test('broken ledger references, wrong product and duplicated action identity fail closed',()=>{
  expect(()=>history([action(),action({id:'cancel',kind:'unlike',revokes:['missing']})])).toThrow('INVALID_LEDGER');
  expect(()=>history([action(),action({id:'cancel',kind:'unlike',productId:'other',revokes:['a']})])).toThrow('INVALID_LEDGER');
  expect(()=>history([action(),action({eventIds:['other']})])).toThrow('INVALID_LEDGER');
});
test('1000 limit applies to canonical contributions, never raw paired events or cancellation history',()=>{
  const rows=Array.from({length:1001},(_,i)=>action({id:`a${i}`,eventIds:[`like${i}`,`add${i}`]}));
  expect(history(rows).events).toHaveLength(1000);
  const cancel=action({id:'cancel',kind:'unlike',eventIds:['cancel-event'],revokes:rows.map(row=>row.id)});
  expect(history([...rows,cancel]).events).toEqual([]);
});
test('non-contributing impressions do not consume the canonical 1000 window',()=>{
  const impressions=Array.from({length:1001},(_,i)=>event({id:`impression${i}`,type:'impression',at:'2026-10-12T11:00:00Z',payload:{}}));
  expect(history([action()],impressions).events.map(row=>row.type)).toEqual(['like']);
});
test('input is immutable and duplicate source event IDs with different content are rejected',()=>{
  const rows=[action()];const before=JSON.stringify(rows);history(rows);expect(JSON.stringify(rows)).toBe(before);
  expect(()=>history([],[event(),event({productId:'other'})])).toThrow('INVALID_EVENTS');
});
test('draft has server-only ledger writes, JWT checks, expected-target CAS and event identity preservation',()=>{
  const sql=readFileSync(resolve(__dirname,'../reports/backend/proposals/20261012_style_preference_v2.sql'),'utf8');
  expect(sql).toContain('revoke all on public.style_preference_actions from public, anon, authenticated');
  expect(sql).toContain('auth.uid()');expect(sql).toContain('STALE_TARGETS');
  expect(sql).toContain('REQUEST_ID_REUSED');expect(sql).toContain('pg_advisory_xact_lock');
  expect(sql).toContain('on conflict (event_id) do nothing');
  expect(sql).not.toMatch(/delete from public\.user_events|update public\.user_events|update public\.recs_config/i);
});
test('profile draft keeps existing map/negative/tag math and consumer fields, but reads canonical history before limit',()=>{
  const sql=readFileSync(resolve(__dirname,'../reports/backend/proposals/20261012_style_preference_v2.sql'),'utf8');
  expect(sql).toContain('public.style_profile_events_v2(p_user_id, p_legacy_policy)');
  expect(sql).toContain('limit 1000');expect(sql).toContain('v_event.event_type = \'pass\'');
  for(const field of ['color_w','subcategory_w','brand_w','fit_w','price_band_w','negative_preferences','style_tag_weights','event_count','last_event_at','computed_at','updated_at']) expect(sql).toContain(field);
  expect(sql).toContain('v_color_delta := v_delta / v_attr_n');
  expect(sql).not.toContain('create or replace function public.ingest_events(');
});
test('rollback does not drop ledger/user events or rewrite profile data; v1 definition is retained',()=>{
  const sql=readFileSync(resolve(__dirname,'../reports/backend/proposals/20261012_style_preference_v2_rollback.sql'),'utf8');
  expect(sql).toContain('create or replace function public.recompute_profile(');
  expect(sql).not.toMatch(/drop table|delete from|update public\.user_style_profiles/i);
});
test('profile v2 is the exact current SQL math with only canonical history source substituted',()=>{
  const original=readFileSync(resolve(__dirname,'../supabase/recs_v1.sql'),'utf8');
  const source=original.match(/create or replace function public\.recompute_profile\(p_user_id uuid\)[\s\S]*?\nend;\r?\n\$\$;/)?.[0];
  expect(source).toBeDefined();
  const expected=source!.replace('public.recompute_profile(p_user_id uuid)','public.recompute_profile_v2(p_user_id uuid, p_legacy_policy text)')
    .replace('from public.user_events as e','from public.style_profile_events_v2(p_user_id, p_legacy_policy) as e')
    .replace('where e.user_id = p_user_id','where true');
  const draft=readFileSync(resolve(__dirname,'../reports/backend/proposals/20261012_style_preference_v2.sql'),'utf8');
  expect(draft).toContain(expected);
});

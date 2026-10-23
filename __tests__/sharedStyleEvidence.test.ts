import { buildProductEvidence, buildUserEvidence, compareBackendProfile } from '../src/intelligence/evidence/sharedEvidence';
import type { CommonUserEvidenceInput } from '../types/sharedStyleEvidence';
import type { Product } from '../types/product';
import { emptyStyleProfile } from '../lib/scoring';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
const product = (id: string, title = 'Fixture'): Product => ({ id, title, brand: 'Fixture', price: 100,
  imageUrl: 'https://example.invalid/image.jpg', garmentDescription: title, category: 'upper_body' });
const evidence = (id: string, title = 'Fixture') => buildProductEvidence({ product: product(id,title) });
const input = (patch: Partial<CommonUserEvidenceInput> = {}): CommonUserEvidenceInput => ({
  userId: 'A', sourceOwnerId: 'A', likes: [], passes: [], owned: [], outfits: [], profile: null, ...patch,
});
test('zero data has no inferred style identity or probability', () => {
  const result = buildUserEvidence(input());
  expect(result.counts).toEqual({ liked: 0, passed: 0, owned: 0, used: 0, outfits: 0 });
  expect(result.dimensions.styleTags.status).toBe('unsupported');
  expect(result.dimensions.colors.reliability).toBe('none');
});
test('few likes and repeated rows remain insufficient; input is immutable', () => {
  const p = evidence('p'); const data = input({ likes: [p,p,p] });
  const before = JSON.stringify(data); const result = buildUserEvidence(data);
  expect(result.counts.liked).toBe(1); expect(result.dimensions.category.status).toBe('insufficient_data');
  expect(JSON.stringify(data)).toBe(before);
});
test('like/pass contradiction is explicit; ambiguous order cannot choose a winner', () => {
  const p = evidence('p'); const result = buildUserEvidence(input({ likes: [p], passes: [{ productId:'p', evidence:p }] }));
  expect(result.conflicts).toContainEqual({ code:'liked_and_passed', productId:'p' });
  expect(result.records[0]).toMatchObject({ liked:true, passed:true, order:'unknown' });
  expect(result.dimensions.category.values[0]).toMatchObject({ likeCount:0, passCount:0, ambiguousCount:1 });
});
test('ID-only passes do not acquire metadata even when the same product is currently owned', () => {
  const result = buildUserEvidence(input({ passes:[{productId:'p'}], owned:[{id:'p',category:'upper_body'}] }));
  expect(result.missing).toContain('pass_metadata_not_recorded');
  expect(result.dimensions.category.values[0]).toMatchObject({ ownedCount:1, passCount:0, likeCount:0 });
  expect(result.records[0].passMetadata).toBe('not_recorded');
});
test('missing style metadata is unsupported, while broken colors are explicitly invalid', () => {
  const result = buildProductEvidence({ product:product('p'), attributes:{product_id:'p', colors:42,style_tags:[]} });
  expect(result.fields.colors.status).toBe('invalid');
  expect(result.fields.styleTags.status).toBe('unsupported');
  expect(result.fields.colors.values).toEqual([]);
});
test('repository null attribute contexts preserve absent versus read-error semantics', () => {
  const absent=buildProductEvidence({product:product('p'),attributes:null,metadataStatus:'absent',semanticColumns:'unavailable'});
  expect(absent.metadataStatus).toBe('absent');expect(absent.issues).toEqual([]);
  expect(absent.fields.styleTags.status).toBe('unsupported');
  const failed=buildProductEvidence({product:product('p'),attributes:null,metadataStatus:'error'});
  expect(failed.metadataStatus).toBe('error');expect(failed.fields.colors.status).toBe('unavailable');
});
test('raw category corruption and metadata identity mismatch never receive invented defaults', () => {
  const p = product('p'); Object.defineProperty(p,'category',{value:'invented'});
  expect(buildProductEvidence({product:p}).fields.category.status).toBe('invalid');
  const wrong = buildProductEvidence({product:product('p'),attributes:{product_id:'other',colors:['siyah']} });
  expect(wrong.issues).toContain('metadata_identity_mismatch');
  expect(wrong.fields.colors.values).toEqual([]);
});
test('variant colors retain medium provenance; title hints retain low derived provenance', () => {
  const variant = buildProductEvidence({product:{...product('v'),colors:[{name:'Siyah',hex:'#111111'}]}});
  const inferred = evidence('i','Siyah Fixture');
  expect(variant.fields.colors.values[0]).toMatchObject({source:'catalog_variant',confidence:'medium',origin:'declared'});
  expect(inferred.fields.colors.values[0]).toMatchObject({source:'title_inferred',confidence:'low',origin:'derived'});
  const uncertain = buildUserEvidence(input({likes:Array.from({length:10},(_,i)=>evidence(`i${i}`,'Siyah Fixture'))}));
  expect(uncertain.dimensions.colors.status).toBe('insufficient_data');
  expect(uncertain.dimensions.colors.values[0].uncertainCount).toBe(10);
});
test('catalog attribute provenance is not upgraded merely because labels repeat', () => {
  const liked = Array.from({length:10},(_,i)=>buildProductEvidence({product:product(`p${i}`),attributes:{product_id:`p${i}`,colors:['siyah']}}));
  const result = buildUserEvidence(input({likes:liked}));
  expect(result.dimensions.colors.status).toBe('insufficient_data');
  expect(result.dimensions.colors.values[0]).toMatchObject({uncertainCount:10,likeCount:10});
});
test('reliable color observations report counts with counter-evidence, never a calibrated score', () => {
  const liked = Array.from({length:10},(_,i)=>buildProductEvidence({product:{...product(`p${i}`),colors:[{name:'Siyah',hex:'#111111'}]}}));
  const rejected = buildProductEvidence({product:{...product('negative'),colors:[{name:'Siyah',hex:'#111111'}]}});
  const result = buildUserEvidence(input({likes:liked,passes:[{productId:'negative',evidence:rejected}]}));
  expect(result.dimensions.colors.status).toBe('observed_pattern');
  expect(result.dimensions.colors.values[0]).toMatchObject({likeCount:10,passCount:1});
});
test('single-category catalog coverage is a limitation, not a personal style conclusion', () => {
  const liked = Array.from({length:10},(_,i)=>evidence(`p${i}`));
  const result = buildUserEvidence(input({likes:liked,catalog:liked}));
  expect(result.limitations).toContain('single_category_catalog');
  expect(result.limitations).toContain('encounter_history_not_recorded');
  expect(result.dimensions.category.values[0].value).toBe('upper_body');
});
test('owned clothes are not likes; repeated outfit membership is separate usage evidence', () => {
  const result = buildUserEvidence(input({owned:[{id:'w',category:'upper_body'}],
    outfits:[{id:'o',wardrobeItemIds:['w','w'],catalogProductIds:[]},{id:'o',wardrobeItemIds:['w'],catalogProductIds:[]}]}));
  expect(result.counts).toEqual({liked:0,passed:0,owned:1,used:1,outfits:1});
  expect(result.dimensions.category.values[0]).toMatchObject({ownedCount:1,usedCount:1,likeCount:0});
  expect(buildUserEvidence(input({outfits:[{id:'broken',wardrobeItemIds:['missing'],catalogProductIds:[]}]})).missing).toContain('outfit_reference_unresolved');
});
test('foreign source owner and foreign declared profile are rejected', () => {
  const result = buildUserEvidence(input({sourceOwnerId:'B',likes:[evidence('private')]}));
  expect(result.status).toBe('owner_mismatch'); expect(result.records).toEqual([]);
  const profile = {userId:'B',heightCm:null,weightKg:null,topSize:null,bottomSize:null,styleTags:[],modelPhotoPath:null};
  expect(buildUserEvidence(input({profile})).missing).toContain('declared_profile_owner_mismatch');
});
test('deduplication conflicts are deterministic even with differing metadata copies', () => {
  const a=evidence('p','Siyah Fixture'), b=evidence('p','Beyaz Fixture');
  const result=buildUserEvidence(input({likes:[a,b]}));
  expect(result.conflicts).toContainEqual({code:'metadata_versions_disagree',productId:'p'});
  expect(result).toEqual(buildUserEvidence(input({likes:[b,a]})));
});
test('reordering is deterministic, changed input recomputes without a cache', () => {
  const likes=[evidence('a'),evidence('b')];
  expect(buildUserEvidence(input({likes}))).toEqual(buildUserEvidence(input({likes:[...likes].reverse()})));
  expect(buildUserEvidence(input({likes:likes.slice(0,1)})).counts.liked).toBe(1);
});
test('backend weights are not unique-item evidence; stale/missing snapshots are explicit', () => {
  const common=buildUserEvidence(input()); const backend=emptyStyleProfile('A');
  expect(compareBackendProfile(common,null).status).toBe('missing');
  expect(compareBackendProfile(common,{snapshot:backend}).freshness).toBe('unverified');
  expect(compareBackendProfile(common,{snapshot:backend,computedAt:'2026-10-01T00:00:00Z'},'2026-10-02T00:00:00Z').freshness).toBe('stale');
  const report=compareBackendProfile(common,{snapshot:backend});
  expect(report.equivalence).toBe('not_equivalent');
  expect(report.differences).toContain('event_weights_decay_and_normalization');
  expect(compareBackendProfile(common,{snapshot:emptyStyleProfile('B')}).status).toBe('owner_mismatch');
});
test('backend comparison describes the actual SQL rather than inventing a weight bridge', () => {
  const sql=readFileSync(resolve(__dirname,'../supabase/recs_v1.sql'),'utf8');
  expect(sql).toContain('power(0.5, v_age_sec / v_half_life_sec)');
  expect(sql).toContain('order by e.created_at desc, e.event_id desc');
  expect(sql).toContain('limit 1000');
  expect(sql).toContain('round(v_val / v_max, 6)');
});
test('uncertain outfit metadata never subtracts independent reliable like evidence', () => {
  const likes=Array.from({length:10},(_,i)=>buildProductEvidence({product:{...product(`like${i}`),colors:[{name:'Siyah',hex:'#111111'}]}}));
  const catalog=Array.from({length:10},(_,i)=>evidence(`used${i}`,'Siyah Fixture'));
  const result=buildUserEvidence(input({likes,catalog,outfits:[{id:'outfit',wardrobeItemIds:[],catalogProductIds:catalog.map(p=>p.productId)}]}));
  expect(result.dimensions.colors.status).toBe('observed_pattern');
  expect(result.dimensions.colors.values[0]).toMatchObject({reliableLikeCount:10,usedCount:10,uncertainCount:10});
});
test('malformed array elements and invalid declared preferences stay explicit', () => {
  expect(buildProductEvidence({product:product('p'),attributes:{product_id:'p',colors:[42]}}).fields.colors.status).toBe('invalid');
  const profile={userId:'A',heightCm:null,weightKg:null,topSize:null,bottomSize:null,styleTags:[],modelPhotoPath:null,priceRange:{min:500,max:100}};
  const result=buildUserEvidence(input({profile}));
  expect(result.declared.priceRange.value).toBeNull();
  expect(result.declaredConflicts).toContainEqual({code:'invalid_declared_value',field:'priceRange',values:['500','100']});
});
test('real style tags retain provenance without inventing personality or hiding invalid vocabulary', () => {
  const p=buildProductEvidence({product:product('p'),attributes:{product_id:'p',style_tags:['minimal']},semanticColumns:'loaded'});
  expect(p.fields.styleTags.values[0]).toMatchObject({value:'minimal',source:'catalog_attribute',confidence:'unknown'});
  expect(buildUserEvidence(input({likes:[p]})).dimensions.styleTags.status).toBe('insufficient_data');
  expect(buildProductEvidence({product:product('x'),attributes:{product_id:'x',style_tags:['invented_identity']}}).fields.styleTags.status).toBe('invalid');
});
test('canonical color vocabulary is shared with scoring, while count and weight semantics differ', () => {
  const likes=Array.from({length:10},(_,i)=>buildProductEvidence({product:{...product(`p${i}`),colors:[{name:'Siyah',hex:'#111111'}]}}));
  const common=buildUserEvidence(input({likes}));
  const backend={...emptyStyleProfile('A'),colorW:{siyah:1}};
  expect(common.dimensions.colors.values[0].value).toBe(Object.keys(backend.colorW)[0]);
  expect(common.dimensions.colors.values[0].likeCount).toBe(10);
  expect(backend.colorW.siyah).toBe(1);
  expect(compareBackendProfile(common,{snapshot:backend}).equivalence).toBe('not_equivalent');
});
test('recorded but conflicting pass metadata is not mislabeled as absent history', () => {
  const a=evidence('p','Siyah Fixture'), b=evidence('p','Beyaz Fixture');
  const common=buildUserEvidence(input({passes:[{productId:'p',evidence:a},{productId:'p',evidence:b}]}));
  expect(common.records[0].passMetadata).toBe('conflicted');
  expect(common.missing).not.toContain('pass_metadata_not_recorded');
  expect(common.counts.passed).toBe(1);
});
test('shared evidence remains a pure, unwired adapter with no app or scoring consumers', () => {
  const root=resolve(__dirname,'..');
  const files=(dir:string):string[]=>readdirSync(dir).flatMap(name=>{
    const path=resolve(dir,name);
    return statSync(path).isDirectory()?files(path):/\.(ts|tsx)$/.test(name)?[path]:[];
  });
  const importers=['app','components','services','store','lib','hooks','src'].flatMap(dir=>files(resolve(root,dir)))
    .filter(path=>/sharedEvidence|sharedStyleEvidence/.test(readFileSync(path,'utf8')))
    .map(path=>relative(root,path).replace(/\\/g,'/'));
  expect(importers).toEqual(['src/intelligence/evidence/sharedEvidence.ts']);
  const source=readFileSync(resolve(root,'src/intelligence/evidence/sharedEvidence.ts'),'utf8');
  expect(source).not.toMatch(/useAppStore|AsyncStorage|\bfetch\s*\(|\.rpc\s*\(|analytics|Date\.now|new Date|\/services\//);
});

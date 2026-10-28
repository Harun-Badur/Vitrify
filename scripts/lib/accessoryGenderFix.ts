import { ENRICHMENT_ATTRIBUTE_VERSION, MANUAL_REVIEW_ATTRIBUTE_SOURCE, MANUAL_REVIEW_ATTRIBUTE_VERSION } from '../../lib/catalogEnrichment';
import { inferGenderDetail } from '../../lib/productAttributes';
import { allowedGendersFor, type ProductPref } from '../../lib/productPreferenceRules';
import type { BackfillProductRow } from './catalogBackfill';

/**
 * Pure SQL/CSV builders for the accessory gender fix (rule v3). Nothing here connects to a
 * database; scripts/accessoryGenderFix.ts reads the live catalog and writes the files, and a
 * person applies the SQL.
 */

/** 11 accessories tagged unisex by the removed accessory_neutral rule, plus a T-shirt whose
 * unisex came only from a legacy stored value. Decided 2026-10-28: unisex needs explicit evidence. */
export const ACCESSORY_GENDER_FIX_IDS: readonly string[] = [
  'flo-201729383', 'flo-201729387', 'flo-201729388', 'flo-201845552', 'flo-201846669',
  'trendyol-1086036215', 'trendyol-353730430', 'trendyol-662226049', 'trendyol-943974640',
  'trendyol-952669343', 'trendyol-990425210', 'hepsiburada-HBCV0000CYITMK',
];

export interface GenderFixRow extends BackfillProductRow {
  /** Legacy product_attributes.gender. */
  attributeGender: string | null;
}

export type ReviewDecision = 'kadin' | 'erkek' | 'unisex' | 'cikar';
export interface ReviewEntry { id: string; decision: ReviewDecision }

const DECISIONS: readonly ReviewDecision[] = ['kadin', 'erkek', 'unisex', 'cikar'];
const LEGACY_GENDER: Readonly<Record<Exclude<ReviewDecision, 'cikar'>, string>> = { kadin: 'women', erkek: 'men', unisex: 'unisex' };

/** Stored unisex without an explicit unisex word in the title (high-confidence title token). */
export const selectUnprovenUnisex = <T extends GenderFixRow>(rows: readonly T[]): T[] => rows.filter((row) => {
  if (row.gender !== 'unisex') return false;
  const evidence = inferGenderDetail(row.title, row.product_url, row.category);
  return !(evidence.gender === 'unisex' && evidence.confidence === 'high');
});

const literal = (value: string | null): string => (value === null ? 'null' : `'${value.replace(/'/g, "''")}'`);
const textArray = (value: readonly string[] | null): string =>
  value === null ? 'null' : value.length === 0 ? "'{}'::text[]" : `array[${value.map(literal).join(', ')}]::text[]`;
const idList = (ids: readonly string[]): string => ids.map(literal).join(', ');

export const buildBackupSql = (ids: readonly string[]): string => `-- Read-only: run and save the result before accessory_gender_fix.sql.
select p.id, p.gender, p.feed_eligible, p.eligibility_missing, p.attribute_source, p.attribute_version,
       a.gender as attribute_gender
from public.products p
left join public.product_attributes a on a.product_id = p.id
where p.id in (${idList(ids)})
order by p.id;
`;

export const buildFixSql = (rows: readonly GenderFixRow[]): string => {
  const ids = idList(rows.map((row) => row.id));
  const expected = rows.map((row) => `(${literal(row.id)}, ${literal(row.attributeGender)}::text)`).join(',\n    ');
  return `begin;

-- Accessory gender fix (rule v${ENRICHMENT_ATTRIBUTE_VERSION}): unisex only with explicit evidence.
-- ${rows.length} rows: gender NULL in products and product_attributes, out of the feed.
-- Rollback: accessory_gender_fix_rollback.sql.

do $precondition$
declare v_count integer;
begin
  with expected (id, attribute_gender) as (values
    ${expected})
  select count(*) into v_count
  from expected e
  join public.products p on p.id = e.id
  left join public.product_attributes a on a.product_id = p.id
  where p.gender is not distinct from 'unisex'
    and p.feed_eligible is true
    and a.gender is not distinct from e.attribute_gender;
  if v_count <> ${rows.length} then
    raise exception 'accessory_gender_fix: expected ${rows.length} rows in the snapshot state, found %', v_count;
  end if;
end;
$precondition$;

update public.products
set gender = null,
    feed_eligible = false,
    eligibility_missing = case
      when 'gender' = any(coalesce(eligibility_missing, '{}'::text[])) then eligibility_missing
      else array_append(coalesce(eligibility_missing, '{}'::text[]), 'gender')
    end,
    attribute_version = ${ENRICHMENT_ATTRIBUTE_VERSION}
where id in (${ids});

update public.product_attributes
set gender = null
where product_id in (${ids})
  and gender is not null;

do $verify$
declare v_count integer;
begin
  select count(*) into v_count from public.products
  where id in (${ids})
    and gender is null and feed_eligible is false and 'gender' = any(eligibility_missing);
  if v_count <> ${rows.length} then
    raise exception 'accessory_gender_fix: verification found % fixed rows', v_count;
  end if;
  if exists (select 1 from public.product_attributes where product_id in (${ids}) and gender is not null) then
    raise exception 'accessory_gender_fix: product_attributes.gender still set';
  end if;
end;
$verify$;

commit;
`;
};

export const buildRollbackSql = (rows: readonly GenderFixRow[]): string => {
  const ids = idList(rows.map((row) => row.id));
  const restores = rows.map((row) => [
    `update public.products set gender = ${literal(row.gender)}, feed_eligible = ${row.feed_eligible === true}, `
      + `eligibility_missing = ${textArray(row.eligibility_missing)}, attribute_source = ${literal(row.attribute_source)}, `
      + `attribute_version = ${row.attribute_version ?? 'null'} where id = ${literal(row.id)};`,
    `update public.product_attributes set gender = ${literal(row.attributeGender)} where product_id = ${literal(row.id)};`,
  ].join('\n')).join('\n');
  return `begin;

-- Restores the snapshot taken before accessory_gender_fix.sql. Refuses rows a person has reviewed since.

do $precondition$
declare v_count integer;
begin
  select count(*) into v_count from public.products
  where id in (${ids})
    and gender is null and feed_eligible is false
    and attribute_source is distinct from 'manual_review';
  if v_count <> ${rows.length} then
    raise exception 'accessory_gender_rollback: expected ${rows.length} rows in the fixed state, found %', v_count;
  end if;
end;
$precondition$;

${restores}

commit;
`;
};

const csvCell = (value: string): string => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export const REVIEW_CSV_HEADER = ['id', 'baslik', 'marka', 'kategori', 'fiyat', 'gorsel_url', 'mevcut_cinsiyet', 'karar'];

export const buildReviewCsv = (rows: readonly GenderFixRow[]): string => [
  REVIEW_CSV_HEADER.join(','),
  ...rows.map((row) => [row.id, row.title, row.brand ?? '', row.category, String(row.current_price ?? row.price),
    row.image_url ?? '', row.gender ?? '', ''].map(csvCell).join(',')),
].join('\n') + '\n';

const parseCsvRows = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((entry) => entry.some((value) => value.trim() !== ''));
};

/** Decided rows only; a blank decision is skipped, an unknown one is an error. */
export const parseReviewCsv = (text: string): ReviewEntry[] => {
  const [header, ...rows] = parseCsvRows(text.replace(/^﻿/, ''));
  if (header?.join(',') !== REVIEW_CSV_HEADER.join(',')) throw new Error('Unexpected review CSV header');
  const idIndex = REVIEW_CSV_HEADER.indexOf('id'), decisionIndex = REVIEW_CSV_HEADER.indexOf('karar');
  return rows.flatMap((row) => {
    const id = row[idIndex]?.trim() ?? '';
    const decision = (row[decisionIndex] ?? '').trim().toLocaleLowerCase('tr-TR');
    if (decision === '') return [];
    if (!(DECISIONS as readonly string[]).includes(decision)) throw new Error(`Unknown decision for ${id}: ${decision}`);
    return [{ id, decision: decision as ReviewDecision }];
  });
};

export const buildReviewSql = (entries: readonly ReviewEntry[]): string => {
  const ids = idList(entries.map((entry) => entry.id));
  const updates = entries.map(({ id, decision }) => {
    const source = `attribute_source = ${literal(MANUAL_REVIEW_ATTRIBUTE_SOURCE)},\n    attribute_version = ${MANUAL_REVIEW_ATTRIBUTE_VERSION}`;
    if (decision === 'cikar') {
      return `-- ${id}: cikar (stays out of the feed, gender NULL)\nupdate public.products\nset ${source}\nwhere id = ${literal(id)};`;
    }
    return `-- ${id}: ${decision}
update public.products
set gender = ${literal(decision)},
    eligibility_missing = array_remove(coalesce(eligibility_missing, '{}'::text[]), 'gender'),
    feed_eligible = cardinality(array_remove(coalesce(eligibility_missing, '{}'::text[]), 'gender')) = 0,
    ${source}
where id = ${literal(id)};
update public.product_attributes set gender = ${literal(LEGACY_GENDER[decision])} where product_id = ${literal(id)};`;
  }).join('\n\n');
  return `begin;

-- Manual review decisions for the accessory gender fix (attribute_source=${MANUAL_REVIEW_ATTRIBUTE_SOURCE}).
-- Runs only on rows still in the fixed state (gender NULL, out of the feed).

do $precondition$
declare v_count integer;
begin
  select count(*) into v_count from public.products
  where id in (${ids})
    and gender is null and feed_eligible is false;
  if v_count <> ${entries.length} then
    raise exception 'accessory_gender_review: expected ${entries.length} rows in the fixed state, found %', v_count;
  end if;
end;
$precondition$;

${updates}

commit;
`;
};

export interface FeedRow { category: string; gender: string | null; feed_eligible: boolean | null }
type FeedCounts = Record<ProductPref, number>;
export interface FeedSummary { eligible: number; feeds: FeedCounts; categories: Record<string, FeedCounts> }

const PREFS: readonly ProductPref[] = ['kadin', 'erkek', 'hepsi'];

/** Same selection as the client catalog query: feed_eligible and gender in allowedGendersFor(pref). */
export const summarizeFeeds = (rows: readonly FeedRow[]): FeedSummary => {
  const empty = (): FeedCounts => ({ kadin: 0, erkek: 0, hepsi: 0 });
  const summary: FeedSummary = { eligible: 0, feeds: empty(), categories: {} };
  for (const row of rows) {
    if (row.feed_eligible !== true) continue;
    summary.eligible++;
    const category = (summary.categories[row.category] ??= empty());
    for (const pref of PREFS) {
      if (!(allowedGendersFor(pref) as readonly string[]).includes(row.gender ?? '')) continue;
      summary.feeds[pref]++;
      category[pref]++;
    }
  }
  return summary;
};

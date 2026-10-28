import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ACCESSORY_GENDER_FIX_IDS,
  buildBackupSql,
  buildFixSql,
  buildReviewCsv,
  buildReviewSql,
  buildRollbackSql,
  parseReviewCsv,
  selectUnprovenUnisex,
  summarizeFeeds,
  type GenderFixRow,
} from './lib/accessoryGenderFix';
import { planCatalogBackfill, type BackfillAttributeRow } from './lib/catalogBackfill';

// Reads the live catalog with the anon key (GET only) and writes SQL for a person to apply.
// It never writes to any database and never prints a key.
//   npx tsx scripts/accessoryGenderFix.ts            -> fix/rollback/backup SQL, review CSV, dry-run counts
//   npx tsx scripts/accessoryGenderFix.ts --review   -> SQL for the decisions marked in the review CSV
const root = process.cwd();
const QUERIES = 'scripts/queries';
const REVIEW_DIR = 'reports/accessory-gender-review-2026-10-28';
const REVIEW_CSV = `${REVIEW_DIR}/review.csv`;

const write = (path: string, text: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};

const anonClient = () => {
  const env = new Map(readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^(EXPO_PUBLIC_SUPABASE_(?:URL|ANON_KEY))=(.*)$/);
    return match ? [[match[1], match[2].trim().replace(/^["']|["']$/g, '')] as const] : [];
  }));
  const url = env.get('EXPO_PUBLIC_SUPABASE_URL'), key = env.get('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (!url || !key) throw new Error('EXPO_PUBLIC_SUPABASE_URL / ANON_KEY missing in .env');
  return async <T>(path: string): Promise<T> => {
    const response = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!response.ok) throw new Error(`GET ${path.split('?')[0]} failed: ${response.status}`);
    return response.json() as Promise<T>;
  };
};

const prepare = async (): Promise<void> => {
  const get = anonClient();
  const products = await get<Omit<GenderFixRow, 'attributeGender'>[]>('products?select=id,title,brand,category,'
    + 'product_url,price,current_price,image_url,gender,feed_eligible,eligibility_missing,attribute_source,attribute_version'
    + '&order=id&limit=5000');
  const attributes = await get<BackfillAttributeRow[]>('product_attributes?select=product_id,gender,colors,fit,subcategory&limit=5000');
  const attributeGender = new Map(attributes.map((row) => [row.product_id, row.gender ?? null]));
  const rows: GenderFixRow[] = products.map((row) => ({ ...row, attributeGender: attributeGender.get(row.id) ?? null }));

  const unproven = selectUnprovenUnisex(rows);
  const expected = [...ACCESSORY_GENDER_FIX_IDS].sort();
  if (JSON.stringify(unproven.map((row) => row.id).sort()) !== JSON.stringify(expected)) {
    throw new Error(`Live unproven unisex set differs from the decided list: ${unproven.map((row) => row.id).join(', ')}`);
  }
  const fixRows = expected.map((id) => rows.find((row) => row.id === id)!);
  write(`${QUERIES}/accessory_gender_fix_backup.sql`, buildBackupSql(expected));
  write(`${QUERIES}/accessory_gender_fix.sql`, buildFixSql(fixRows));
  write(`${QUERIES}/accessory_gender_fix_rollback.sql`, buildRollbackSql(fixRows));
  write(REVIEW_CSV, buildReviewCsv(fixRows));

  // Dry-run: the live rows after the fix SQL, then what a rule-v3 backfill would still change.
  const fixed = new Set(expected);
  const after = rows.map((row) => !fixed.has(row.id) ? row : {
    ...row, gender: null, feed_eligible: false, attribute_version: 3, attributeGender: null,
    eligibility_missing: row.eligibility_missing?.includes('gender') ? row.eligibility_missing : [...(row.eligibility_missing ?? []), 'gender'],
  });
  const afterAttributes = attributes.map((row) => (fixed.has(row.product_id) ? { ...row, gender: null } : row));
  const backfill = planCatalogBackfill(after, afterAttributes);
  const changedBeyondVersion = backfill.products.filter((change) => change.before.gender !== change.after.gender
    || change.before.feed_eligible !== change.after.feed_eligible);
  const report = {
    before: summarizeFeeds(rows),
    after: summarizeFeeds(after),
    fixedRows: expected.length,
    backfillV3AfterFix: { rowsWithNewVersionOnly: backfill.products.length - changedBeyondVersion.length,
      genderOrEligibilityChanges: changedBeyondVersion.map((change) => ({ id: change.id, before: change.before, after: change.after })) },
  };
  write(`${REVIEW_DIR}/dry-run.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
};

const review = (): void => {
  const entries = parseReviewCsv(readFileSync(join(root, REVIEW_CSV), 'utf8'));
  const unknown = entries.filter((entry) => !ACCESSORY_GENDER_FIX_IDS.includes(entry.id));
  if (unknown.length > 0) throw new Error(`Review CSV has ids outside the fix: ${unknown.map((entry) => entry.id).join(', ')}`);
  if (entries.length === 0) throw new Error('No decisions marked in the review CSV');
  write(`${QUERIES}/accessory_gender_review_apply.sql`, buildReviewSql(entries));
  console.log(JSON.stringify({ decisions: entries.length,
    pending: ACCESSORY_GENDER_FIX_IDS.length - entries.length, sql: `${QUERIES}/accessory_gender_review_apply.sql` }));
};

const args = process.argv.slice(2);
if (args.length > 1 || (args[0] !== undefined && args[0] !== '--review')) throw new Error(`Unknown arguments: ${args.join(' ')}`);
if (args[0] === '--review') review();
else void prepare().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });

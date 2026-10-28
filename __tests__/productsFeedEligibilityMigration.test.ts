import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Static contract only: no database is available to Jest and nothing is applied here.
const sql = readFileSync(resolve(__dirname, '../supabase/migrations/202610280001_products_feed_eligibility.sql'), 'utf8');
const code = sql.replace(/--.*$/gm, '');

describe('products feed eligibility migration', () => {
  it('runs in one transaction with the precondition before any change', () => {
    expect(code.trim()).toMatch(/^begin;/i);
    expect(code.trim()).toMatch(/commit;$/i);
    const precondition = code.indexOf('$precondition$');
    expect(precondition).toBeGreaterThan(0);
    expect(precondition).toBeLessThan(code.search(/alter table public\.products/i));
    expect(code).toMatch(/raise exception/i);
  });

  it('adds the requested columns with feed_eligible defaulting to false', () => {
    expect(code).toMatch(/add column if not exists gender text/i);
    expect(code).toMatch(/add column if not exists feed_eligible boolean not null default false/i);
    expect(code).toMatch(/add column if not exists eligibility_missing text\[\]/i);
    expect(code).toMatch(/add column if not exists attribute_source text/i);
    expect(code).toMatch(/add column if not exists attribute_version integer/i);
    expect(code).toMatch(/gender is null or gender in \('kadin', 'erkek', 'unisex', 'cocuk'\)/i);
  });

  it('reuses product_attributes for color, subtype and fit instead of new product columns', () => {
    expect(code).not.toMatch(/add column if not exists (colors|subcategory|fit)\b/i);
    expect(code).toMatch(/'product_attributes', 'colors'/);
  });

  it('does not change RLS, policies or grants and verifies the new columns stay readable', () => {
    expect(code).not.toMatch(/\b(create|drop|alter) policy\b/i);
    expect(code).not.toMatch(/\b(grant|revoke)\b/i);
    expect(code).not.toMatch(/(enable|disable) row level security/i);
    expect(code).toMatch(/has_column_privilege\(v_role, 'public\.products', v_column, 'SELECT'\)/);
    expect(code).toMatch(/pg_policies/);
  });
});

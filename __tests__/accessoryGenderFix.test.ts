import {
  ACCESSORY_GENDER_FIX_IDS,
  buildFixSql,
  buildReviewCsv,
  buildReviewSql,
  buildRollbackSql,
  parseReviewCsv,
  selectUnprovenUnisex,
  summarizeFeeds,
  type GenderFixRow,
} from '../scripts/lib/accessoryGenderFix';

// Test-only rows; never written to any database.
const row = (overrides: Partial<GenderFixRow> = {}): GenderFixRow => ({
  id: 'trendyol-990425210', title: 'xtaki 10 Çeyrekli kolye', brand: "O'Brand", category: 'accessories',
  product_url: 'https://example.invalid/kolye', price: 250, current_price: 199,
  image_url: 'https://example.invalid/kolye.jpg',
  gender: 'unisex', feed_eligible: true, eligibility_missing: [], attribute_source: 'title_rules', attribute_version: 2,
  attributeGender: null,
  ...overrides,
});

describe('which unisex products lack evidence', () => {
  it('keeps an explicit "Unisex" title word and flags a silent title, whatever the stored value', () => {
    const rows = [
      row({ id: 'kolye', title: 'Altın Kaplama Kolye' }),
      row({ id: 'cap', title: 'adidas BB CAP Siyah Unisex Şapka', category: 'hats' }),
      row({ id: 'tshirt', title: 'Slogan Baskılı Basic Beyaz T-Shirt', category: 'upper_body', attributeGender: 'unisex' }),
      row({ id: 'kadin', title: 'Kadın Kolye', gender: 'kadin' }),
    ];
    expect(selectUnprovenUnisex(rows).map(entry => entry.id)).toEqual(['kolye', 'tshirt']);
  });

  it('names the 11 accessory rows and the T-shirt decided for this fix', () => {
    expect(ACCESSORY_GENDER_FIX_IDS).toHaveLength(12);
    expect(new Set(ACCESSORY_GENDER_FIX_IDS).size).toBe(12);
    expect(ACCESSORY_GENDER_FIX_IDS).toContain('hepsiburada-HBCV0000CYITMK');
  });
});

describe('fix SQL', () => {
  const rows = [row(), row({ id: 'hepsiburada-HBCV0000CYITMK', title: 'Basic T-Shirt', attributeGender: 'unisex',
    eligibility_missing: null })];
  const sql = buildFixSql(rows);

  it('runs in one transaction and refuses to run if any row moved since the snapshot', () => {
    expect(sql.trimStart().startsWith('begin;')).toBe(true);
    expect(sql.trimEnd().endsWith('commit;')).toBe(true);
    expect(sql).toContain("gender is not distinct from 'unisex'");
    expect(sql).toContain('feed_eligible is true');
    expect(sql).toMatch(/raise exception 'accessory_gender_fix: expected 2 rows/);
  });

  it('clears gender in both tables, drops the rows from the feed and records the missing gender', () => {
    expect(sql).toContain('set gender = null,');
    expect(sql).toContain('feed_eligible = false,');
    expect(sql).toContain("array_append(coalesce(eligibility_missing, '{}'::text[]), 'gender')");
    expect(sql).toContain('attribute_version = 3');
    expect(sql).toMatch(/update public\.product_attributes\s+set gender = null/);
    expect(sql).toContain("'trendyol-990425210'");
  });

  it('touches only the listed ids and never deletes', () => {
    expect(sql).not.toMatch(/\bdelete\b/i);
    expect(sql.match(/where id in \(/g)).toHaveLength(2);
  });
});

describe('rollback SQL', () => {
  it('restores the exact snapshot values only while the rows are still in the fixed state', () => {
    const sql = buildRollbackSql([row({ eligibility_missing: ['renk'], attributeGender: 'unisex' })]);
    expect(sql).toContain("gender = 'unisex', feed_eligible = true, eligibility_missing = array['renk']::text[], attribute_source = 'title_rules', attribute_version = 2");
    expect(sql).toContain("update public.product_attributes set gender = 'unisex' where product_id = 'trendyol-990425210'");
    expect(sql).toContain("attribute_source is distinct from 'manual_review'");
    expect(sql).toMatch(/raise exception 'accessory_gender_rollback: expected 1 rows/);
  });
});

describe('review CSV and manual decisions', () => {
  it('writes one row per product with an empty decision column and quotes awkward text', () => {
    const lines = buildReviewCsv([row({ title: 'Kolye, "özel" seri' })]).trimEnd().split('\n');
    expect(lines[0]).toBe('id,baslik,marka,kategori,fiyat,gorsel_url,mevcut_cinsiyet,karar');
    expect(lines[1]).toBe('trendyol-990425210,"Kolye, ""özel"" seri",O\'Brand,accessories,199,https://example.invalid/kolye.jpg,unisex,');
  });

  it('reads decisions back, ignoring rows still left blank', () => {
    const csv = buildReviewCsv([row(), row({ id: 'b' }), row({ id: 'c' })])
      .replace('unisex,\n', 'unisex,erkek\n').replace(/(b,.*unisex,)\n/, '$1cikar\n');
    expect(parseReviewCsv(csv)).toEqual([
      { id: 'trendyol-990425210', decision: 'erkek' },
      { id: 'b', decision: 'cikar' },
    ]);
  });

  it('rejects an unknown decision instead of guessing', () => {
    const csv = buildReviewCsv([row()]).replace('unisex,\n', 'unisex,kadın?\n');
    expect(() => parseReviewCsv(csv)).toThrow('trendyol-990425210');
  });

  it('applies decisions as manual_review, re-checks eligibility, and keeps cikar out of the feed', () => {
    const sql = buildReviewSql([{ id: 'a', decision: 'kadin' }, { id: 'b', decision: 'unisex' }, { id: 'c', decision: 'cikar' }]);
    expect(sql).toContain("attribute_source = 'manual_review'");
    expect(sql).toContain("gender = 'kadin'");
    expect(sql).toContain("set gender = 'women' where product_id = 'a'");
    expect(sql).toContain("set gender = 'unisex' where product_id = 'b'");
    expect(sql).toContain("cardinality(array_remove(coalesce(eligibility_missing, '{}'::text[]), 'gender')) = 0");
    expect(sql).toMatch(/where id = 'c';/);
    expect(sql).toContain('feed_eligible is false');
    expect(sql).not.toMatch(/\bdelete\b/i);
  });
});

describe('feed counts', () => {
  it('counts eligible rows per feed and category the way the client filter reads them', () => {
    const counts = summarizeFeeds([
      { category: 'accessories', gender: 'unisex', feed_eligible: true },
      { category: 'accessories', gender: 'kadin', feed_eligible: true },
      { category: 'shoes', gender: 'erkek', feed_eligible: true },
      { category: 'shoes', gender: null, feed_eligible: true },
      { category: 'shoes', gender: 'erkek', feed_eligible: false },
    ]);
    expect(counts).toEqual({
      eligible: 4,
      feeds: { kadin: 2, erkek: 2, hepsi: 3 },
      categories: { accessories: { kadin: 2, erkek: 1, hepsi: 2 }, shoes: { kadin: 0, erkek: 1, hepsi: 1 } },
    });
  });
});

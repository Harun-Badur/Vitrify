import fs from 'fs';
import path from 'path';
import {
  comboGroupOf,
  comboRelation,
  productComboRelation,
  type ComboGroup,
} from '../src/intelligence/pairing/comboGroups';

interface TitleRow { provider: string; category: string; title: string; group: ComboGroup | null }
const rows: TitleRow[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/comboGroupTitles.json'), 'utf8'));

const product = (title: string, category: string, subcategory?: string) => ({ title, category, subcategory });

describe('combo group classification (title evidence only)', () => {
  it('keeps the expected group for every eligible shoe, bag, hat and accessory title (118)', () => {
    expect(rows).toHaveLength(118);
    const wrong = rows.filter(row => comboGroupOf(product(row.title, row.category)) !== row.group)
      .map(row => `${row.provider}: ${row.title} -> ${comboGroupOf(product(row.title, row.category))} (want ${row.group})`);
    expect(wrong).toEqual([]);
  });

  it('leaves only unprovable titles without a group', () => {
    const unknown = rows.filter(row => row.group === null);
    expect(unknown.map(row => row.title).sort()).toEqual(['Erkek Mavi Pro Haki Şapka', 'Erkek Nakışlı Lacivert Şapka']);
  });

  it('reads Turkish capitals and ASCII spellings alike', () => {
    expect(comboGroupOf(product('KADIN TOPUKLU AYAKKABI', 'shoes'))).toBe('shoe_heel');
    expect(comboGroupOf(product('Erkek Klasik Ayakkabı', 'shoes'))).toBe('shoe_classic');
    expect(comboGroupOf(product('Gizli Topuklu Deri Babet', 'shoes'))).toBe('shoe_flat');
  });

  it('classifies the garment sides the pair table needs', () => {
    expect(comboGroupOf(product('Erkek Haki Keten Şort', 'lower_body', 'sort'))).toBe('bt_short');
    expect(comboGroupOf(product('Siyah Erkek Standart Fit Sporcu Şort', 'lower_body', 'sort'))).toBe('bt_sport');
    expect(comboGroupOf(product('Kahverengi Beli Fermuarlı Dokulu Tüvit Şort Etek', 'lower_body', 'sort'))).toBe('bt_skirt');
    expect(comboGroupOf(product('Siyah Beli Lastikli Krep Kadın Balon Pantolon', 'lower_body', 'pantolon'))).toBe('bt_relaxed');
    expect(comboGroupOf(product('Siyah Kadın Pamuk Pantolon', 'lower_body', 'pantolon'))).toBeNull();
    expect(comboGroupOf(product('Gri Çizgili Kruvaze Takım Elbise', 'upper_body'))).toBe('ow_blazer');
    expect(comboGroupOf(product('Kapüşonlu Kapitone Kadın Şişme Mont', 'upper_body'))).toBe('ow_puffer');
    expect(comboGroupOf(product('Lacivert Kaban', 'upper_body'))).toBe('ow_coat');
    expect(comboGroupOf(product('Gri Kapüşonlu Sweatshirt', 'upper_body'))).toBe('tp_sport');
    expect(comboGroupOf(product('Kırmızı Abiye Elbise', 'dresses'))).toBe('dress_formal');
  });

  it('does not read garment words in a shoe, bag, hat or accessory title as a garment group', () => {
    expect(comboGroupOf(product('Kot Pantolon Kemeri', 'accessories'))).toBe('acc_belt');
    expect(comboGroupOf(product('Şort Etek Desenli Çanta', 'bags'))).toBe('bag_handbag');
  });

  it('returns the same answer after the product title changes in place', () => {
    const item = product('Kadın Topuklu Ayakkabı', 'shoes');
    expect(comboGroupOf(item)).toBe('shoe_heel');
    item.title = 'Erkek Klasik Ayakkabı';
    expect(comboGroupOf(item)).toBe('shoe_classic');
  });
});

describe('combo group relations', () => {
  const HARD: [ComboGroup, ComboGroup][] = [
    ['shoe_classic', 'bt_short'], ['shoe_heel', 'bt_short'],
    ['shoe_heel', 'hat_cap'], ['shoe_classic', 'hat_cap'],
    ['shoe_heel', 'bt_sport'], ['shoe_classic', 'bag_sport'],
    ['shoe_athletic', 'acc_jewelry_formal'], ['shoe_athletic', 'ow_blazer'],
    ['shoe_sneaker', 'acc_jewelry_formal'],
    ['shoe_sandal', 'ow_puffer'], ['hat_straw', 'ow_coat'], ['shoe_sandal', 'hat_beanie'], ['hat_straw', 'acc_scarf'],
    ['hat_cap', 'ow_blazer'], ['hat_cap', 'dress_formal'], ['bag_sport', 'acc_jewelry_formal'],
  ];
  const WEAK: [ComboGroup, ComboGroup][] = [
    ['shoe_sneaker', 'ow_blazer'], ['shoe_sneaker', 'dress_formal'], ['bag_backpack', 'shoe_heel'],
    ['bt_relaxed', 'shoe_heel'], ['bt_relaxed', 'shoe_classic'], ['tp_sport', 'shoe_heel'],
    ['hat_beanie', 'bt_short'], ['ow_puffer', 'bt_short'], ['shoe_sandal', 'acc_jewelry_formal'],
    ['bag_backpack', 'acc_jewelry_formal'], ['bt_short', 'ow_blazer'],
  ];
  const OK: [ComboGroup, ComboGroup][] = [
    ['shoe_sneaker', 'bt_short'], ['shoe_sneaker', 'hat_cap'], ['shoe_classic', 'ow_blazer'],
    ['shoe_heel', 'acc_jewelry_formal'], ['boot_heeled', 'bt_short'], ['shoe_flat', 'hat_cap'],
    ['bag_handbag', 'shoe_heel'], ['acc_belt', 'shoe_classic'], ['shoe_sandal', 'bt_short'],
  ];

  it.each(HARD)('%s x %s is a hard conflict in both directions', (a, b) => {
    expect(comboRelation(a, b)).toBe('hard');
    expect(comboRelation(b, a)).toBe('hard');
  });
  it.each(WEAK)('%s x %s is weak in both directions', (a, b) => {
    expect(comboRelation(a, b)).toBe('weak');
    expect(comboRelation(b, a)).toBe('weak');
  });
  it.each(OK)('%s x %s stays compatible', (a, b) => {
    expect(comboRelation(a, b)).toBe('ok');
    expect(comboRelation(b, a)).toBe('ok');
  });

  it('never blocks or penalises an unknown group', () => {
    expect(comboRelation(null, 'shoe_heel')).toBe('ok');
    expect(comboRelation('hat_cap', null)).toBe('ok');
    expect(comboRelation(null, null)).toBe('ok');
  });

  it('is conservative: only the listed pairs are hard', () => {
    const groups = [...new Set(rows.map(row => row.group).filter((g): g is ComboGroup => g !== null))];
    const hard = groups.flatMap(a => groups.filter(b => a < b && comboRelation(a, b) === 'hard').map(b => `${a}|${b}`));
    expect(hard).toEqual(expect.arrayContaining(['hat_cap|shoe_classic', 'acc_jewelry_formal|shoe_sneaker']));
    // 9 sport x dressy + 1 sneaker x formal jewelry + 4 summer-only x winter-only among the catalog's groups.
    expect(hard).toHaveLength(14);
  });
});

describe('the reported cases', () => {
  const garamond = product('Garamond DORUK 5PR Siyah Erkek Klasik Ayakkabı', 'shoes');
  const shorts = product('Erkek Haki Keten Şort', 'lower_body', 'sort');
  const heel = product('Butigo 26K-236 Siyah Kadın Topuklu Ayakkabı', 'shoes');
  const cap = product('adidas BB CAP COT NL BLACK/WHITE Siyah Unisex Şapka', 'hats');
  const sneaker = product('TRENDY Unisex Gri Sneaker Spor Ayakkabı', 'shoes');
  const pearl = product('Taşmir Sertifikalı 925 Ayar Gümüş Doğal 10MM Inci Kolye Bileklik Set', 'accessories');
  const balloon = product('Siyah Beli Lastikli Krep Kadın Balon Pantolon', 'lower_body', 'pantolon');
  const slim = product('Bej Kısa İnce Topuklu Abiye Ayakkabı 357188 Z', 'shoes');

  it('(a) classic shoes and shorts, (b) heels and a sports cap, (c) a sneaker and pearls are hard conflicts', () => {
    expect(productComboRelation(garamond, shorts)).toBe('hard');
    expect(productComboRelation(heel, cap)).toBe('hard');
    expect(productComboRelation(sneaker, pearl)).toBe('hard');
  });

  it('(d) thin heels with relaxed trousers stay a weak pair, not a block', () => {
    expect(productComboRelation(slim, balloon)).toBe('weak');
  });
});

describe('the module is pure', () => {
  it('has no imports, so Edge and the app can share it', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/intelligence/pairing/comboGroups.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/require\(/);
  });
});

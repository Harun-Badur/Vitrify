import { getInsightWhySheetVisibility, type InsightChip, type InsightChipKind, type InsightEvidence } from '../lib/insightChip';

const productRow: InsightEvidence = { id: 'p1', label: 'Bu ürün', source: 'product' };
const chip = (kind: InsightChipKind, evidence: InsightEvidence[]): InsightChip =>
  ({ kind, label: '', summary: '', evidence });

describe('InsightWhySheet görünürlük kuralı', () => {
  it('yalnız ürün satırı varsa dayanak bölümü gizlenir', () => {
    expect(getInsightWhySheetVisibility(chip('discovery', [productRow])).showEvidence).toBe(false);
  });

  it('gerçek kanıt varsa dayanak bölümü görünür', () => {
    const evidence: InsightEvidence[] = [productRow, { id: 'likes', label: '5 beğeni', source: 'profile' }];
    expect(getInsightWhySheetVisibility(chip('budget', evidence)).showEvidence).toBe(true);
  });

  it('"Dolabımı gör" yalnız dolap kanıtlı türlerde görünür', () => {
    const show = (kind: InsightChipKind) => getInsightWhySheetVisibility(chip(kind, [productRow])).showWardrobeButton;
    expect(show('wardrobe_match')).toBe(true);
    expect(show('completes_wardrobe')).toBe(true);
    expect(show('style_fit')).toBe(false);
    expect(show('budget')).toBe(false);
    expect(show('discovery')).toBe(false);
  });
});

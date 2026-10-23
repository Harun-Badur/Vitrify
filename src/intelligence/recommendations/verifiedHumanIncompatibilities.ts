/**
 * Reviewer conflict marks from phase 7.10.6.
 * Source file: phase7.10.6-gender-attribution-answers.csv.
 * Each row has conflict=yes, high confidence, and the selected slot is this product.
 * The list blocks that anchor-product pair only. It does not set gender.
 */
export interface VerifiedHumanIncompatibility {
  caseCode: string;
  anchorId: string;
  productId: string;
  evidence: 'visual' | 'title' | 'assumption' | 'unspecified';
}

export const VERIFIED_HUMAN_INCOMPATIBILITIES: readonly VerifiedHumanIncompatibility[] = [
  { caseCode: 'R01', anchorId: 'hepsiburada-HBC0000A4I58H', productId: 'trendyol-879907284', evidence: 'visual' },
  { caseCode: 'R02', anchorId: 'trendyol-1044046282', productId: 'trendyol-879907284', evidence: 'title' },
  { caseCode: 'R03', anchorId: 'defacto-3415590', productId: 'trendyol-879907284', evidence: 'assumption' },
  { caseCode: 'R04', anchorId: 'trendyol-1056517113', productId: 'trendyol-879907284', evidence: 'unspecified' },
  { caseCode: 'R05', anchorId: 'defacto-3408872', productId: 'trendyol-879907284', evidence: 'visual' },
  { caseCode: 'R06', anchorId: 'defacto-3148996', productId: 'trendyol-879907284', evidence: 'visual' },
  { caseCode: 'R07', anchorId: 'trendyol-777541770', productId: 'trendyol-879907284', evidence: 'visual' },
  { caseCode: 'R08', anchorId: 'trendyol-1173071782', productId: 'trendyol-879907284', evidence: 'visual' },
  { caseCode: 'R09', anchorId: 'trendyol-810362857', productId: 'trendyol-879907284', evidence: 'visual' },
  { caseCode: 'R10', anchorId: 'defacto-2843240', productId: 'trendyol-879907284', evidence: 'visual' },
  { caseCode: 'R11', anchorId: 'boyner-15896249', productId: 'trendyol-879907284', evidence: 'visual' },
  { caseCode: 'R12', anchorId: 'mavi-1310944-91749', productId: 'trendyol-879907284', evidence: 'visual' },
  { caseCode: 'R13', anchorId: 'hepsiburada-HBC00007F1AGX', productId: 'trendyol-879907284', evidence: 'visual' },
];

const verifiedPairKeys = new Set(
  VERIFIED_HUMAN_INCOMPATIBILITIES.map((row) => `${row.anchorId}\0${row.productId}`),
);

export const isVerifiedHumanIncompatibility = (anchorId: string, productId: string): boolean =>
  verifiedPairKeys.has(`${anchorId}\0${productId}`);

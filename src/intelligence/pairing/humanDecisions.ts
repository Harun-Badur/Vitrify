/**
 * Human reviewer decisions, versioned pairing evidence (Faz 4 S3b; was
 * recommendations/verifiedHumanIncompatibilities.ts). Reviewer conflict marks from phase 7.10.6
 * (phase7.10.6-gender-attribution-answers.csv): conflict=yes, high confidence, and the selected
 * slot is this product. A row blocks that anchor→product pair only; it does not set gender.
 */
export interface HumanDecision {
  caseCode: string;
  anchorId: string;
  productId: string;
  evidence: 'visual' | 'title' | 'assumption' | 'unspecified';
}

export interface HumanDecisionSet {
  version: number;
  rows: readonly HumanDecision[];
}

export const HUMAN_DECISIONS_V1: HumanDecisionSet = Object.freeze({
  version: 1,
  rows: Object.freeze([
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
  ] as const),
});

const pairKeys = new Map<HumanDecisionSet, Set<string>>();

const keysOf = (set: HumanDecisionSet): Set<string> => {
  let keys = pairKeys.get(set);
  if (!keys) {
    keys = new Set(set.rows.map((row) => `${row.anchorId}\0${row.productId}`));
    pairKeys.set(set, keys);
  }
  return keys;
};

/** Directional: the reviewer judged this product as a complement of this anchor. */
export const isHumanIncompatible = (
  anchorId: string,
  productId: string,
  set: HumanDecisionSet = HUMAN_DECISIONS_V1,
): boolean => keysOf(set).has(`${anchorId}\0${productId}`);

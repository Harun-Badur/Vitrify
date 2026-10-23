/** Local evidence preparation only: no network, credentials, DB client or write API. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { buildVerifiedColorPatch, summarizeV1Catalog, type QualityProduct, type QualityAttributes, type ReviewedColor } from './lib/v1CatalogQuality';
import { mapImportCandidate, type ImportCandidateRecord } from './lib/catalogImportPreflight';
import { canonicalizeCatalogUrl } from './lib/seedExpansionRules';
import { renderVerifiedColorSql } from './lib/verifiedColorSql';
import { isFeedProductRow, mapFeedRow } from '../services/catalogProductAdapter';
import { enrichProduct, type ProductAttributeRow } from '../src/intelligence/style/productStyle';

const REVIEW_SHA256 = '3c542cad560237cceef39ba39d04a6ba234f2e679749c9589c987c8b4b419f75';
const option = (name: string) => { const index = process.argv.indexOf(name); if (index < 0 || !process.argv[index + 1]) throw new Error(`Required ${name}`); return process.argv[index + 1]; };

async function main() {
  const snapshotPath = resolve(option('--snapshot'));
  const reviewPath = resolve(option('--review'));
  const output = resolve(option('--out'));
  if ([snapshotPath, reviewPath].some(file => file.startsWith(output + '/') || file.startsWith(output + '\\'))) throw new Error('OUTPUT_MUST_NOT_CONTAIN_INPUT');
  const snapshotBytes = await readFile(snapshotPath);
  const snapshot = JSON.parse(snapshotBytes.toString('utf8')) as { observedAt: string; products: QualityProduct[]; attributes: QualityAttributes[] };
  const reviewBytes = await readFile(reviewPath);
  if (createHash('sha256').update(reviewBytes).digest('hex') !== REVIEW_SHA256) throw new Error('REVIEW_EVIDENCE_HASH_MISMATCH');
  const reviews = parse(reviewBytes, { columns: true, bom: true, skip_empty_lines: true }) as ReviewedColor[];
  const plan = buildVerifiedColorPatch(snapshot.products, snapshot.attributes, reviews);
  // The review approves color sets, not dominant-color order. Preserve the exact
  // existing scoring input whenever that set already matches the approved set.
  const currentProducts = new Map(snapshot.products.map(row => [row.id, row]));
  const currentAttributes = new Map(snapshot.attributes.map(row => [row.product_id, row]));
  for (const patch of plan.patches) {
    const row = currentProducts.get(patch.product_id);
    if (!isFeedProductRow(row)) throw new Error('INVALID_CURRENT_PRODUCT');
    const product = mapFeedRow(row);
    if (!product) throw new Error('INVALID_CURRENT_PRODUCT');
    const colors = enrichProduct(product, currentAttributes.get(row.id) as ProductAttributeRow | undefined).colorSlugs ?? [];
    if (JSON.stringify([...colors].sort()) === JSON.stringify([...patch.colors].sort())) patch.colors = [...colors];
  }
  const patches = new Map(plan.patches.map(row => [row.product_id, row]));
  const before = summarizeV1Catalog(snapshot.products, snapshot.attributes);
  const after = summarizeV1Catalog(snapshot.products, snapshot.attributes.map(row => patches.has(row.product_id) ? { ...row, colors: patches.get(row.product_id)!.colors } : row));
  const knownIds = new Set(snapshot.products.map(product => product.id));
  const knownUrls = new Set(snapshot.products.flatMap(product => { try { return [canonicalizeCatalogUrl(product.product_url)]; } catch { return []; } }));
  const candidates = JSON.parse(await readFile('reports/catalog-expansion-v1/candidates.json', 'utf8')) as ImportCandidateRecord[];
  const decisions = candidates.map(candidate => ({ candidate, decision: mapImportCandidate(candidate) }));
  const unused = decisions.filter(({ candidate }) => !knownIds.has(candidate.id) && !knownUrls.has(canonicalizeCatalogUrl(candidate.productUrl)));
  const blocked = unused.map(({ candidate, decision }) => ({ id: candidate.id, provider: candidate.source,
    productUrl: candidate.productUrl, role: candidate.role, observedOn: candidate.observedOn,
    existingImporterStatus: decision.status,
    rejection: decision.status === 'rejected' ? decision.reason : null,
    importAllowed: false, reason: 'No documented product-data/image reuse permission; current URL, price and image quality not reverified' }));
  const links = (await readFile('scripts/data/new_product_links.tsv', 'utf8')).split(/\r?\n/)
    .map(line => line.split('\t')[0].trim()).filter(line => /^https:\/\//.test(line));
  const linkQueue = [...new Set(links.map(canonicalizeCatalogUrl))].filter(url => !knownUrls.has(url));
  // Acquisition targets only. No claim that these products currently exist or are available.
  const targetRole = { top: 230, bottom: 200, one_piece: 100, outerwear: 130, shoes: 160, bag: 90, accessory: 70, hat: 20 };
  const acquisitionTarget = Object.entries(targetRole).map(([role, target]) => ({ role, existing: before.role[role] ?? 0, target, missing: Math.max(0, target - (before.role[role] ?? 0)) }));
  const summary = { observedAt: snapshot.observedAt, snapshotSha256: createHash('sha256').update(snapshotBytes).digest('hex'),
    sourceReviewSha256: REVIEW_SHA256, before, afterLocalProposal: after,
    colorFillProducts: plan.patches.length, conflictingColorsNotApplied: plan.conflicts.length,
    approvedAlreadyEqual: plan.alreadyEqual, reviewDecisionsNotApplied: plan.rejected.length,
    newProductsImported: 0, permissionVerifiedNewProducts: 0,
    historicalCandidateCount: candidates.length, historicalUnusedCandidates: unused.length,
    historicalUnusedPassingExistingImporter: unused.filter(row => row.decision.status === 'ready').length,
    additionalUnverifiedLinkQueue: linkQueue.length, acquisitionTarget,
    limits: ['No merchant scraping or product/image harvesting', 'No current merchant HTTP/image decode/price verification',
      'No production data write, migration or deploy', 'Source decisions are dated 2026-10-10, not newly observed colors',
      'Six conflicting color decisions are excluded; missing brand/gender/style left unknown without source evidence'] };
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'catalog-snapshot.json'), snapshotBytes);
  await writeFile(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2));
  await writeFile(resolve(output, 'color-fill-proposal.json'), JSON.stringify({ sourceReviewSha256: REVIEW_SHA256, observedAt: snapshot.observedAt, ...plan }, null, 2));
  await writeFile(resolve(output, 'unverified-candidate-queue.json'), JSON.stringify({ candidates: blocked, links: linkQueue }, null, 2));
  const attr = new Map(snapshot.attributes.map(row => [row.product_id, row]));
  await writeFile(resolve(output, 'metadata-gaps.json'), JSON.stringify(snapshot.products.map(product => ({ id: product.id,
    productUrl: product.product_url, missingBrand: !product.brand?.trim(), missingGender: !attr.get(product.id)?.gender,
    missingColors: !Array.isArray(attr.get(product.id)?.colors) || !(attr.get(product.id)!.colors as unknown[]).length,
    missingStyleTags: !Array.isArray(attr.get(product.id)?.style_tags) || !(attr.get(product.id)!.style_tags as unknown[]).length,
    currentStoreLinkNotChecked: true, currentImageQualityNotChecked: true })), null, 2));
  const sql = renderVerifiedColorSql({ sourceReviewSha256: REVIEW_SHA256, ...plan });
  await writeFile(resolve(output, 'approved-color-fill-PROPOSAL.sql'), sql);
  console.log(JSON.stringify({ catalog: before.products, proposedMissingColorFill: plan.patches.length,
    conflictsExcluded: plan.conflicts.length, newProductsEligible: 0, newProductsImported: 0 }));
}

if (require.main === module) main().catch(() => { console.error('CATALOG_LOCAL_PREPARATION_FAILED'); process.exitCode = 1; });

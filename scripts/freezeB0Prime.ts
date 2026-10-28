import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  B0_PRIME_GOLDEN,
  loadB0PrimeDataset,
  readB0ReportFinals,
  replayB0Prime,
} from '../__tests__/fixtures/b0PrimeReplay';

// Freezes B0′ once; __tests__/b0PrimeCharacterization.test.ts then requires every later run to match.
// Usage: npx tsx scripts/freezeB0Prime.ts
const root = process.cwd();
// Release build value; it only switches diagnostics, and Jest replays with its own true.
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const main = async (): Promise<void> => {
  const golden = await replayB0Prime(loadB0PrimeDataset(root));
  const b0 = readB0ReportFinals(root);
  const changed = golden.anchors.flatMap((anchor) => {
    const before = b0.get(anchor.anchorId) ?? null;
    return JSON.stringify(before) === JSON.stringify(anchor.finalIds) ? [] : [{ anchorId: anchor.anchorId, b0: before, b0Prime: anchor.finalIds }];
  });
  const target = join(root, B0_PRIME_GOLDEN);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(golden, null, 2)}\n`);
  writeFileSync(join(dirname(target), 'b0-comparison.json'), `${JSON.stringify({ compared: b0.size, changed }, null, 2)}\n`);
  console.log(JSON.stringify({ golden: B0_PRIME_GOLDEN, datasetSha256: golden.datasetSha256,
    anchors: golden.anchors.length, pairs: golden.pairs.length, changedVsB0: changed.length }));
};

void main();

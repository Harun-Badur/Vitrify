import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  B0_PRIME_GOLDEN,
  B0_PRIME_SCHEMA,
  b0PrimeSourcesPresent,
  loadB0PrimeDataset,
  replayB0Prime,
  type B0PrimeGolden,
} from './fixtures/b0PrimeReplay';

// Phase 4 S1: freezes current behavior before the pairing module lands. The inputs and the golden
// file live in the gitignored reports/ directory (they restore products the 2026-10-27 cleanup
// removed from tracked files), so this suite runs only on machines that have them.
const root = join(__dirname, '..');
const available = b0PrimeSourcesPresent(root) && existsSync(join(root, B0_PRIME_GOLDEN));
const describeLocal = available ? describe : describe.skip;

const TOLERANCE = 1e-9;

const expectScoresEqual = (actual: Record<string, number>, expected: Record<string, number>, label: string): void => {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const key of Object.keys(expected)) {
    if (Math.abs(actual[key] - expected[key]) > TOLERANCE) {
      throw new Error(`${label}.${key}: ${actual[key]} != ${expected[key]}`);
    }
  }
};

describeLocal('B0′ characterization (30 anchors, 80-product pool, empty wardrobe)', () => {
  let golden: B0PrimeGolden;
  let replay: B0PrimeGolden;

  beforeAll(async () => {
    golden = JSON.parse(readFileSync(join(root, B0_PRIME_GOLDEN), 'utf8'));
    // Dev builds log per-stage timings; they are not part of the frozen behavior.
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      replay = await replayB0Prime(loadB0PrimeDataset(root));
    } finally {
      info.mockRestore();
    }
  }, 300_000);

  it('replays the frozen dataset, anchors and pool', () => {
    expect(golden.schema).toBe(B0_PRIME_SCHEMA);
    expect(replay.datasetSha256).toBe(golden.datasetSha256);
    expect(replay.anchorIds).toEqual(golden.anchorIds);
    expect(replay.poolIds).toEqual(golden.poolIds);
  });

  it('keeps every anchor final set, its order and its stage counts', () => {
    expect(replay.anchors).toHaveLength(30);
    replay.anchors.forEach((anchor, index) => {
      const frozen = golden.anchors[index];
      expect({ ...anchor, finalCompatibility: undefined }).toEqual({ ...frozen, finalCompatibility: undefined });
      anchor.finalCompatibility.forEach((score, slot) => {
        expectScoresEqual({ ...score }, { ...frozen.finalCompatibility[slot] }, `${anchor.anchorId}[${slot}]`);
      });
    });
  });

  it('keeps every anchor-pool pair decision of the existing mechanisms', () => {
    expect(replay.pairs).toHaveLength(golden.pairs.length);
    replay.pairs.forEach((pair, index) => {
      const frozen = golden.pairs[index];
      expect({ ...pair, compatibility: undefined }).toEqual({ ...frozen, compatibility: undefined });
      expectScoresEqual({ ...pair.compatibility }, { ...frozen.compatibility }, `${pair.anchorId}|${pair.productId}`);
    });
  });
});

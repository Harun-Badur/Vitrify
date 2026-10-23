import {
  measureWardrobeStage,
  takeWardrobeTimings,
} from '../lib/wardrobeProgress';

afterEach(() => {
  takeWardrobeTimings();
  jest.restoreAllMocks();
});

test('records only stage, elapsed time and outcome, never returned data or thrown errors', async () => {
  const log = jest.spyOn(console, 'info').mockImplementation(() => {});
  const secret = 'private-photo-token-and-path';
  let now = 10;
  jest.spyOn(performance, 'now').mockImplementation(() => now);
  const notify = jest.fn();
  expect(
    await measureWardrobeStage(
      'prepare',
      async () => {
        now = 35;
        return secret;
      },
      notify,
    ),
  ).toBe(secret);
  await expect(
    measureWardrobeStage('upload', async () => {
      now = 45;
      throw new Error(secret);
    }),
  ).rejects.toThrow(secret);
  expect(notify).toHaveBeenCalledWith('prepare');
  expect(takeWardrobeTimings()).toMatchObject({
    prepare: { calls: 1, totalMs: 25, failures: 0 },
    upload: { calls: 1, totalMs: 10, failures: 1 },
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
});

test('an observer failure cannot interrupt saving', async () => {
  jest.spyOn(console, 'info').mockImplementation(() => {});
  expect(
    await measureWardrobeStage(
      'database',
      async () => 'committed',
      () => {
        throw new Error('unmounted');
      },
    ),
  ).toBe('committed');
});

test.each([
  ['cutoutPrepare', 'CUTOUT_PREPARE_FAILED'], ['cutoutProvider', 'CUTOUT_PROVIDER_FAILED'],
  ['cutoutDecode', 'CUTOUT_DECODE_FAILED'], ['cutoutWrite', 'CUTOUT_WRITE_FAILED'],
  ['cutoutUpload', 'CUTOUT_UPLOAD_FAILED'], ['cutoutSign', 'CUTOUT_SIGN_FAILED'],
  ['cutoutCheckpoint', 'CUTOUT_CHECKPOINT_FAILED'],
] as const)('reports safe failure details for %s', async (stage, code) => {
  const log = jest.spyOn(console, 'info').mockImplementation(() => {});
  const error = Object.assign(new Error('private-photo-token-url-owner'), { code: 'private-code', diagnosticHttpStatus: 503 });
  await expect(measureWardrobeStage(stage, async () => { throw error; })).rejects.toBe(error);
  expect(log.mock.calls).toContainEqual([JSON.stringify({ type: 'wardrobe_cutout_failure', stage, code, httpStatus: 503 })]);
  expect(JSON.stringify(log.mock.calls)).not.toContain('private');
});

test('nested cutout stages retain the innermost failure and native API unavailability code', async () => {
  const log = jest.spyOn(console, 'info').mockImplementation(() => {});
  const error = Object.assign(new Error('private native details'), { code: 'ERR_UNAVAILABLE' });
  await expect(measureWardrobeStage('cutout', () => measureWardrobeStage('cutoutProvider', async () => { throw error; }))).rejects.toBe(error);
  const entries = log.mock.calls.map(([entry]) => JSON.parse(entry)).filter(entry => entry.type === 'wardrobe_cutout_failure');
  expect(entries).toEqual([{ type: 'wardrobe_cutout_failure', stage: 'cutoutProvider', code: 'CUTOUT_NATIVE_UNAVAILABLE', httpStatus: null }]);
});

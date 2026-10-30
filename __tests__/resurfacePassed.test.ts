import * as fs from 'fs';
import * as path from 'path';

const load = (enabled: boolean) => {
  jest.resetModules();
  jest.doMock('../lib/prototypeFlags', () => ({ PROTOTYPE_RESURFACE_PASSED_ENABLED: enabled }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../lib/resurfacePassed') as typeof import('../lib/resurfacePassed');
};

describe('resurfacePassed (flag on)', () => {
  it('shows the button only when there are passed products', () => {
    const lib = load(true);
    expect(lib.canResurfacePassed(0)).toBe(false);
    expect(lib.canResurfacePassed(3)).toBe(true);
  });

  it('removes only passed ids from exclusion and leaves the persisted list untouched', () => {
    const lib = load(true);
    const passed = Object.freeze(['p1', 'p2']) as readonly string[];
    expect(lib.effectivePassedIds(passed)).toEqual(['p1', 'p2']);
    lib.resurfacePassed(passed);
    // Liked ids never pass through this helper; the slice adds them separately.
    expect(lib.effectivePassedIds(passed)).toEqual([]);
    expect(lib.effectivePassedIds([...passed, 'p3'])).toEqual(['p3']);
    expect(passed).toEqual(['p1', 'p2']);
  });

  it('excludes a resurfaced product again once it is passed again', () => {
    const lib = load(true);
    lib.resurfacePassed(['p1', 'p2']);
    lib.notePassedAgain('p1');
    expect(lib.effectivePassedIds(['p1', 'p2'])).toEqual(['p1']);
  });

  it('is session-only: a fresh module (app restart) restores normal exclusion', () => {
    load(true).resurfacePassed(['p1']);
    expect(load(true).effectivePassedIds(['p1'])).toEqual(['p1']);
  });
});

describe('resurfacePassed (flag off)', () => {
  it('changes nothing', () => {
    const lib = load(false);
    expect(lib.canResurfacePassed(5)).toBe(false);
    lib.resurfacePassed(['p1']);
    expect(lib.effectivePassedIds(['p1'])).toEqual(['p1']);
  });
});

describe('wiring (source contract)', () => {
  const read = (rel: string): string => fs.readFileSync(path.join(__dirname, rel), 'utf8');
  const slice = read('../store/discoverySlice.ts');
  const screen = read('../app/(tabs)/index.tsx');
  it('every exclusion in the slice goes through effectivePassedIds; stored list is never rewritten by it', () => {
    expect(slice).not.toMatch(/\.\.\.get\(\)\.passedProductIds/);
    expect(slice).not.toMatch(/excludeSeen\([^)]*,\s*(get\(\)|state)\.passedProductIds\)/);
    expect((slice.match(/effectivePassedIds\(/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
  it('shows the secondary button below Yenile, gated by the helper', () => {
    expect(screen).toContain('Geçtiklerimi tekrar göster');
    expect(screen.indexOf("'Yenile'}</Text>")).toBeLessThan(screen.indexOf('Geçtiklerimi tekrar göster'));
    expect(screen).toContain('canResurfacePassed(passedCount)');
  });
  it('marks the temporary code for removal', () => {
    expect(read('../lib/resurfacePassed.ts')).toContain('GEÇİCİ: affiliate feed gelince kaldır');
    expect(read('../lib/prototypeFlags.ts')).toContain('PROTOTYPE_RESURFACE_PASSED_ENABLED = true');
  });
});

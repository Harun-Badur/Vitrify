import { readFileSync } from 'fs';
import { join } from 'path';

const readJson = (file: string) => JSON.parse(readFileSync(join(__dirname, '..', file), 'utf8'));

describe('Vitrify branding without an identity migration', () => {
  it('uses the canonical display and npm package names', () => {
    expect(readJson('app.json').expo.name).toBe('Vitrify');
    expect(readJson('package.json').name).toBe('vitrify');
    expect(readJson('package-lock.json').packages[''].name).toBe('vitrify');
  });

  it('preserves installed app, OAuth and EAS identities', () => {
    const { expo } = readJson('app.json');
    expect(expo.scheme).toBe('kabin');
    expect(expo.android.package).toBe('com.kabin.app');
    expect(expo.ios.bundleIdentifier).toBe('app.kabin.mobile');
    expect(expo.slug).toBe('kabin');
    expect(expo.owner).toBe('harunbadurs-team');
    expect(expo.extra.eas.projectId).toBe('8ba7778a-ee4d-43b0-9594-74b6624a7af6');
  });
});

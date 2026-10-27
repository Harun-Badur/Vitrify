import { PRICE_BAND_REASON_LABEL, pickDisplayReason } from '../lib/displayReason';

describe('pickDisplayReason', () => {
  it('no longer hides the price-band reason; the insight chip gates it on like evidence', () => {
    const module = require('../lib/displayReason') as Record<string, unknown>;
    expect(module.HIDE_PRICE_BAND_REASON).toBeUndefined();
    expect(pickDisplayReason([PRICE_BAND_REASON_LABEL, 'Sevdiğin marka'])).toBe(PRICE_BAND_REASON_LABEL);
  });

  it('keeps other reasons unchanged', () => {
    expect(pickDisplayReason(['Sevdiğin renk: Siyah', PRICE_BAND_REASON_LABEL])).toBe('Sevdiğin renk: Siyah');
    expect(pickDisplayReason(['  Yeni bir şey dene  '])).toBe('Yeni bir şey dene');
  });

  it('returns undefined for empty input', () => {
    expect(pickDisplayReason([])).toBeUndefined();
    expect(pickDisplayReason(['   '])).toBeUndefined();
  });
});

describe('price-band label stays in sync with the reason producers', () => {
  const { readFileSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');
  const sources = ['lib/reasons.ts', 'supabase/functions/_shared/reasons.ts'];

  it.each(sources)('%s emits exactly the filtered label', (file) => {
    const source = readFileSync(join(__dirname, '..', file), 'utf8');
    expect(source).toContain(`label: '${PRICE_BAND_REASON_LABEL}'`);
  });
});

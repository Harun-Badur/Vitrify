import { PRICE_BAND_REASON_LABEL, pickDisplayReason } from '../lib/displayReason';

describe('pickDisplayReason', () => {
  it('hides the price-band reason when it is the only reason (single or many likes)', () => {
    expect(pickDisplayReason([PRICE_BAND_REASON_LABEL])).toBeUndefined();
    expect(pickDisplayReason([PRICE_BAND_REASON_LABEL, PRICE_BAND_REASON_LABEL])).toBeUndefined();
  });

  it('falls through to the next reason when the price-band reason is first', () => {
    expect(pickDisplayReason([PRICE_BAND_REASON_LABEL, 'Sevdiğin marka'])).toBe('Sevdiğin marka');
  });

  it('keeps other reasons unchanged', () => {
    expect(pickDisplayReason(['Sevdiğin renk: Siyah', PRICE_BAND_REASON_LABEL])).toBe('Sevdiğin renk: Siyah');
    expect(pickDisplayReason(['  Yeni bir şey dene  '])).toBe('Yeni bir şey dene');
  });

  it('returns undefined for empty input', () => {
    expect(pickDisplayReason([])).toBeUndefined();
    expect(pickDisplayReason(['   '])).toBeUndefined();
  });

  it('shows the price-band reason again when the hide flag is off', () => {
    expect(pickDisplayReason([PRICE_BAND_REASON_LABEL], false)).toBe(PRICE_BAND_REASON_LABEL);
  });
});

import { isEmailRateLimitError, toTurkishAuthMessage } from '../lib/authError';
test.each([
  new Error('Email rate limit exceeded'),
  { code: 'over_email_send_rate_limit', status: 429 },
])('email quota has a safe actionable message', (error) => {
  expect(isEmailRateLimitError(error)).toBe(true);
  expect(toTurkishAuthMessage(error)).toContain('doğrulama e-postası');
  expect(toTurkishAuthMessage(error)).not.toContain(
    'over_email_send_rate_limit',
  );
});
test('unknown provider details are never displayed', () => {
  expect(toTurkishAuthMessage(new Error('private token=user'))).toBe(
    'İşlem tamamlanamadı. Lütfen tekrar dene.',
  );
});

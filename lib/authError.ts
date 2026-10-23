export const isEmailRateLimitError = (error: unknown): boolean => {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  return code === 'over_email_send_rate_limit' || (error instanceof Error && /email rate limit|over_email_send_rate_limit/i.test(error.message));
};

const AUTH_MESSAGE_BY_NEEDLE: Array<{ needle: string; message: string }> = [
  {
    needle: 'invalid login credentials',
    message: 'E-posta veya şifre hatalı.',
  },
  {
    needle: 'invalid credentials',
    message: 'E-posta veya şifre hatalı.',
  },
  {
    needle: 'invalid_credentials',
    message: 'E-posta veya şifre hatalı.',
  },
  {
    needle: 'email not confirmed',
    message: 'E-postanı doğrulaman gerekiyor.',
  },
  {
    needle: 'email_not_confirmed',
    message: 'E-postanı doğrulaman gerekiyor.',
  },
  {
    needle: 'user already registered',
    message: 'Bu e-posta zaten kayıtlı. Giriş yapmayı dene.',
  },
  {
    needle: 'password should be at least',
    message: 'Şifre en az 6 karakter olmalı.',
  },
  {
    needle: 'unable to validate email',
    message: 'Geçerli bir e-posta adresi gir.',
  },
  {
    needle: 'email rate limit',
    message: 'Çok fazla deneme yapıldı. Biraz sonra tekrar dene.',
  },
  {
    needle: 'over_email_send_rate_limit',
    message: 'Çok fazla deneme yapıldı. Biraz sonra tekrar dene.',
  },
  {
    needle: 'failed to fetch',
    message: 'Sunucuya bağlanılamadı. İnternetini kontrol edip tekrar dene.',
  },
  {
    needle: 'network request failed',
    message: 'Sunucuya bağlanılamadı. İnternetini kontrol edip tekrar dene.',
  },
  {
    needle: 'invalid api key',
    message: 'Sunucu yapılandırması hatalı. Uygulamayı güncelleyip tekrar dene.',
  },
];

export const toTurkishAuthMessage = (error: unknown): string => {
  if (isEmailRateLimitError(error)) return 'Şu anda doğrulama e-postası gönderilemiyor. Bir süre sonra tekrar dene. Hesabın varsa giriş yapabilir veya sosyal giriş kullanabilirsin.';
  const raw =
    error instanceof Error ? error.message : 'Bilinmeyen bir hata oluştu.';
  const lower = raw.toLowerCase();
  const match = AUTH_MESSAGE_BY_NEEDLE.find((item) =>
    lower.includes(item.needle),
  );
  return match?.message ?? 'İşlem tamamlanamadı. Lütfen tekrar dene.';
};

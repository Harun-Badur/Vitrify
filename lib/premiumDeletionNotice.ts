export function buildPremiumDeletionNotice(
  state: 'active' | 'inactive' | 'unknown' | 'pending',
): string {
  const specific =
    state === 'pending'
      ? 'Başlatılmış mağaza işleminin sonucu belirsiz; mağazada daha sonra tamamlanabilir. Yeniden satın almadan mağazayı veya desteği kontrol edin.'
      : state === 'unknown'
        ? 'Abonelik durumunuz şu anda doğrulanamıyor.'
        : state === 'active'
          ? 'Premium erişiminiz aktif görünüyor; mağaza yönetimi ayrıdır.'
          : 'Aktif Premium erişim doğrulanmadı; bu, mağazada bekleyen işlem olmadığı anlamına gelmez.';
  return `Hesabın ve uygulamanın yönettiği veriler doğrulanarak silinecek. Bu işlem geri alınamaz.\n\nHesabınızı silmek App Store/Google Play aboneliğinizi iptal etmez. Mağazada iptal etmediyseniz ödemeler devam edebilir.\n\n${specific}\n\nSağlayıcı ve yedek saklama koşulları gizlilik politikasında açıklanır.`;
}
export function subscriptionManagementUrl(platform: string): string | null {
  return platform === 'ios'
    ? 'https://apps.apple.com/account/subscriptions'
    : platform === 'android'
      ? 'https://play.google.com/store/account/subscriptions'
      : null;
}

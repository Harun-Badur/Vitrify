export const INVITE_SHARE_HEADLINE =
  "Vitrify'da kıyafetleri üzerinde dene! 🎽";

export const buildInviteShareMessage = (storeUrl: string): string =>
  `${INVITE_SHARE_HEADLINE}\n${storeUrl}`;

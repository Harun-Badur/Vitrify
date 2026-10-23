import { logger } from './logger';
import { captureOwnerPublication, trackOwnerWork } from './accountDeviceWork';
import { readPrivacyLifecycle, recordPrivacyChoice } from '../services/privacyLifecycleService';

export const VTON_CONSENT_TEXT_VERSION = 'vton-processing-2026-10-20';

// Reuse the existing per-account record already covered by device deletion.
// The legacy device-wide grant does not identify an accepting user.
export const hasVtonConsent = async (userId: string): Promise<boolean> => {
  if (!userId.trim()) return false;
  const current = captureOwnerPublication(userId);
  try {
    const state = await readPrivacyLifecycle(userId);
    return current() && state.consent.vton?.choice === 'granted'
      && state.consent.vton.textVersion === VTON_CONSENT_TEXT_VERSION;
  } catch {
    logger.warn('Rıza durumu okunamadı; rıza ekranı gösterilecek.');
    return false;
  }
};

export const grantVtonConsent = async (userId: string): Promise<void> => {
  const current = captureOwnerPublication(userId);
  if (!userId.trim() || !current()) throw new Error('Rıza için geçerli hesap gerekli.');
  await trackOwnerWork(userId, recordPrivacyChoice(userId, 'vton', 'granted', VTON_CONSENT_TEXT_VERSION));
  if (!current()) throw new Error('Rıza kaydedilirken oturum değişti.');
};

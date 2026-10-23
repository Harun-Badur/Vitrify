import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { logger } from '../lib/logger';
import { getRequiredSupabaseClient } from '../lib/supabase';
import { colors } from '../lib/theme';

const ANDROID_CHANNEL_ID = 'price-alerts';
// Retain the existing routing ID for other push senders; the V1 channel is generic.
const ANDROID_CHANNEL_NAME = 'Vitrify bildirimleri';

type NotificationsModule = typeof import('expo-notifications');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getExpoProjectId = (): string | undefined => {
  const easProjectId = Constants.easConfig?.projectId;
  if (typeof easProjectId === 'string' && easProjectId.length > 0) {
    return easProjectId;
  }

  const extraUnknown: unknown = Constants.expoConfig?.extra;
  if (!isRecord(extraUnknown) || !isRecord(extraUnknown.eas)) {
    return undefined;
  }
  const extraProjectId = extraUnknown.eas.projectId;
  if (typeof extraProjectId === 'string' && extraProjectId.length > 0) {
    return extraProjectId;
  }
  return undefined;
};

const loadNotifications = async (): Promise<NotificationsModule> =>
  import('expo-notifications');

const requestNotificationPermission = async (
  Notifications: NotificationsModule,
): Promise<boolean> => {
  if (!Device.isDevice) {
    logger.info(
      'Push bildirimleri yalnızca fiziksel cihazda çalışır (emülatör atlandı).',
    );
    return false;
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }

  if (status !== 'granted') {
    logger.info('Bildirim izni verilmedi.');
    return false;
  }

  return true;
};

const ensureAndroidChannel = async (
  Notifications: NotificationsModule,
): Promise<void> => {
  if (Platform.OS !== 'android') {
    return;
  }

  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: ANDROID_CHANNEL_NAME,
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: colors.accent,
  });
};

const upsertPushToken = async (
  userId: string,
  expoPushToken: string,
): Promise<void> => {
  const client = getRequiredSupabaseClient();
  const deviceName = Device.deviceName ?? Device.modelName ?? null;
  const { error } = await client.from('push_tokens').upsert(
    {
      user_id: userId,
      expo_push_token: expoPushToken,
      device_name: deviceName,
    },
    { onConflict: 'user_id,expo_push_token' },
  );

  if (error) {
    throw new Error(`Push token kaydedilemedi: ${error.message}`);
  }
};

export const registerForPushNotifications = async (
  userId: string,
): Promise<void> => {
  if (Constants.appOwnership === 'expo') {
    return;
  }

  try {
    const Notifications = await loadNotifications();
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    const permitted = await requestNotificationPermission(Notifications);
    if (!permitted) {
      return;
    }

    await ensureAndroidChannel(Notifications);

    const projectId = getExpoProjectId();
    const tokenResult = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    const expoPushToken = tokenResult.data.trim();
    if (expoPushToken.length === 0) {
      throw new Error('Expo push token alınamadı.');
    }

    await upsertPushToken(userId, expoPushToken);
    logger.info('Push token kaydedildi');
  } catch (error: unknown) {
    // Push kaydı uygulamanın çalışması için zorunlu değil; LogBox'ta kırmızı
    // görünmemesi ve kullanıcıyı korkutmaması için info seviyesinde kalıyor.
    logger.info('Push kaydı atlandı', { error });
  }
};

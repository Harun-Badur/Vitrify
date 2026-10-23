import { Platform, Linking } from 'react-native';
import Constants from 'expo-constants';
import type Purchases from 'react-native-purchases';
import type { PurchasesPackage } from 'react-native-purchases';
import { getSupabaseClient } from '../lib/supabase';
import {
  createPremiumA1Lifecycle,
  dispatchPremiumUnderGuard,
} from './premiumA1Lifecycle';
import {
  createPremiumClient,
  parseVerifiedMembership,
  type PremiumPackage,
} from './premiumClient';

const https = (value: string | undefined) => {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
};
export const premiumLegalLinks = {
  terms: https(process.env.EXPO_PUBLIC_PREMIUM_TERMS_URL),
  support: https(process.env.EXPO_PUBLIC_PREMIUM_SUPPORT_URL),
};
const key =
  Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
    : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
const supported = () =>
  (Platform.OS === 'ios' || Platform.OS === 'android') &&
  Constants.appOwnership !== 'expo' &&
  Constants.executionEnvironment !== 'storeClient';
const configured = () =>
  supported() &&
  process.env.EXPO_PUBLIC_PREMIUM_ENABLED === 'true' &&
  Boolean(
    key &&
    (Platform.OS === 'ios' ? key.startsWith('appl_') : key.startsWith('goog_')),
  ) &&
  Boolean(premiumLegalLinks.terms && premiumLegalLinks.support);
let sdk: typeof Purchases | null = null;
let identity: string | null = null;
let sessionOwner: string | null = null;
const nativePackages = new Map<string, PurchasesPackage>();
async function getSdk() {
  if (!configured()) throw new Error('PURCHASES_NOT_CONFIGURED');
  // Lazy require also keeps Expo Go/old development clients from loading a missing native module.
  if (!sdk) {
    sdk = (
      require('react-native-purchases') as typeof import('react-native-purchases')
    ).default;
    sdk.setLogHandler(() => undefined);
  }
  return sdk;
}
async function assertIdentity() {
  if (!identity || !sdk || (await sdk.getAppUserID()) !== identity)
    throw new Error('PURCHASES_OWNER_MISMATCH');
  return sdk;
}
async function endpoint(owner: string, suffix = ''): Promise<unknown> {
  const client = getSupabaseClient();
  if (!client) throw new Error('BACKEND_NOT_CONFIGURED');
  const { data, error } = await client.auth.getSession();
  if (error || data.session?.user.id !== owner)
    throw new Error('SESSION_CHANGED');
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
  if (!base || !/^https:\/\/[a-z]{20}\.supabase\.co$/.test(base))
    throw new Error('BACKEND_NOT_CONFIGURED');
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(
      `${base}/functions/v1/premium-membership${suffix}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
        signal: controller.signal,
      },
    );
    if (!response.ok) throw new Error('MEMBERSHIP_UNVERIFIED');
    const result: unknown = await response.json();
    const latest = await client.auth.getSession();
    if (latest.error || latest.data.session?.user.id !== owner)
      throw new Error('SESSION_CHANGED');
    return result;
  } finally {
    clearTimeout(timeout);
  }
}
async function admitPremium(owner: string): Promise<void> {
  const result = (await endpoint(owner, '/admit')) as { admitted?: boolean };
  if (result.admitted !== true) throw new Error('PREMIUM_ADMISSION_UNVERIFIED');
}
export const premiumClient = createPremiumClient(
  {
    configured,
    identity: async (owner) => {
      const data = (await endpoint(owner, '/identity')) as {
        appUserId?: unknown;
        sdkAllowed?: boolean;
      };
      if (
        typeof data.appUserId !== 'string' ||
        !data.appUserId ||
        data.sdkAllowed !== true
      )
        throw new Error('IDENTITY_UNVERIFIED');
      sessionOwner = owner;
      return data.appUserId;
    },
    connect: async (owner) => {
      const subject = sessionOwner;
      if (!subject) throw new Error('SESSION_CHANGED');
      const purchases = await getSdk();
      nativePackages.clear();
      identity = null;
      if (await purchases.isConfigured()) {
        if ((await purchases.getAppUserID()) !== owner)
          await dispatchPremiumUnderGuard(
            subject,
            () => admitPremium(subject),
            async () => {
              await purchases.logIn(owner);
            },
          );
      } else
        await dispatchPremiumUnderGuard(
          subject,
          () => admitPremium(subject),
          async () => {
            purchases.configure({ apiKey: key!, appUserID: owner });
          },
        );
      await dispatchPremiumUnderGuard(
        subject,
        () => admitPremium(subject),
        () => purchases.getCustomerInfo(),
      );
      if ((await purchases.getAppUserID()) !== owner)
        throw new Error('PURCHASES_OWNER_MISMATCH');
      identity = owner;
    },
    disconnect: async () => {
      sessionOwner = null;
      identity = null;
      nativePackages.clear();
      if (sdk && (await sdk.isConfigured()) && !(await sdk.isAnonymous()))
        await sdk.logOut();
    },
    verify: async (owner) => parseVerifiedMembership(await endpoint(owner)),
    packages: async () => {
      const purchases = await assertIdentity();
      const offering = (await purchases.getOfferings()).current;
      nativePackages.clear();
      const options: PremiumPackage[] = [];
      for (const pack of offering?.availablePackages ?? []) {
        const period =
          pack.packageType === 'MONTHLY'
            ? 'monthly'
            : pack.packageType === 'ANNUAL'
              ? 'annual'
              : null;
        // V1 offers no trial. Block introductory/discounted default offers rather than mislabel them.
        if (
          !period ||
          pack.product.introPrice ||
          pack.product.defaultOption?.freePhase ||
          pack.product.defaultOption?.introPhase ||
          !pack.product.priceString ||
          !['P1M', 'P1Y'].includes(pack.product.subscriptionPeriod ?? '')
        )
          continue;
        if (
          (period === 'monthly' && pack.product.subscriptionPeriod !== 'P1M') ||
          (period === 'annual' && pack.product.subscriptionPeriod !== 'P1Y')
        )
          continue;
        nativePackages.set(pack.identifier, pack);
        options.push({
          id: pack.identifier,
          productId: pack.product.identifier,
          store: Platform.OS === 'ios' ? 'app_store' : 'play_store',
          period,
          price: pack.product.priceString,
        });
      }
      return options;
    },
    purchase: async (id) => {
      const purchases = await assertIdentity(),
        pack = nativePackages.get(id);
      if (!pack) throw new Error('PACKAGE_UNAVAILABLE');
      const subject = sessionOwner;
      if (!subject) throw new Error('SESSION_CHANGED');
      await dispatchPremiumUnderGuard(
        subject,
        async () => {
          await admitPremium(subject);
          if (
            (await purchases.getCustomerInfo()).originalAppUserId !== identity
          )
            throw new Error('PURCHASES_OWNER_MISMATCH');
        },
        async () => {
          await purchases.purchasePackage(pack);
        },
      );
    },
    restore: async () => {
      const purchases = await assertIdentity();
      const subject = sessionOwner;
      if (!subject) throw new Error('SESSION_CHANGED');
      await dispatchPremiumUnderGuard(
        subject,
        async () => {
          await admitPremium(subject);
          if (
            (await purchases.getCustomerInfo()).originalAppUserId !== identity
          )
            throw new Error('PURCHASES_OWNER_MISMATCH');
        },
        async () => {
          await purchases.restorePurchases();
        },
      );
    },
    management: async () => {
      const purchases = await assertIdentity();
      const url = (await purchases.getCustomerInfo()).managementURL;
      if (!url) return null;
      const parsed = new URL(url);
      if (
        parsed.protocol !== 'https:' ||
        !['apps.apple.com', 'play.google.com'].includes(parsed.hostname) ||
        parsed.username ||
        parsed.password
      )
        throw new Error('MANAGEMENT_URL_INVALID');
      return parsed.href;
    },
    open: async (url) => {
      await Linking.openURL(url);
    },
  },
  createPremiumA1Lifecycle(),
);

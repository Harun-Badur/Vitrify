import { createElement } from 'react';
import { Linking, Modal, Platform, Text } from 'react-native';
import PrivacyCenter from '../components/PrivacyCenter';
import { PRIVACY_URL, ACCOUNT_DELETION_URL } from '../lib/privacy';
import { readFileSync } from 'node:fs';
jest.mock('../components/PressableScale', () => 'PressableScale');
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
}));
jest.mock('lucide-react-native', () => ({
  ArrowLeft: 'Icon',
  ShieldCheck: 'Icon',
  ChevronRight: 'Icon',
  Database: 'Icon',
  Image: 'Icon',
  SlidersHorizontal: 'Icon',
  FileText: 'Icon',
  Trash2: 'Icon',
  ExternalLink: 'Icon',
  Mail: 'Icon',
}));
const { create, act } = jest.requireActual('react-test-renderer');
const props = () => ({
  visible: true,
  onClose: jest.fn(),
  onDeleteAccount: jest.fn(),
  onOpenPreferences: jest.fn(),
  disabled: false,
});
const text = (view: any) =>
  view.root
    .findAllByType(Text)
    .map((node: any) => node.props.children)
    .join(' ');
afterEach(() => jest.restoreAllMocks());
beforeEach(() => jest.replaceProperty(Platform, 'OS', 'android'));
test('opens five working sections and full bilingual policy in-app; hardware back returns to the center', async () => {
  const callbacks = props();
  let view: any;
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  await act(() => {
    view = create(createElement(PrivacyCenter, callbacks));
  });
  for (const title of [
    'Verilerim ve Gizliliğim',
    'Fotoğraflar ve AI Deneme',
    'İzinlerim ve Tercihlerim',
    'Gizlilik Politikası',
    'Hesap ve Veri Silme',
  ])
    expect(text(view)).toContain(title);
  await act(() => {
    view.root
      .findByProps({ accessibilityLabel: 'Gizlilik Politikası' })
      .props.onPress();
  });
  expect(open).not.toHaveBeenCalled();
  expect(text(view)).toContain('FASHN');
  expect(text(view)).toContain('Privacy Policy (English summary)');
  await act(() => {
    view.root.findByType(Modal).props.onRequestClose();
  });
  expect(callbacks.onClose).not.toHaveBeenCalled();
  expect(text(view)).toContain('Verilerim ve Gizliliğim');
  await act(() => {
    view.root.findByProps({ accessibilityLabel: 'Geri' }).props.onPress();
  });
  expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  await act(() => view.unmount());
});
test('delegates deletion and preferences to the existing Profile callbacks without creating another flow', async () => {
  const callbacks = props();
  let view: any;
  await act(() => {
    view = create(createElement(PrivacyCenter, callbacks));
  });
  await act(() => {
    view.root
      .findByProps({ accessibilityLabel: 'Hesap ve Veri Silme' })
      .props.onPress();
  });
  expect(callbacks.onDeleteAccount).not.toHaveBeenCalled();
  await act(() => {
    view.root
      .findByProps({ accessibilityLabel: 'Hesap silme seçeneklerini aç' })
      .props.onPress();
  });
  expect(callbacks.onDeleteAccount).toHaveBeenCalledTimes(1);
  await act(() => {
    view.root
      .findByProps({ accessibilityLabel: 'İzinlerim ve Tercihlerim' })
      .props.onPress();
  });
  await act(() => {
    view.root
      .findByProps({ accessibilityLabel: 'Tercihlerimi düzenle' })
      .props.onPress();
  });
  expect(callbacks.onOpenPreferences).toHaveBeenCalledTimes(1);
  await act(() => view.unmount());
});
test('keeps canonical and external deletion URLs and reports external-link failure', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  let view: any;
  await act(() => {
    view = create(createElement(PrivacyCenter, props()));
  });
  await act(() => {
    view.root
      .findByProps({ accessibilityLabel: 'Hesap ve Veri Silme' })
      .props.onPress();
  });
  await act(async () => {
    await view.root
      .findByProps({ accessibilityLabel: 'Uygulama dışından silme talebi' })
      .props.onPress();
  });
  expect(open).toHaveBeenCalledWith(ACCOUNT_DELETION_URL);
  await act(() => {
    view.root
      .findByProps({ accessibilityLabel: 'Gizlilik Politikası' })
      .props.onPress();
  });
  open.mockRejectedValueOnce(new Error('offline'));
  await act(async () => {
    await view.root
      .findByProps({ accessibilityLabel: 'Yayımlanmış politikayı aç' })
      .props.onPress();
  });
  expect(open).toHaveBeenLastCalledWith(PRIVACY_URL);
  expect(text(view)).toContain('Bağlantı açılamadı');
  await act(() => view.unmount());
});
test('iOS defers the existing deletion alert until the screen is dismissed', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const callbacks = props();
  let view: any;
  await act(() => {
    view = create(createElement(PrivacyCenter, callbacks));
  });
  await act(() => {
    view.root
      .findByProps({ accessibilityLabel: 'Hesap ve Veri Silme' })
      .props.onPress();
  });
  await act(() => {
    view.root
      .findByProps({ accessibilityLabel: 'Hesap silme seçeneklerini aç' })
      .props.onPress();
  });
  expect(callbacks.onClose).toHaveBeenCalledTimes(1);
  expect(callbacks.onDeleteAccount).not.toHaveBeenCalled();
  await act(() => {
    view.root.findByType(Modal).props.onDismiss();
  });
  expect(callbacks.onDeleteAccount).toHaveBeenCalledTimes(1);
  await act(() => {
    view.root.findByType(Modal).props.onDismiss();
  });
  expect(callbacks.onDeleteAccount).toHaveBeenCalledTimes(1);
  await act(() => view.unmount());
});
test('device permissions open real OS settings and disabled deletion does not present an enabled control', async () => {
  const settings = jest
    .spyOn(Linking, 'openSettings')
    .mockResolvedValue(undefined);
  let view: any;
  await act(() => {
    view = create(createElement(PrivacyCenter, props()));
  });
  await act(() => {
    view.root
      .findByProps({ accessibilityLabel: 'İzinlerim ve Tercihlerim' })
      .props.onPress();
  });
  await act(async () => {
    await view.root
      .findByProps({ accessibilityLabel: 'Cihaz izinlerini aç' })
      .props.onPress();
  });
  expect(settings).toHaveBeenCalledTimes(1);
  await act(() => {
    view.update(createElement(PrivacyCenter, { ...props(), disabled: true }));
  });
  await act(() => {
    view.root
      .findByProps({ accessibilityLabel: 'Hesap ve Veri Silme' })
      .props.onPress();
  });
  expect(
    view.root.findByProps({
      accessibilityLabel: 'Hesap silme seçeneklerini aç',
    }).props.disabled,
  ).toBe(true);
  await act(() => view.unmount());
});
test('Profile opens the internal center and reuses its existing deletion handler', () => {
  const profile = readFileSync('app/(tabs)/profile.tsx', 'utf8');
  expect(profile).toContain(
    'const handleOpenPrivacy = (): void => { setPrivacyOpen(true); }',
  );
  expect(profile).toContain('onDeleteAccount={handleDeleteAccount}');
  const center = readFileSync('components/PrivacyCenter.tsx', 'utf8');
  for (const forbidden of [
    'completeAccountDeletion',
    'createAccountDeletionRuntime',
    'recordPrivacyChoice',
    'grantVtonConsent',
  ])
    expect(center).not.toContain(forbidden);
});

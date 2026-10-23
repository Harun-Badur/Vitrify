import { createElement } from 'react';
import AuthScreen from '../app/auth';
import { AccessibilityInfo, Platform, Text } from 'react-native';
const renderer = jest.requireActual('react-test-renderer') as {
  create: (element: ReturnType<typeof createElement>) => {
    root: {
      findByProps: (props: object) => {
        props: {
          onPress: () => void;
          onChangeText: (v: string) => void;
          disabled: boolean;
        };
      };
      findAllByProps: (props: object) => unknown[];
      findAllByType: (
        type: typeof Text,
      ) => Array<{ props: { accessibilityRole?: string; children?: unknown } }>;
    };
    unmount: () => void;
  };
  act: (fn: () => void | Promise<void>) => Promise<void>;
};
const mockSignIn = jest.fn(async () => {}),
  mockSignUp = jest.fn(async () => ({ needsEmailConfirmation: true })),
  mockSocial = jest.fn(async () => 'cancelled');
jest.mock('../hooks/useAuthContext', () => ({
  useAuthContext: () => ({
    signIn: mockSignIn,
    signUp: mockSignUp,
    signInSocial: mockSocial,
  }),
}));
jest.mock('../services/socialAuthService', () => ({
  isAppleSignInAvailable: async () => true,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 10 }),
}));
jest.mock('lucide-react-native', () => ({
  ArrowUpRight: 'Arrow',
  Eye: 'Eye',
  EyeOff: 'EyeOff',
  LockKeyhole: 'Lock',
  Mail: 'Mail',
}));
jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationButton: 'AppleButton',
  AppleAuthenticationButtonType: { CONTINUE: 2 },
  AppleAuthenticationButtonStyle: { BLACK: 0 },
}));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'Gradient' }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { appOwnership: 'expo' },
}));
jest.mock('../components/PressableScale', () => 'PressableScale');
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  FadeInDown: {
    duration: () => undefined,
    delay: () => ({ duration: () => undefined }),
  },
}));
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());
test('email login, validation and social cancellation remain explicit in the real screen', async () => {
  let screen!: ReturnType<typeof renderer.create>;
  await renderer.act(async () => {
    screen = renderer.create(createElement(AuthScreen));
  });
  await renderer.act(async () => {
    screen.root
      .findByProps({ accessibilityLabel: 'Giriş Yap' })
      .props.onPress();
  });
  expect(mockSignIn).not.toHaveBeenCalled();
  await renderer.act(async () => {
    screen.root
      .findByProps({ accessibilityLabel: 'E-posta' })
      .props.onChangeText('test@example.com');
    screen.root
      .findByProps({ accessibilityLabel: 'Şifre' })
      .props.onChangeText('secret-test');
  });
  await renderer.act(async () => {
    screen.root
      .findByProps({ accessibilityLabel: 'Giriş Yap' })
      .props.onPress();
  });
  expect(mockSignIn).toHaveBeenCalledTimes(1);
  await renderer.act(async () => {
    screen.root
      .findByProps({ accessibilityLabel: 'Google ile Devam Et' })
      .props.onPress();
  });
  expect(mockSocial).toHaveBeenCalledWith('google');
  expect(
    screen.root
      .findAllByType(Text)
      .filter((node) => node.props.accessibilityRole === 'alert')
      .map((node) => node.props.children),
  ).toEqual(['Giriş iptal edildi. Hazır olduğunda tekrar devam edebilirsin.']);
  await renderer.act(async () => screen.unmount());
});
test('registration confirmation prevents duplicate email sending', async () => {
  let screen!: ReturnType<typeof renderer.create>;
  await renderer.act(async () => {
    screen = renderer.create(createElement(AuthScreen));
  });
  await renderer.act(async () => {
    screen.root.findByProps({ accessibilityLabel: 'Kayıt ol' }).props.onPress();
  });
  await renderer.act(async () => {
    screen.root
      .findByProps({ accessibilityLabel: 'E-posta' })
      .props.onChangeText('test@example.com');
    screen.root
      .findByProps({ accessibilityLabel: 'Şifre' })
      .props.onChangeText('secret-test');
  });
  await renderer.act(async () => {
    screen.root
      .findByProps({ accessibilityLabel: 'Hesabını Oluştur' })
      .props.onPress();
  });
  expect(mockSignUp).toHaveBeenCalledTimes(1);
  expect(
    screen.root.findByProps({ accessibilityLabel: 'E-postanı Kontrol Et' })
      .props.disabled,
  ).toBe(true);
  await renderer.act(async () => screen.unmount());
});
test('Apple control is visible only on supported iOS', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  let screen!: ReturnType<typeof renderer.create>;
  await renderer.act(async () => {
    screen = renderer.create(createElement(AuthScreen));
  });
  expect(
    screen.root.findAllByProps({ accessibilityLabel: 'Apple ile Devam Et' }),
  ).toHaveLength(0);
  await renderer.act(async () => screen.unmount());
  jest.replaceProperty(Platform, 'OS', 'ios');
  await renderer.act(async () => {
    screen = renderer.create(createElement(AuthScreen));
  });
  expect(
    screen.root.findAllByProps({ accessibilityLabel: 'Apple ile Devam Et' })
      .length,
  ).toBeGreaterThan(0);
  await renderer.act(async () => screen.unmount());
});
test('email quota blocks repeated signup temporarily without blocking existing-account login', async () => {
  let screen!: ReturnType<typeof renderer.create>;
  await renderer.act(async () => {
    screen = renderer.create(createElement(AuthScreen));
  });
  jest.useFakeTimers();
  try {
    mockSignUp.mockRejectedValueOnce(
      new Error('Doğrulama e-postası gönderilemiyor.', {
        cause: { code: 'over_email_send_rate_limit' },
      }),
    );
    await renderer.act(async () => {
      screen.root
        .findByProps({ accessibilityLabel: 'Kayıt ol' })
        .props.onPress();
    });
    await renderer.act(async () => {
      screen.root
        .findByProps({ accessibilityLabel: 'E-posta' })
        .props.onChangeText('test@example.com');
      screen.root
        .findByProps({ accessibilityLabel: 'Şifre' })
        .props.onChangeText('secret-test');
    });
    await renderer.act(async () => {
      screen.root
        .findByProps({ accessibilityLabel: 'Hesabını Oluştur' })
        .props.onPress();
    });
    const retry = screen.root.findByProps({
      accessibilityLabel: 'Tekrar dene · 60 sn',
    });
    expect(retry.props.disabled).toBe(true);
    await renderer.act(async () => retry.props.onPress());
    expect(mockSignUp).toHaveBeenCalledTimes(1);
    await renderer.act(async () => {
      screen.root
        .findByProps({ accessibilityLabel: 'Giriş yap' })
        .props.onPress();
    });
    expect(
      screen.root.findByProps({ accessibilityLabel: 'Giriş Yap' }).props
        .disabled,
    ).toBe(false);
    await renderer.act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
  } finally {
    await renderer.act(async () => screen.unmount());
    jest.useRealTimers();
  }
});


test('shows the auth form without promotional content', async () => {
  let screen!: ReturnType<typeof renderer.create>;
  await renderer.act(async () => {
    screen = renderer.create(createElement(AuthScreen));
  });
  try {
    expect(screen.root.findAllByProps({ accessibilityLabel: 'Vitrify logosu' })).toHaveLength(0);
    const text = screen.root.findAllByType(Text).map((node) => node.props.children);
    expect(text).not.toContain('SENİN STİLİN. SENİN HİKÂYEN.');
    expect(text).not.toContain('STİLİNİN YENİ BÖLÜMÜ');
    expect(text).not.toContain('AZ PARÇA. ÇOK SEN.');
    expect(text).toContain('Tekrar hoş geldin');
    expect(screen.root.findByProps({ accessibilityLabel: 'E-posta' })).toBeDefined();
    expect(screen.root.findByProps({ accessibilityLabel: 'Şifre' })).toBeDefined();
  } finally {
    await renderer.act(async () => screen.unmount());
  }
});

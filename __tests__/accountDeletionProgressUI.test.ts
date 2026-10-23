import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import RootLayout from '../app/_layout';
import type { AccountDeletionProgress } from '../services/accountService';

let mockUser: { id: string } | null = { id: 'A' };
let mockProgress: AccountDeletionProgress | null = null;
let mockNotify: () => void = () => {};
const mockSignOut = jest.fn().mockResolvedValue(undefined);
const mockState = { hydrateSession: jest.fn(), resetSession: jest.fn() };
jest.mock('../hooks/useAuthContext', () => ({ AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuthContext: () => ({ user: mockUser, loading: false, signOut: mockSignOut }) }));
jest.mock('../store/useAppStore', () => ({ useAppStore: (select: (state: typeof mockState) => unknown) => select(mockState) }));
jest.mock('../services/accountService', () => ({ resumePendingAccountDeletions: jest.fn().mockResolvedValue(undefined),
  subscribeAccountDeletionProgress: (listener: () => void) => { mockNotify = listener; return () => {}; },
  getAccountDeletionProgress: (owner: string | null) => owner === null || owner === 'A' ? mockProgress : null,
  dismissAccountDeletionProgress: jest.fn() }));
jest.mock('../services/accountDeletionRuntime', () => ({ createAccountDeletionRuntime: jest.fn() }));
jest.mock('../lib/onboarding', () => ({ hasCompletedOnboarding: async () => true, markOnboardingComplete: async () => {} }));
jest.mock('../lib/analytics', () => ({ initAnalytics: jest.fn(), track: jest.fn() }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { appOwnership: 'expo' } }));
jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const Stack = (props: { children: ReactNode }) => React.createElement('Stack', props);
  return { usePathname: () => '/profile', Stack: Object.assign(Stack, { Screen: 'Screen', Protected: 'Protected' }) };
});
jest.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
jest.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: 'GestureHandlerRootView' }));
jest.mock('../components/AppErrorBoundary', () => 'AppErrorBoundary');
jest.mock('../components/OnboardingScreen', () => 'OnboardingScreen');

describe('account deletion progress navigation guard', () => {
  let tree: ReactTestRenderer;
  beforeEach(() => { jest.clearAllMocks(); mockUser = { id: 'A' }; mockProgress = null; });
  afterEach(async () => { await act(async () => tree.unmount()); });
  it('shows waiting instead of Auth navigation and closes session only after completion', async () => {
    mockProgress = { phase: 'waiting', attempt: 1, message: 'Güvenli bekleme sürüyor.' };
    await act(async () => { tree = create(createElement(RootLayout)); });
    expect(tree.root.findByProps({ accessibilityLabel: 'Hesap silme durumu' })).toBeDefined();
    expect(tree.root.findAllByProps({ name: 'auth' })).toHaveLength(0);
    expect(mockSignOut).not.toHaveBeenCalled();
    await act(async () => { mockProgress = { phase: 'completed', attempt: 2, message: 'Doğrulandı' }; mockNotify(); });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
  it('keeps an unresolved post-Auth request visible instead of redirecting to login', async () => {
    mockUser = null; mockProgress = { phase: 'stopped', attempt: 4, message: 'Kurtarma kaydı korundu.' };
    await act(async () => { tree = create(createElement(RootLayout)); });
    expect(tree.root.findByProps({ accessibilityLabel: 'Hesap silme durumu' })).toBeDefined();
    expect(tree.root.findAllByProps({ name: 'auth' })).toHaveLength(0);
    expect(mockSignOut).not.toHaveBeenCalled();
  });
  it('does not sign out account B when account A completes', async () => {
    mockUser = { id: 'B' }; mockProgress = { phase: 'completed', attempt: 2, message: 'Doğrulandı' };
    await act(async () => { tree = create(createElement(RootLayout)); });
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(tree.root.findAllByProps({ accessibilityLabel: 'Hesap silme durumu' })).toHaveLength(0);
  });
});

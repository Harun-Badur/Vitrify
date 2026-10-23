import { AppState, type AppStateStatus } from 'react-native';
import { createElement, type ReactElement } from 'react';
import { useWardrobeCutoutResume } from '../hooks/useWardrobeCutoutResume';
const mockResume = jest.fn();
const mockRemove = jest.fn();
const mockRefresh = jest.fn(async () => {});
const mockState = { wardrobeStatus: 'ready', wardrobeSync: { state: 'synced' }, refreshWardrobe: mockRefresh };
let mockListener: (state: AppStateStatus) => void;
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) =>
    jest
      .requireActual<typeof import('react')>('react')
      .useEffect(callback, [callback]),
}));
jest.mock('../store/useAppStore', () => ({
  useAppStore: Object.assign((
    selector: (state: { resumeWardrobeCutouts: () => void }) => unknown,
  ) => selector({ resumeWardrobeCutouts: mockResume }), { getState: () => mockState }),
}));
const renderer = jest.requireActual('react-test-renderer') as {
  create: (element: ReactElement) => { unmount: () => void };
  act: (callback: () => void) => Promise<void>;
};
function Screen() {
  useWardrobeCutoutResume();
  return null;
}
test('foreground resumes eligible jobs without polling; background and events after unmount do not restart them', async () => {
  mockResume.mockClear();
  mockRemove.mockClear();
  const subscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, listener) => {
      mockListener = listener;
      return { remove: mockRemove };
    });
  let tree!: ReturnType<typeof renderer.create>;
  await renderer.act(() => {
    tree = renderer.create(createElement(Screen));
  });
  expect(mockResume).toHaveBeenCalledTimes(1);
  await renderer.act(() => mockListener('background'));
  expect(mockResume).toHaveBeenCalledTimes(1);
  await renderer.act(() => mockListener('active'));
  expect(mockResume).toHaveBeenCalledTimes(2);
  mockState.wardrobeSync.state = 'pending';
  await renderer.act(() => { mockListener('background'); mockListener('active'); mockListener('active'); });
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  expect(mockResume).toHaveBeenCalledTimes(2);
  await renderer.act(() => tree.unmount());
  mockListener('active');
  expect(mockRemove).toHaveBeenCalledTimes(1);
  expect(mockResume).toHaveBeenCalledTimes(2);
  subscription.mockRestore();
});

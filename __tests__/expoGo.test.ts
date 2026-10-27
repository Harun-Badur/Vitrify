import { isExpoGo } from '../lib/expoGo';

const mockConstants = { executionEnvironment: 'bare' as string };
jest.mock('expo-constants', () => ({
  __esModule: true,
  get default() { return mockConstants; },
  ExecutionEnvironment: { Bare: 'bare', Standalone: 'standalone', StoreClient: 'storeClient' },
}));

describe('isExpoGo', () => {
  it('is true only in the Expo Go store client', () => {
    mockConstants.executionEnvironment = 'storeClient';
    expect(isExpoGo()).toBe(true);
    mockConstants.executionEnvironment = 'standalone';
    expect(isExpoGo()).toBe(false);
    mockConstants.executionEnvironment = 'bare';
    expect(isExpoGo()).toBe(false);
  });
});

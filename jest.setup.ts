jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  wrap: (value: unknown) => value,
}));

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    setItem: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    getItem: jest.fn(async (key: string) => store.get(key) ?? null),
    getAllKeys: jest.fn(async () => [...store.keys()]),
    removeItem: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    clear: jest.fn(async () => {
      store.clear();
    }),
  };
});


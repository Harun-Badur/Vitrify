module.exports = {
  preset: 'jest-expo',
  // Deno's npm layout adds an outer node_modules/.deno/<package>/ layer.
  // Allow that container through, then apply Expo's allowlist at the inner layer.
  transformIgnorePatterns: require('jest-expo/jest-preset').transformIgnorePatterns.map(
    pattern => pattern.replace('(?!(.pnpm|', '(?!(.deno|.pnpm|'),
  ),
  testMatch: ['**/__tests__/**/*.test.ts'],
  modulePathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/node_modules/'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
};

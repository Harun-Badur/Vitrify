import appConfig from '../app.json';

test('the Sentry plugin targets the EU region of the organization', () => {
  const plugin = appConfig.expo.plugins.find(entry => Array.isArray(entry) && entry[0] === '@sentry/react-native/expo');
  expect(plugin?.[1]).toEqual({ url: 'https://de.sentry.io/' });
});

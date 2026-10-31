const path = require('path');
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

// Same as expo's default config, plus debug ids so uploaded source maps match release bundles.
/** @type {import('expo/metro-config').MetroConfig} */
const config = getSentryExpoConfig(__dirname);

const sourceExts = config.resolver.sourceExts ?? [];
if (!sourceExts.includes('mjs')) {
  sourceExts.push('mjs');
}
if (!sourceExts.includes('cjs')) {
  sourceExts.push('cjs');
}
config.resolver.sourceExts = sourceExts;

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'ws') {
    return { type: 'empty' };
  }

  if (moduleName === '@supabase/supabase-js') {
    return {
      filePath: path.resolve(
        __dirname,
        'node_modules/@supabase/supabase-js/dist/module/index.js',
      ),
      type: 'sourceFile',
    };
  }

  if (moduleName === '@supabase/realtime-js') {
    return {
      filePath: path.resolve(
        __dirname,
        'node_modules/@supabase/realtime-js/dist/module/index.js',
      ),
      type: 'sourceFile',
    };
  }

  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

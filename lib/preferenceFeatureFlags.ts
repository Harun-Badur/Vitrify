// Opt-in build flag only. No env/config value is changed by this implementation.
export const isPreferenceV2Enabled = (): boolean =>
  process.env.EXPO_PUBLIC_PREFERENCE_V2_ENABLED === 'true';

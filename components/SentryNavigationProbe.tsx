import { useEffect } from 'react';
import { useNavigationContainerRef } from 'expo-router';
import { isSentryEnabled, registerSentryNavigation } from '../lib/sentry';

function SentryNavigationRegistration() {
  const navigationRef = useNavigationContainerRef();
  useEffect(() => { registerSentryNavigation(navigationRef); }, [navigationRef]);
  return null;
}

/** Screen-transition tracing for Sentry. Renders nothing, and never touches the router, while Sentry is off. */
export default function SentryNavigationProbe() {
  return isSentryEnabled() ? <SentryNavigationRegistration /> : null;
}

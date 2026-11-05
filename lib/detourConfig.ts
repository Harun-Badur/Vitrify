/**
 * `complement_open` is accepted by ingest_events (no event_type allowlist) and ignored by
 * recompute_profile (not in event_weights), but this has not been verified on staging yet.
 * Keep it off until it is. Mutable only so tests can switch it.
 */
export const detourConfig = { complementOpenTracking: false };

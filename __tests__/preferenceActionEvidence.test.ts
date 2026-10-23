import { analyzePreferenceEvents } from '../src/intelligence/evidence/sharedEvidence';
import type { PreferenceEvidenceEvent } from '../types/sharedStyleEvidence';

// Proposed explicit action metadata, not inferred metadata for legacy events.
const event = (patch: Partial<PreferenceEvidenceEvent> = {}): PreferenceEvidenceEvent => ({
  eventId: 'event-1', userId: 'A', productId: 'p', eventType: 'like',
  actionId: 'action-1', actionOrigin: 'favorite', outcome: 'committed', ...patch,
});
const pair = (actionId = 'action-1', productId = 'p') => [
  event({ eventId: `${actionId}-like`, actionId, productId }),
  event({ eventId: `${actionId}-add`, actionId, productId, eventType: 'dolap_add' }),
];
const analyze = (events: readonly PreferenceEvidenceEvent[]) => analyzePreferenceEvents('A', events);

test('one committed favorite is one positive action and one distinct preference', () => {
  expect(analyze([event()])).toMatchObject({ positiveActionCount: 1, positiveProductIds: ['p'], ownedProductIds: [] });
});
test('explicitly related like + dolap_add is one preference, never wardrobe ownership', () => {
  expect(analyze(pair())).toMatchObject({ positiveActionCount: 1, positiveProductIds: ['p'], ownedProductIds: [] });
});
test('independent wardrobe add is separate ownership, not another positive preference', () => {
  const result = analyze([...pair(), event({ eventId: 'owned', actionId: 'owned-action', eventType: 'dolap_add', actionOrigin: 'wardrobe' })]);
  expect(result).toMatchObject({ positiveActionCount: 1, ownershipActionCount: 1, positiveProductIds: ['p'], ownedProductIds: ['p'] });
});
test('different actions on the same product remain distinct; repeat products are not independent samples', () => {
  expect(analyze([...pair('first'), ...pair('second')])).toMatchObject({ positiveActionCount: 2, positiveProductIds: ['p'] });
});
test('retrying identical events or the same action does not create duplicate evidence', () => {
  expect(analyze([...pair(), ...pair(), event({ eventId: 'retry' })])).toMatchObject({ positiveActionCount: 1, positiveProductIds: ['p'] });
});
test('unlinked legacy pair is not merged by product, session or time', () => {
  const result = analyze(pair().map(item => ({ ...item, actionId: null })));
  expect(result.positiveActionCount).toBe(0);
  expect(result.status).toBe('incomplete');
  expect(result.unresolvedEventIds).toHaveLength(2);
});
test('favorite-origin dolap_add alone cannot prove a committed preference or real ownership', () => {
  expect(analyze([event({ eventType: 'dolap_add' })])).toMatchObject({ positiveActionCount: 0, ownedProductIds: [], unresolvedEventIds: ['event-1'] });
});
test('unlike revokes only its explicit target, independently of event delivery order', () => {
  const unlike = event({ eventId: 'unlike', actionId: 'unlike-action', actionOrigin: 'favorite', eventType: 'unlike', revertsActionIds: ['first'] });
  const events = [...pair('first'), unlike, ...pair('second')];
  const result = analyze(events);
  expect(result).toMatchObject({ positiveActionCount: 1, positiveProductIds: ['p'] });
  expect(analyze([...events].reverse())).toEqual(result);
});
test('unlike without explicit targets never guesses which historic action to revoke', () => {
  const result = analyze([...pair(), event({ eventId: 'unlike', actionId: 'unlike', eventType: 'unlike' })]);
  expect(result.positiveActionCount).toBe(1);
  expect(result.status).toBe('incomplete');
  expect(result.unresolvedEventIds).toContain('unlike');
});
test('pass undo revokes the pass and keeps preference distinct from ownership', () => {
  const pass = event({ eventId: 'pass', actionId: 'pass-action', actionOrigin: 'pass', eventType: 'pass' });
  const undo = event({ eventId: 'undo', actionId: 'undo-action', actionOrigin: 'pass', eventType: 'undo_pass', revertsActionIds: ['pass-action'] });
  expect(analyze([...pair(), pass, undo])).toMatchObject({ positiveProductIds: ['p'], negativeProductIds: [], ownedProductIds: [] });
});
test('failed or unconfirmed actions provide no committed preference', () => {
  expect(analyze(pair().map(item => ({ ...item, outcome: 'failed' })))).toMatchObject({ positiveActionCount: 0, unresolvedEventIds: [] });
  expect(analyze(pair().map(item => ({ ...item, outcome: 'unknown' })))).toMatchObject({ positiveActionCount: 0, unresolvedEventIds: ['action-1-add', 'action-1-like'] });
});
test('account B events cannot cancel account A action even with matching action and product IDs', () => {
  const foreign = event({ userId: 'B', eventId: 'foreign', actionId: 'foreign', eventType: 'unlike', revertsActionIds: ['action-1'] });
  expect(analyze([...pair(), foreign])).toEqual(analyze(pair()));
});
test('contradictory action identities and event IDs are excluded rather than resolved by timing', () => {
  const conflict = event({ eventId: 'conflict', productId: 'other' });
  expect(analyze([...pair(), conflict]).positiveActionCount).toBe(0);
  expect(analyze([event(), event({ productId: 'other', actionId: 'other-action' })]).positiveActionCount).toBe(0);
});
test('unlike cannot revoke another product or ownership action', () => {
  const owned = event({ eventId: 'owned', actionId: 'owned', actionOrigin: 'wardrobe', eventType: 'dolap_add' });
  const invalid = event({ eventId: 'unlike', actionId: 'unlike', eventType: 'unlike', revertsActionIds: ['owned'] });
  expect(analyze([owned, invalid])).toMatchObject({ ownedProductIds: ['p'], unresolvedEventIds: ['unlike'] });
});
test('wardrobe removal needs explicit ownership targets and leaves favorite evidence intact', () => {
  const owned = event({ eventId: 'owned', actionId: 'owned', actionOrigin: 'wardrobe', eventType: 'dolap_add' });
  const remove = event({ eventId: 'remove', actionId: 'remove', actionOrigin: 'wardrobe', eventType: 'dolap_remove', revertsActionIds: ['owned'] });
  expect(analyze([...pair(), owned, remove])).toMatchObject({ positiveProductIds: ['p'], ownedProductIds: [] });
});
test('uncancelled opposite actions remain ambiguous without an authoritative order', () => {
  const pass = event({ eventId: 'pass', actionId: 'pass', actionOrigin: 'pass', eventType: 'pass' });
  expect(analyze([...pair(), pass])).toMatchObject({ positiveProductIds: [], negativeProductIds: [], ambiguousProductIds: ['p'] });
});
test('conflicting commit outcomes for an action are unresolved, not a successful preference', () => {
  const rows = pair();
  expect(analyze([rows[0], { ...rows[1], outcome: 'failed' }])).toMatchObject({ positiveActionCount: 0, unresolvedEventIds: ['action-1-like'] });
});
test('retained favorite removal explicitly revokes all active favorite actions, then re-like survives', () => {
  const unlike = event({ eventId: 'unlike', actionId: 'unlike', eventType: 'unlike', revertsActionIds: ['first', 'second'] });
  expect(analyze([...pair('first'), ...pair('second'), unlike])).toMatchObject({ positiveActionCount: 0, positiveProductIds: [] });
  expect(analyze([...pair('first'), ...pair('second'), unlike, ...pair('third')])).toMatchObject({ positiveActionCount: 1, positiveProductIds: ['p'] });
});
test('incomplete undo references are rejected atomically without partially revoking known targets', () => {
  const unlike = event({ eventId: 'unlike', actionId: 'unlike', eventType: 'unlike', revertsActionIds: ['action-1', 'missing'] });
  expect(analyze([...pair(), unlike])).toMatchObject({ positiveActionCount: 1, unresolvedEventIds: ['unlike'] });
});
test('input is immutable and missing owner excludes every private event', () => {
  const rows = pair(); const original = JSON.stringify(rows);
  analyze(rows); expect(JSON.stringify(rows)).toBe(original);
  expect(analyzePreferenceEvents(null, rows)).toMatchObject({ status: 'unavailable', positiveActionCount: 0, positiveProductIds: [], ownedProductIds: [] });
});

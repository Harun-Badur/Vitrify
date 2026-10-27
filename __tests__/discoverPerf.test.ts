import { createComboReadinessTracker } from '../lib/discoverPerf';
import { perfTraceEntries, resetPerfTrace, setPerfTraceOverrideForTests } from '../lib/perfTrace';

const labels = () => perfTraceEntries().map(entry => entry.label);

beforeEach(() => {
  resetPerfTrace();
  setPerfTraceOverrideForTests(true);
});
afterEach(() => {
  setPerfTraceOverrideForTests(null);
  jest.restoreAllMocks();
});

describe('combo readiness tracker', () => {
  it('counts whether the combo was ready when a card became visible', () => {
    const tracker = createComboReadinessTracker();
    tracker.cardShown(true);
    tracker.cardShown(false);
    tracker.cardShown(true);
    expect(labels()).toEqual(['combo_ready_before_swipe_yes', 'combo_ready_before_swipe_no', 'combo_ready_before_swipe_yes']);
  });

  it('measures from the swipe to the moment the next card has its combo', () => {
    const now = jest.spyOn(performance, 'now');
    const tracker = createComboReadinessTracker();
    now.mockReturnValueOnce(1000);
    tracker.swipe();
    tracker.cardShown(false);
    tracker.update(false);
    expect(labels()).toEqual(['combo_ready_before_swipe_no']);
    now.mockReturnValueOnce(1340);
    tracker.update(true);
    tracker.update(true);
    expect(perfTraceEntries().filter(entry => entry.label === 'swipe_to_next_ready')).toMatchObject([{ ms: 340 }]);
  });

  it('does not finish a swipe on the old card before the next card appears', () => {
    const now = jest.spyOn(performance, 'now');
    const tracker = createComboReadinessTracker();
    now.mockReturnValueOnce(10);
    tracker.swipe();
    tracker.update(true);
    expect(labels()).toEqual([]);
    now.mockReturnValueOnce(25);
    tracker.cardShown(true);
    tracker.update(true);
    expect(perfTraceEntries().filter(entry => entry.label === 'swipe_to_next_ready')).toMatchObject([{ ms: 15 }]);
  });

  it('records nothing and reads no clock while disabled', () => {
    setPerfTraceOverrideForTests(false);
    const now = jest.spyOn(performance, 'now');
    now.mockClear();
    const tracker = createComboReadinessTracker();
    tracker.swipe();
    tracker.cardShown(true);
    tracker.update(true);
    expect(now).not.toHaveBeenCalled();
    expect(perfTraceEntries()).toEqual([]);
  });
});

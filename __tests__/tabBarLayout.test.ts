import { getTabBarMetrics } from '../lib/tabBarLayout';

describe('tab bar safe content space', () => {
  it.each([0, 16, 24, 34, 48])(
    'keeps icon/label space above a %s bottom inset',
    (bottom) => {
      const metrics = getTabBarMetrics(bottom, 1);
      expect(metrics.paddingBottom).toBeGreaterThanOrEqual(bottom);
      expect(
        metrics.height - metrics.paddingBottom - metrics.paddingTop - 1,
      ).toBeGreaterThanOrEqual(60);
    },
  );

  it('grows with accessibility text without limiting font scaling', () => {
    expect(getTabBarMetrics(24, 2).height).toBeGreaterThan(
      getTabBarMetrics(24, 1).height,
    );
    expect(getTabBarMetrics(24, 3).height).toBeGreaterThan(
      getTabBarMetrics(24, 2).height,
    );
  });
});

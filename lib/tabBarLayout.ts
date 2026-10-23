import { layout, spacing } from './theme';

/** Content and system inset are separate: adding an inset must never eat labels. */
export function getTabBarMetrics(bottomInset: number, fontScale: number) {
  const paddingBottom = Math.max(bottomInset, spacing.sm);
  const paddingTop = spacing.xs;
  // Navigator's icon slot is 28px, with 10px internal button padding.
  // Reserve extra text height as the system font scale grows.
  const contentHeight =
    layout.tabBarContentHeight + Math.ceil(16 * Math.max(0, fontScale - 1));
  return {
    height: contentHeight + paddingTop + paddingBottom + 1,
    paddingTop,
    paddingBottom,
  };
}

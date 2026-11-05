import { readFileSync } from 'node:fs';

// Profile cannot be mounted here (Auth/native/Premium), so the wiring is checked in
// source; useFocusGatedSelection's behaviour is covered by focusGatedSelection.test.ts.
const profile = readFileSync('app/(tabs)/profile.tsx', 'utf8');

test('Profile does not subscribe directly to the arrays every Discover swipe replaces', () => {
  for (const slice of ['likedProducts', 'passedProductIds', 'wardrobeItems', 'savedOutfits'])
    expect(profile).not.toMatch(new RegExp(`useAppStore\\(\\(?state\\)? => state\\.${slice}[.)]`));
});

test('Profile reads journey inputs and counts through the focus gate', () => {
  expect(profile).toContain('const focused = useIsFocused();');
  const gate = profile.match(/useFocusGatedSelection\(focused, \(state\) => \(\{([\s\S]*?)\}\)\)/);
  expect(gate).not.toBeNull();
  for (const field of ['wardrobeCount', 'favoriteCount', 'outfitCount', 'likedProducts', 'passedProductIds', 'wardrobeItems', 'savedOutfits'])
    expect(gate?.[1]).toContain(`${field}:`);
});

test('the style journey is rebuilt only while focused (last result kept while blurred)', () => {
  expect(profile).toMatch(/focused \|\| !journeyRef\.current\s*\?\s*buildStyleJourney\(/);
  expect(profile).toMatch(/\[focused, userId, sessionUserId, sessionSyncStatus, wardrobeStatus, likedProducts, passedProductIds, wardrobeItems, savedOutfits, studio, calculatedProfile\]/);
});

import { Children, createElement } from 'react';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Read the actual Profile JSX keys without mounting Auth/native/Premium services.
const source = ts.createSourceFile('profile.tsx', readFileSync('app/(tabs)/profile.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function profileKey(tag: string, userId: string | null): string {
  let expression: string | undefined;
  function visit(node: ts.Node): void {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(source) === tag) {
      const key = node.attributes.properties.find(property => ts.isJsxAttribute(property) && property.name.getText(source) === 'key');
      if (key && ts.isJsxAttribute(key) && key.initializer && ts.isJsxExpression(key.initializer)) expression = key.initializer.expression?.getText(source);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!expression) throw new Error(`Missing account remount key: ${tag}`);
  return new Function('userId', `return (${expression});`)(userId);
}
const reportedId = '8ae527c1-ceea-4f6b-acf4-3d17decb710b';
test('the reported .$UUID is exactly React child-key encoding of two sibling account keys', () => {
  const keys = Children.toArray([createElement('Journey', { key: reportedId }), createElement('Membership', { key: reportedId })]).map(child => (child as { key: string }).key);
  expect(keys).toEqual([`.$${reportedId}`, `.$${reportedId}`]);
});
test.each([reportedId, null])('actual Profile siblings have distinct stable keys for account %s', owner => {
  const journey = profileKey('ProfileStyleJourney', owner);
  const membership = profileKey('PremiumMembership', owner);
  expect(journey).not.toBe(membership);
  expect(profileKey('ProfileStyleJourney', owner)).toBe(journey);
  expect(profileKey('PremiumMembership', owner)).toBe(membership);
});
test('account changes still remount both account-owned components', () => {
  for (const tag of ['ProfileStyleJourney', 'PremiumMembership']) expect(profileKey(tag, 'A')).not.toBe(profileKey(tag, 'B'));
});

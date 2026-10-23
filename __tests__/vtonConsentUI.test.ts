import ts from 'typescript';
import { readFileSync } from 'node:fs';
const sourceText = readFileSync('components/VirtualTryOnModal.tsx', 'utf8');
const source = ts.createSourceFile('modal.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback = '';
function visit(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleAcceptConsent' && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0].getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
const js = ts.transpile(`const callback = ${callback};`, { target: ts.ScriptTarget.ES2020 });
const drain = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
function mount() {
  let current = true, resolve!: () => void, reject!: () => void;
  const persisted = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const scope = { user: { id: 'A' }, consentSavingRef: { current: false },
    captureOwnerPublication: jest.fn(() => () => current), grantVtonConsent: jest.fn(() => persisted),
    setConsentSaving: jest.fn(), setConsentError: jest.fn(), setConsentStatus: jest.fn() };
  const accept = new Function(...Object.keys(scope), `${js}; return callback;`)(...Object.values(scope));
  return { scope, accept, resolve, reject, switchAccount: () => { current = false; } };
}
test('actual modal handler grants only after durable acceptance and blocks double taps', async () => {
  const view = mount(); view.accept(); view.accept();
  expect(view.scope.grantVtonConsent).toHaveBeenCalledTimes(1);
  expect(view.scope.grantVtonConsent).toHaveBeenCalledWith('A');
  expect(view.scope.setConsentStatus).not.toHaveBeenCalled();
  view.resolve(); await drain();
  expect(view.scope.setConsentStatus).toHaveBeenCalledWith('granted');
});
test('persistence failure stays on disclosure with an error', async () => {
  const view = mount(); view.accept(); view.reject(); await drain();
  expect(view.scope.setConsentStatus).not.toHaveBeenCalled();
  expect(view.scope.setConsentError).toHaveBeenLastCalledWith(expect.stringContaining('kaydedilemedi'));
});
test('late acceptance cannot open try-on after account switch', async () => {
  const view = mount(); view.accept(); view.switchAccount(); view.resolve(); await drain();
  expect(view.scope.setConsentStatus).not.toHaveBeenCalled();
});
test('disclosure is reread when the visible modal changes account', () => {
  expect(sourceText).toContain("hasVtonConsent(user?.id ?? '')");
  const effect = sourceText.slice(sourceText.indexOf('    void hasVtonConsent'), sourceText.indexOf('    void hasVtonConsent') + 330);
  expect(effect).toContain('[visible, user?.id]');
});

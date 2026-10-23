// UI content only. No network, environment reads or publishing.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const content = fs
  .readFileSync(path.join(root, 'PRIVACY_POLICY.md'), 'utf8')
  .replace(/\r\n/g, '\n');
const date = content.match(/\*\*Son güncelleme:\*\* (.+)/)?.[1];
if (!date) throw new Error('Policy date missing');
const hash = createHash('sha256').update(content).digest('hex');
const output =
  '// Generated from PRIVACY_POLICY.md. Run node scripts/generatePrivacyPolicy.cjs after editing the source.\n' +
  `export const PRIVACY_POLICY_DATE = ${JSON.stringify(date)};\n` +
  `export const PRIVACY_POLICY_SHA256 = ${JSON.stringify(hash)};\n` +
  `export const PRIVACY_POLICY_CONTENT = ${JSON.stringify(content)};\n`;
const target = path.join(root, 'lib/privacyPolicyContent.ts');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== output) {
    throw new Error(
      'Bundled privacy policy is stale. Run node scripts/generatePrivacyPolicy.cjs',
    );
  }
} else fs.writeFileSync(target, output);

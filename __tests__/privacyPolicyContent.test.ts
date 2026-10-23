import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  PRIVACY_POLICY_CONTENT,
  PRIVACY_POLICY_SHA256,
  PRIVACY_POLICY_DATE,
} from '../lib/privacyPolicyContent';
import { parsePolicyBlocks } from '../lib/privacyPolicy';
import { SUPPORT_EMAIL, PRIVACY_URL, ACCOUNT_DELETION_URL } from '../lib/privacy';

test('official support contact is consistent without changing policy URLs', () => {
  expect(SUPPORT_EMAIL).toBe('vitrifyapp@gmail.com');
  expect(PRIVACY_URL).toBe('https://github.com/Harun-Badur/kabin-privacy');
  expect(ACCOUNT_DELETION_URL).toBe(`${PRIVACY_URL}#4-hesap-silme`);
  expect(PRIVACY_POLICY_CONTENT).not.toContain('destek@kabin.app');
  expect(PRIVACY_POLICY_CONTENT.split(SUPPORT_EMAIL)).toHaveLength(7);
});
test('bundled full policy is the exact current source and verified published version', () => {
  const source = readFileSync('PRIVACY_POLICY.md', 'utf8').replace(
    /\r\n/g,
    '\n',
  );
  expect(PRIVACY_POLICY_CONTENT).toBe(source);
  expect(PRIVACY_POLICY_SHA256).toBe(
    createHash('sha256').update(source).digest('hex'),
  );
  expect(source).toContain(`**Son güncelleme:** ${PRIVACY_POLICY_DATE}`);
  // Anonymous public-read verification, kabin-privacy commit bbc66b92c093c3a765f768bc6fb236e7f57ca0e2.
  // Update this reference only after verifying the newly published canonical text.
  expect(PRIVACY_POLICY_SHA256).toBe(
    '34be13613701fc3d83830b34b1f8b572d51b7d00a0c0999989c68c40bb9a1d03',
  );
});
test('policy reader retains all table cells, headings and both language sections', () => {
  const blocks = parsePolicyBlocks(PRIVACY_POLICY_CONTENT);
  expect(
    blocks.some(
      (block) =>
        block.kind === 'heading' && block.text.includes('English summary'),
    ),
  ).toBe(true);
  const table = blocks.find((block) => block.kind === 'table');
  if (!table || table.kind !== 'table') throw new Error('Missing data table');
  expect(table.headers).toHaveLength(4);
  expect(
    table.rows.some((row) => row.some((cell) => cell.includes('FASHN'))),
  ).toBe(true);
  expect(blocks.filter((block) => block.kind === 'heading')).toHaveLength(12);
});

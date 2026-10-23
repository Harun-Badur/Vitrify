import { readFileSync } from 'node:fs';
import { VTON_DISCLOSURE } from '../lib/vtonDisclosure';
test('Turkish and English policy name the actual provider and separate saved photos from local results', () => {
  const policy = readFileSync('PRIVACY_POLICY.md', 'utf8');
  expect(policy).toContain('FASHN');
  expect(policy).toContain('model-photos');
  expect(policy).toContain('20 kayıt');
  expect(policy).toContain('30 gün');
  expect(policy).not.toContain('Bu sürümde fotoğraf bir giydirme sağlayıcısına gönderilmez');
  expect(policy).not.toContain('0 (işlem sonunda yok edilir)');
  expect(policy).not.toContain('photo is **not sent**');
  expect(policy).not.toContain('permanently and immediately');
});
test('in-app copy discloses transfer and storage without promising vendor deletion or no sharing', () => {
  const copy = [VTON_DISCLOSURE.lead, ...VTON_DISCLOSURE.items].join(' ');
  expect(copy).toContain('FASHN');
  expect(copy).toContain('Supabase Storage');
  expect(copy).toContain('teknik olarak doğrulanmadı');
  expect(copy).not.toContain('saklanmaz');
  expect(copy).not.toContain('paylaşım için kullanılmaz');
});

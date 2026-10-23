import { decodeWardrobePhotoBytes } from '../lib/wardrobePhotoBytes';

test.each([0, 1, 2, 3, 257, 65537])(
  'preserves all %i source bytes, including padding and high bytes',
  (length) => {
    const source = Uint8Array.from({ length }, (_, i) => i % 256);
    const base64 = Buffer.from(source).toString('base64');
    expect(decodeWardrobePhotoBytes(base64)).toEqual(source);
  },
);
test('rejects invalid base64 just as the existing decoder does', () => {
  expect(() => decodeWardrobePhotoBytes('invalid@payload')).toThrow();
});

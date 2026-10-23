/** Same bytes as Uint8Array.from(atob(value), ...), without its per-byte callback/array construction. */
export function decodeWardrobePhotoBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

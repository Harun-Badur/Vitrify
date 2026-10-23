// Bounded structural PNG validation, including CRCs. Pixel decoding remains the
// CPU processor's responsibility; no unbounded image decompression in Edge.
const table = Array.from({ length: 256 }, (_, input) => {
  let value = input; for (let n = 0; n < 8; n++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
export function validCutoutPng(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  if (bytes.length < 45 || bytes.length > 12582912 || ![137,80,78,71,13,10,26,10].every((b, i) => bytes[i] === b)) return false;
  let offset = 8, ihdr = false, data = false;
  while (offset + 12 <= bytes.length) {
    const size = view.getUint32(offset), end = offset + 8 + size;
    if (end + 4 > bytes.length) return false;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    let crc = 0xffffffff;
    for (let i = offset + 4; i < end; i++) crc = table[(crc ^ bytes[i]) & 255] ^ crc >>> 8;
    if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(end)) return false;
    if (!ihdr) {
      if (type !== 'IHDR' || size !== 13) return false;
      const width = view.getUint32(offset + 8), height = view.getUint32(offset + 12);
      if (!width || !height || width > 1600 || height > 1600 || bytes[offset + 16] !== 8 || bytes[offset + 17] !== 6) return false;
      ihdr = true;
    } else if (type === 'IHDR') return false;
    if (type === 'IDAT') data = true;
    if (type === 'IEND') return data && size === 0 && end + 4 === bytes.length;
    offset = end + 4;
  }
  return false;
}

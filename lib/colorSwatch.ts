export type Swatch = { kind: 'hex'; hex: string; light: boolean } | { kind: 'image' };

const HEX: Record<string, string> = {
  siyah: '#111111', beyaz: '#FFFFFF', gri: '#9CA3AF', antrasit: '#374151',
  lacivert: '#1F2A44', mavi: '#2F6FDE', kirmizi: '#D32F2F', bordo: '#7B1E3A',
  yesil: '#2E7D32', haki: '#78794A', sari: '#F2C230', turuncu: '#F57C20',
  pembe: '#F4A6C0', mor: '#7E57C2', kahverengi: '#6F4E37', bej: '#D8C3A5',
  ekru: '#F1EADB', krem: '#F5EBD7',
};
const LIGHT = new Set(['beyaz', 'ekru', 'krem', 'bej', 'sari', 'pembe']);

const normalize = (name: string): string =>
  name.trim().toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Known single color name -> flat swatch; null/multi-color/unknown -> use the variant image. */
export const resolveSwatch = (name: string | null | undefined): Swatch => {
  if (!name) return { kind: 'image' };
  const key = normalize(name);
  const hex = HEX[key];
  return hex ? { kind: 'hex', hex, light: LIGHT.has(key) } : { kind: 'image' };
};

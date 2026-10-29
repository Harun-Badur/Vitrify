/** pairing modülünün kanıt türleriyle aynı küme; sınır testi gereği orayı doğrudan import etmez. */
export type EvidenceKind = 'formality' | 'season' | 'color';

/**
 * Dolap eşleşmesi chip'inin metni yalnız eldeki kanıt türünü anlatır. Kanıt türü -> metin eşlemesi
 * burada tek yerde durur; sabit şablon, LLM yok. Karar pairing modülündedir, burası yalnız anlatır.
 */
export interface EvidenceCopy {
  /** Kanıt satırı ve cümle parçası: "Renk uyumlu". */
  phrase: string;
  label: string;
  summary: string;
}

const copy = (phrase: string, because: string): EvidenceCopy => ({
  phrase,
  label: `Dolabınla ${phrase.toLocaleLowerCase('tr-TR')}`,
  summary: `Dolabındaki bir parçayla ${because} uyumlu.`,
});

// Anahtar: sıralı tür adları. Renk her satırda var; renksiz kanıt chip için yeterli sayılmaz.
const EVIDENCE_COPY: Readonly<Record<string, EvidenceCopy>> = {
  color: copy('Renk uyumlu', 'renk'),
  'color+formality': copy('Renk ve resmiyet uyumlu', 'renk ve resmiyet'),
  'color+season': copy('Renk ve mevsim uyumlu', 'renk ve mevsim'),
  'color+formality+season': copy('Renk, resmiyet ve mevsim uyumlu', 'renk, resmiyet ve mevsim'),
};

const KIND_ORDER: readonly EvidenceKind[] = ['color', 'formality', 'season'];

/** Kanıt türlerinin metni; kanıt yoksa veya renk kanıtı yoksa null (iddia yok). */
export const evidenceCopy = (kinds: readonly EvidenceKind[]): EvidenceCopy | null => {
  const key = KIND_ORDER.filter(kind => kinds.includes(kind)).join('+');
  return EVIDENCE_COPY[key] ?? null;
};

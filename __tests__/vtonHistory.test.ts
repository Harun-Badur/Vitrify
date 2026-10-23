import {
  mergeTryOnHistory,
  parseTryOnHistory,
  VTON_HISTORY_CAP,
  vtonHistoryStorageKey,
  type TryOnHistoryEntry,
} from '../lib/vtonHistory';

const entry = (
  index: number,
  ts = 1_000 + index,
): TryOnHistoryEntry => ({
  productId: `p${index}`,
  title: `Ürün ${index}`,
  imageUri: `file://tryon-${index}.jpg`,
  ts,
});

describe('vtonHistory', () => {
  it('kullanıcı anahtarı önekler', () => {
    expect(vtonHistoryStorageKey('u1')).toBe('kabin.vton.history.v1.u1');
  });

  it('bozuk JSON ve eksik alanları yok sayar', () => {
    expect(parseTryOnHistory(null)).toEqual([]);
    expect(parseTryOnHistory('not-json')).toEqual([]);
    expect(parseTryOnHistory('{"productId":"x"}')).toEqual([]);
    expect(
      parseTryOnHistory(
        JSON.stringify([
          entry(1),
          { productId: 'bad' },
          { ...entry(2), ts: Number.NaN },
        ]),
      ),
    ).toEqual([entry(1)]);
  });

  it('yeni kaydı öne alır ve 20 ile sınırlar', () => {
    const existing = Array.from({ length: VTON_HISTORY_CAP }, (_, index) =>
      entry(index, index),
    );
    const incoming = entry(99, 10_000);
    const { next, evicted } = mergeTryOnHistory(existing, incoming, 10_000);

    expect(next).toHaveLength(VTON_HISTORY_CAP);
    expect(next[0]).toEqual(incoming);
    expect(evicted).toHaveLength(1);
    expect(evicted[0]?.productId).toBe('p0');
  });
});

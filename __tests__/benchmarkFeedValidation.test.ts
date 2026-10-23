jest.mock('node:fs', () => ({
  readFileSync: (file: string) => {
    if (file.endsWith('phase7.4-payload.json')) return '[]';
    if (!file.endsWith('b0-baseline-2026-10-08.manifest.json')) {
      throw new Error('Unexpected benchmark input');
    }
    const valid = {
      id: 'fixture', provider: 'mock', external_id: 'fixture', title: 'Fixture',
      brand: null, price: 100, currency: 'TRY', image_url: 'https://example.invalid/image.jpg',
      product_url: 'https://example.invalid/product', category: 'upper_body',
      affiliate_url: null, created_at: '2026-10-12T00:00:00Z',
    };
    return JSON.stringify({ dataset: { rawSnapshot: {
      products: [valid, { ...valid, id: 'invalid', brand: 42 }], attributes: [],
    } } });
  },
}));
jest.mock('../src/intelligence/outfits/rankOutfitCandidates', () => ({
  rankDiversityCandidatesAsync: jest.fn().mockResolvedValue([]),
}));

test('benchmark validates raw snapshot rows before mapping, retaining valid rows', async () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    require('../reports/catalog-expansion-v1/phase7.8-measure');
    // Both benchmark pools finish through the mocked, local ranking adapter.
    await new Promise<void>(resolve => setImmediate(resolve));
    const summary = log.mock.calls.map(([value]) => JSON.parse(String(value)))
      .find(value => 'catalog' in value);
    expect(summary).toMatchObject({ catalog: 1, existing: 1, imported: 0 });
    expect(log.mock.calls.map(([value]) => JSON.parse(String(value)).label)
      .filter(Boolean)).toEqual(['oldest80', 'capped80']);
  } finally {
    log.mockRestore();
  }
});

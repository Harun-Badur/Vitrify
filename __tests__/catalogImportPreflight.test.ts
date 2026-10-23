import { buildImportBatch, mapImportCandidate, type ImportCandidateRecord } from '../scripts/lib/catalogImportPreflight';

const candidate = (patch: Partial<ImportCandidateRecord> = {}): ImportCandidateRecord => ({
  id: 'lcw-4275208',
  externalId: '4275208',
  source: 'lcw',
  title: 'Siyah Regular Fit Erkek Chino Pantolon',
  brand: 'LCW',
  productUrl: 'https://www.lcw.com/regular-fit-erkek-chino-pantolon-siyah-o-4275208',
  imageUrl: 'https://img.example.com/pantolon.jpg',
  price: 899.9,
  currency: 'TRY',
  observedOn: '2026-10-09',
  category: 'lower_body',
  role: 'bottom',
  roleStatus: 'verified',
  pieceKind: 'single',
  gender: 'men',
  genderStatus: 'verified',
  color: 'siyah',
  colorStatus: 'verified',
  fit: 'regular',
  fitStatus: 'verified',
  canonicalSubtype: null,
  child: false,
  ...patch,
});

describe('catalog import preflight', () => {
  it('keeps verified fields and leaves missing attributes null', () => {
    const decision = mapImportCandidate(candidate({
      gender: null,
      genderStatus: 'unavailable',
      color: null,
      colorStatus: 'unavailable',
      fit: null,
      fitStatus: 'unavailable',
    }));
    expect(decision.status).toBe('ready');
    if (decision.status !== 'ready') return;
    expect(decision.payload.attributes).toMatchObject({
      gender: null,
      colors: [],
      fit: null,
      subcategory: null,
      material: null,
      season: null,
      occasion: null,
      style_tags: null,
      outfit_role: 'bottom',
    });
    expect(decision.payload.product.garment_description).toBeNull();
  });

  it('does not read gender, color, or fit out of the title', () => {
    const bare = candidate({
      title: 'Erkek Siyah Slim Tişört',
      genderStatus: 'unavailable',
      gender: null,
      colorStatus: 'unavailable',
      color: null,
      fitStatus: 'unavailable',
      fit: null,
      category: 'upper_body',
      role: 'top',
    });
    const decision = mapImportCandidate(bare);
    expect(decision.status).toBe('ready');
    if (decision.status !== 'ready') return;
    expect(decision.payload.attributes.gender).toBeNull();
    expect(decision.payload.attributes.colors).toEqual([]);
    expect(decision.payload.attributes.fit).toBeNull();
    expect(decision.payload.product.title).toBe('Erkek Siyah Slim Tişört');
  });

  it('rejects an unsupported provider and a missing price', () => {
    expect(mapImportCandidate(candidate({ source: 'koton', id: 'koton-1', externalId: '1' })).status).toBe('rejected');
    expect(mapImportCandidate(candidate({ price: null }))).toMatchObject({ status: 'rejected', reason: 'missing_price' });
  });

  it('rejects a role that does not match its category', () => {
    expect(mapImportCandidate(candidate({ role: 'top' }))).toMatchObject({
      status: 'rejected',
      reason: 'role_category_mismatch',
    });
  });

  it('returns the same payload on a second run and skips catalog collisions', () => {
    const records = [candidate(), candidate({ title: 'İkinci başlık' })];
    const existingIds = new Set(['lcw-1']);
    const first = buildImportBatch(records, existingIds, new Set());
    const second = buildImportBatch(records, existingIds, new Set());
    expect(second).toEqual(first);
    expect(first.ready).toHaveLength(1);
    expect(first.rejected).toEqual([
      expect.objectContaining({ id: 'lcw-4275208', reason: 'duplicate_in_input' }),
    ]);
    const blocked = buildImportBatch([candidate()], new Set(['lcw-4275208']), new Set());
    expect(blocked.ready).toHaveLength(0);
    expect(blocked.rejected[0]?.reason).toBe('already_in_catalog');
  });
});

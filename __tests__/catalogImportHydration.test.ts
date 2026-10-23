jest.mock('expo/virtual/env', () => ({ env: process.env }), { virtual: true });

import { hydrateImportPayload } from '../scripts/lib/catalogImportHydration';
import { mapFeedRow } from '../services/catalogProductAdapter';
import { enrichProduct } from '../src/intelligence/style/productStyle';
import type { FeedProductRow, Product } from '../types/product';

const payload = {
  product: {
    id: 'lcw-4275208',
    provider: 'lcw',
    external_id: '4275208',
    title: 'Erkek Siyah Slim Tişört',
    brand: 'LCW',
    price: 899.9,
    currency: 'TRY',
    image_url: 'https://img.example.com/shirt.jpg',
    images: ['https://img.example.com/shirt.jpg'],
    product_url: 'https://www.lcw.com/erkek-siyah-slim-tisort-o-4275208',
    category: 'upper_body',
    affiliate_url: null,
    garment_description: null,
  },
  attributes: {
    product_id: 'lcw-4275208',
    gender: null,
    colors: [],
    fit: null,
    subcategory: null,
    brand_slug: 'lcw',
    price_band: 'mid',
    material: null,
    season: null,
    occasion: null,
    style_tags: null,
    outfit_role: 'top',
  },
};

describe('catalog import hydration', () => {
  it('keeps a null description and does not invent one from the title', () => {
    const decision = hydrateImportPayload(payload);
    expect(decision.status).toBe('import_ready');
    if (decision.status !== 'import_ready') return;
    expect(decision.record.garmentDescription).toBeNull();
    expect(decision.record.brand).toBe('LCW');
    expect(decision.record.gender).toBeNull();
    expect(decision.record.colors).toEqual([]);
    expect(decision.record.fit).toBeNull();
  });

  it('rejects a description copied from the title and keeps a real one', () => {
    const copied = hydrateImportPayload({
      ...payload,
      product: { ...payload.product, garment_description: payload.product.title },
    });
    expect(copied).toMatchObject({ status: 'needs_enrichment', reason: 'synthesized_description' });
    const kept = hydrateImportPayload({
      ...payload,
      product: { ...payload.product, garment_description: 'Pamuklu örme tişört.' },
    });
    expect(kept.status).toBe('import_ready');
    if (kept.status !== 'import_ready') return;
    expect(kept.record.garmentDescription).toBe('Pamuklu örme tişört.');
  });

  it('sends a missing brand to needs_enrichment', () => {
    const decision = hydrateImportPayload({
      ...payload,
      product: { ...payload.product, brand: null },
    });
    expect(decision).toMatchObject({ status: 'needs_enrichment', reason: 'missing_brand' });
  });

  it('does not store the description Discover would synthesize', () => {
    const row: FeedProductRow = {
      id: payload.product.id,
      provider: 'lcw',
      external_id: payload.product.external_id,
      title: payload.product.title,
      brand: null,
      price: payload.product.price,
      currency: 'TRY',
      image_url: payload.product.image_url,
      product_url: payload.product.product_url,
      category: 'upper_body',
      affiliate_url: null,
    };
    const discovered = mapFeedRow(row);
    const stored = hydrateImportPayload({
      ...payload,
      product: { ...payload.product, brand: null },
    });
    expect(discovered?.brand).toBe('Kabin');
    expect(discovered?.garmentDescription).toBe(`Kabin ${payload.product.title}`);
    expect(stored.status).toBe('needs_enrichment');
  });

  it('leaves stored gender null while enrichProduct still reads the title', () => {
    const stored = hydrateImportPayload(payload);
    expect(stored.status).toBe('import_ready');
    if (stored.status !== 'import_ready') return;
    const product: Product = {
      id: stored.record.id,
      title: stored.record.title,
      brand: stored.record.brand,
      price: stored.record.price,
      imageUrl: stored.record.imageUrl,
      category: 'upper_body',
      garmentDescription: `${stored.record.brand} ${stored.record.title}`,
    };
    const enriched = enrichProduct(product, {
      product_id: product.id,
      gender: stored.record.gender,
      colors: stored.record.colors,
      fit: stored.record.fit,
      subcategory: stored.record.subcategory,
      brand_slug: 'lcw',
      price_band: 'mid',
      outfit_role: stored.record.outfitRole,
    });
    expect(stored.record.gender).toBeNull();
    expect(stored.record.colors).toEqual([]);
    expect(enriched.gender).toBe('men');
    expect(enriched.colorSlugs).toContain('siyah');
  });

  it('is deterministic for the same row', () => {
    expect(hydrateImportPayload(payload)).toEqual(hydrateImportPayload(payload));
  });
});

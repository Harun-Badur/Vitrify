import { DiscoverRecommendationCache } from '../lib/discoverRecommendationCache';
import { loadDiscoverRecommendationPacket } from '../services/discoverRecommendationCacheService';
import { getProductRepository } from '../services/productRepository';
import * as engine from '../src/intelligence/recommendations/getDiscoverRecommendations';
import * as codec from '../src/recommendationCache/codec';
import { anchorContext, type RecommendationFeedPacket } from '../src/recommendationCache/feedPacket';
import type { Product } from '../types/product';

jest.mock('../lib/supabase', () => ({ getSupabaseClient: jest.fn(() => null) }));

const top: Product = { id: 'reuse-top', title: 'Top', price: 100, brand: 'Brand', category: 'upper_body',
  outfitRole: 'top', imageUrl: 'top.jpg', garmentDescription: 'Top', gender: 'women' };
const catalog: Product[] = [top,
  { ...top, id: 'reuse-bottom', category: 'lower_body', outfitRole: 'bottom' },
  { ...top, id: 'reuse-shoes', category: 'shoes', outfitRole: 'shoes' },
  { ...top, id: 'reuse-bag', category: 'bags', outfitRole: 'bag' }];

async function settle(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('Preparation did not settle');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  await new Promise(resolve => setTimeout(resolve, 30));
}

afterEach(() => jest.restoreAllMocks());

it('does not re-serialize or republish window cards whose final key and session entry are unchanged', async () => {
  const products = getProductRepository().register(catalog.map(product => ({ ...product })));
  const session = new DiscoverRecommendationCache(products, [], null);
  session.setPreparationWindow(products.slice(0, 2));
  const serialize = jest.spyOn(codec, 'serializeFinal');
  const controller = new AbortController(), packets: RecommendationFeedPacket[] = [];
  const done = loadDiscoverRecommendationPacket(session.request(products, 1), null, controller.signal, packet => {
    packets.push(packet);
    expect(session.accept(packet, products)).toBe(true);
  }, session);
  await settle(() => packets.length >= 2);
  expect(packets.map(packet => packet.entries[0].anchorProductId)).toEqual(['reuse-top', 'reuse-bottom']);
  const serializedBefore = serialize.mock.calls.length;

  // Appending an anchor reschedules the whole window; only the new card is published.
  session.setPreparationWindow(products.slice(0, 3));
  await settle(() => packets.length >= 3);
  expect(packets.map(packet => packet.entries[0].anchorProductId)).toEqual(['reuse-top', 'reuse-bottom', 'reuse-shoes']);
  expect(serialize.mock.calls.length - serializedBefore).toBe(1);

  // Results are unchanged engine output for each card's published exposure.
  for (const packet of packets) {
    const anchor = products.find(product => product.id === packet.entries[0].anchorProductId)!;
    expect(session.peekPrepared(anchor)).toStrictEqual(engine.getDiscoverRecommendations(
      anchorContext(products, anchor, [], new Map(packet.entries[0].exposure)).input));
  }
  controller.abort(); await done;
});

it('activation whose exposure matches the prediction needs no republish; a changed exposure republishes', async () => {
  const products = getProductRepository().register(catalog.map(product => ({ ...product })));
  const session = new DiscoverRecommendationCache(products, [], null);
  session.setPreparationWindow(products.slice(0, 2));
  const controller = new AbortController(), packets: RecommendationFeedPacket[] = [];
  const done = loadDiscoverRecommendationPacket(session.request(products, 1), null, controller.signal, packet => {
    packets.push(packet);
    session.accept(packet, products);
  }, session);
  await settle(() => packets.length >= 2);
  session.activate(products[0]);
  await settle(() => true);
  expect(packets).toHaveLength(2);
  expect(session.lookup(products[1])).toStrictEqual(engine.getDiscoverRecommendations(
    anchorContext(products, products[1], [], new Map(session.exposure)).input));

  // A different actual exposure is a different final key: the card is published again for it.
  session.exposure.set('reuse-bag', (session.exposure.get('reuse-bag') ?? 0) + 5);
  session.setPreparationWindow(products.slice(0, 3));
  await settle(() => packets.some((packet, index) => index >= 2 && packet.entries[0].anchorProductId === 'reuse-bottom'));
  expect(session.lookup(products[1])).toStrictEqual(engine.getDiscoverRecommendations(
    anchorContext(products, products[1], [], new Map(session.exposure)).input));
  controller.abort(); await done;
});

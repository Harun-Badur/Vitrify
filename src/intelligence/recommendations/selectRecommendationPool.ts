import { isOutfitRole, type OutfitRole, type Product } from '../../../types/product';

/** Same bound the Discover feed already uses for one ranking page. */
export const RECOMMENDATION_POOL_LIMIT = 80;

/**
 * Optional slots multiply candidate search. Four seats kept the host p95 near the
 * oldest-80 pool; an even 10-per-role quota made that p95 several seconds.
 */
const OPTIONAL_ROLE_SEAT_CAP = 4;

const OPTIONAL_ROLES = new Set<OutfitRole>(['outerwear', 'shoes', 'bag', 'hat', 'accessory']);

const compareId = (left: Product, right: Product): number =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

const roleOf = (product: Product): OutfitRole | null =>
  isOutfitRole(product.outfitRole) ? product.outfitRole : null;

const dedupeById = (products: readonly Product[]): Product[] => {
  const byId = new Map<string, Product>();
  for (const product of [...products].sort(compareId)) {
    if (!byId.has(product.id)) byId.set(product.id, product);
  }
  return [...byId.values()];
};

const queuesFor = (products: readonly Product[]): Map<OutfitRole, Map<string, Product[]>> => {
  const groups = new Map<OutfitRole, Map<string, Product[]>>();
  for (const product of dedupeById(products)) {
    const role = roleOf(product);
    const provider = product.provider;
    if (!role || !provider) continue;
    const providers = groups.get(role) ?? new Map<string, Product[]>();
    const queue = providers.get(provider) ?? [];
    queue.push(product);
    providers.set(provider, queue);
    groups.set(role, providers);
  }
  return groups;
};

const takeRoundRobin = (
  groups: Map<OutfitRole, Map<string, Product[]>>,
  limit: number,
  roleOrder: readonly OutfitRole[],
): Product[] => {
  const cursors = new Map<OutfitRole, { providers: string[]; index: number }>();
  for (const role of roleOrder) {
    cursors.set(role, { providers: [...(groups.get(role)?.keys() ?? [])].sort(), index: 0 });
  }
  const selected: Product[] = [];
  const seen = new Set<string>();
  while (selected.length < limit) {
    let progressed = false;
    for (const role of roleOrder) {
      if (selected.length >= limit) break;
      const cursor = cursors.get(role);
      const providers = groups.get(role);
      if (!cursor || !providers || cursor.providers.length === 0) continue;
      for (let step = 0; step < cursor.providers.length; step += 1) {
        const provider = cursor.providers[cursor.index % cursor.providers.length];
        cursor.index += 1;
        const next = providers.get(provider)?.shift();
        if (next && !seen.has(next.id)) {
          seen.add(next.id);
          selected.push(next);
          progressed = true;
          break;
        }
      }
    }
    if (!progressed) break;
  }
  return selected;
};

/**
 * Deterministic recommendation pool. Provider and stored outfit role decide seats.
 * Gender, color, fit and subcategory are ignored, including values inferred at read time.
 * Products are not ordered by created_at, so newly imported rows are not stuck behind the oldest page.
 */
export const selectRecommendationPool = (
  products: readonly Product[],
  limit = RECOMMENDATION_POOL_LIMIT,
): Product[] => {
  const groups = queuesFor(products);
  const roles = ([...groups.keys()]).sort();
  const optionalRoles = roles.filter((role) => OPTIONAL_ROLES.has(role));
  const coreRoles = roles.filter((role) => !OPTIONAL_ROLES.has(role));
  const optionalBudget = Math.min(limit, optionalRoles.length * OPTIONAL_ROLE_SEAT_CAP);
  const optionalPick = takeRoundRobin(groups, optionalBudget, optionalRoles);
  const used = new Set(optionalPick.map((product) => product.id));
  const coreProducts = dedupeById(products).filter((product) => {
    const role = roleOf(product);
    return role !== null && coreRoles.includes(role) && !used.has(product.id);
  });
  return [...optionalPick, ...takeRoundRobin(queuesFor(coreProducts), limit - optionalBudget, coreRoles)]
    .sort(compareId);
};

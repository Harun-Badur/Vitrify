import type { AppState } from '../../../store/useAppStore';
import type { Product } from '../../../types/product';
import type { ProductIntelligence } from '../../../types/productIntelligence';
import type { UserStudioProfile } from '../../../types/profile';
import type { UserSnapshot } from '../../../types/userSnapshot';
import {
  buildProductIntelligence,
  productIntelligenceInputFromContext,
  type ProductAttributeContext,
} from '../product/productIntelligence';
import { buildUserSnapshot, type UserSnapshotInput } from './userSnapshot';

/** The store fields User Intelligence reads; nothing else in AppState is consulted. */
export type UserSnapshotStoreState = Pick<AppState, 'sessionUserId' | 'likedProducts' | 'passedProductIds' | 'passedStack'>;

/** Satisfied by ProductRepository; reading a context never triggers a fetch. */
export interface ProductAttributeContextSource {
  attributeContext(id: string): ProductAttributeContext | undefined;
}

export interface UserSnapshotSources {
  state: UserSnapshotStoreState;
  /** Result of fetchStudioProfile, supplied by the caller; `null` when it was not loaded. */
  profile: UserStudioProfile | null;
  /** `null` keeps every product on title/variant evidence. */
  attributeContexts: ProductAttributeContextSource | null;
}

/**
 * Liked products are `liked_products.product_snapshot` copies that bypass the repository,
 * so a context exists only when the same ID was loaded through it in this session.
 */
const contextualIntelligence = (contexts: ProductAttributeContextSource | null) =>
  (product: Product): ProductIntelligence => {
    const context = contexts?.attributeContext(product.id);
    return buildProductIntelligence(context ? productIntelligenceInputFromContext(product, context) : { product });
  };

/** Pure and read-only: no store writes, fetches, storage, analytics or Supabase access. */
export const selectUserSnapshotInput = ({ state, profile, attributeContexts }: UserSnapshotSources): UserSnapshotInput => ({
  userId: state.sessionUserId,
  // A profile fetched for another account must never describe the current session.
  profile: profile && profile.userId === state.sessionUserId ? profile : null,
  likedProducts: [...state.likedProducts],
  passedProductIds: [...state.passedProductIds],
  passedProducts: [...state.passedStack],
  resolveProductIntelligence: contextualIntelligence(attributeContexts),
});

export const buildUserSnapshotFromSources = (sources: UserSnapshotSources): UserSnapshot =>
  buildUserSnapshot(selectUserSnapshotInput(sources));

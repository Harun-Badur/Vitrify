import type { ProductPref, ProductPrefProfileGateway } from '../lib/productPreference';
import { getRequiredSupabaseClient } from '../lib/supabase';

/** Owner-only: the call is refused unless the current session belongs to userId (RLS enforces the same). */
const ownerClient = async (userId: string) => {
  const client = getRequiredSupabaseClient();
  const { data } = await client.auth.getSession();
  if (data.session?.user.id !== userId) throw new Error('Ürün tercihi için geçerli oturum gerekli.');
  return client;
};

/** profiles.product_gender_pref for the signed-in user. Errors throw; callers fall back to the local value. */
export const supabaseProductPrefGateway: ProductPrefProfileGateway = {
  async read(userId) {
    const client = await ownerClient(userId);
    const { data, error } = await client.from('profiles').select('product_gender_pref').eq('id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as { product_gender_pref?: unknown } | null)?.product_gender_pref ?? null;
  },
  async write(userId: string, pref: ProductPref) {
    const client = await ownerClient(userId);
    // update, not upsert: this never creates a profile row.
    const { error } = await client.from('profiles').update({ product_gender_pref: pref }).eq('id', userId);
    if (error) throw new Error(error.message);
  },
};

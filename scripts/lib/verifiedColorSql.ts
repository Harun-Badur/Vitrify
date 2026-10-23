import { COLOR_ALIASES } from '../../lib/productAttributes';

export const COLOR_FILL_TARGET = 'hnujkabyyrlsxohjhxlg';
export const COLOR_REVIEW_SHA256 = '3c542cad560237cceef39ba39d04a6ba234f2e679749c9589c987c8b4b419f75';
interface ColorPatch {
  product_id: string; title: string; image_url: string; product_url: string;
  expected_colors: unknown; colors: string[];
}
interface ColorProposal {
  sourceReviewSha256: string; patches: ColorPatch[];
  conflicts: Array<{ product_id: string }>; rejected: Array<{ product_id: string }>;
}

export function validateVerifiedColorScope(proposal: ColorProposal): void {
  if (proposal.sourceReviewSha256 !== COLOR_REVIEW_SHA256 || proposal.patches.length !== 66
    || new Set(proposal.patches.map(row => row.product_id)).size !== 66) throw new Error('INVALID_66_COLOR_SCOPE');
  const excluded = new Set([...proposal.conflicts, ...proposal.rejected].map(row => row.product_id));
  const vocabulary = new Set(COLOR_ALIASES.map(color => color.slug));
  for (const patch of proposal.patches) {
    if (excluded.has(patch.product_id) || !patch.product_id || !patch.title || !patch.image_url || !patch.product_url
      || !(patch.expected_colors === null || (Array.isArray(patch.expected_colors) && patch.expected_colors.length === 0))
      || !Array.isArray(patch.colors) || patch.colors.length === 0
      || new Set(patch.colors).size !== patch.colors.length || patch.colors.some(color => !vocabulary.has(color))) {
      throw new Error('INVALID_VERIFIED_COLOR_PATCH');
    }
  }
}

export function renderVerifiedColorSql(proposal: ColorProposal): string {
  validateVerifiedColorScope(proposal);
  const payload = JSON.stringify(proposal.patches.map(({ product_id, title, image_url, product_url, expected_colors, colors }) =>
    ({ product_id, title, image_url, product_url, expected_colors, colors })));
  if (payload.includes('$apply$') || payload.includes('$verified_colors$')) throw new Error('UNSAFE_SQL_DELIMITER');
  return `-- PROPOSAL ONLY: explicit approval for these 66 colors is required before production execution.
-- Main target only: ${COLOR_FILL_TARGET}. The task runner verifies TLS host/user before setting the target marker.
-- Source review SHA256: ${COLOR_REVIEW_SHA256}
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $apply$
declare scope jsonb := $verified_colors$${payload}$verified_colors$::jsonb;
  patch jsonb; stored jsonb; affected integer := 0; verified integer;
begin
  if current_setting('vitrify.target_project_ref', true) is distinct from '${COLOR_FILL_TARGET}' then
    raise exception 'MAIN_TARGET_NOT_CONFIRMED';
  end if;
  if jsonb_array_length(scope) <> 66 or (select count(distinct value->>'product_id') from jsonb_array_elements(scope)) <> 66 then
    raise exception 'INVALID_66_COLOR_SCOPE';
  end if;
  for patch in select value from jsonb_array_elements(scope) loop
    if coalesce(patch->'expected_colors', '{}'::jsonb) not in ('null'::jsonb, '[]'::jsonb) or jsonb_array_length(patch->'colors') = 0 then
      raise exception 'ONLY_EMPTY_COLOR_FIELDS_ALLOWED';
    end if;
    perform 1 from public.products p where p.id = patch->>'product_id'
      and p.title = patch->>'title' and p.image_url = patch->>'image_url' and p.product_url = patch->>'product_url' for share;
    if not found then raise exception 'SOURCE_IDENTITY_CHANGED'; end if;
    select to_jsonb(a.colors) into stored from public.product_attributes a
      where a.product_id = patch->>'product_id' for update;
    if not found then raise exception 'ATTRIBUTES_ROW_MISSING'; end if;
    if coalesce(stored, 'null'::jsonb) = patch->'expected_colors' then
      update public.product_attributes set colors = array(select jsonb_array_elements_text(patch->'colors'))
        where product_id = patch->>'product_id';
      affected := affected + 1;
    elsif stored is distinct from patch->'colors' then
      raise exception 'POPULATED_COLORS_CHANGED';
    end if;
  end loop;
  -- Single set-based verification of all 66 results, inside the same transaction.
  select count(*) into verified from jsonb_array_elements(scope) expected
    join public.product_attributes a on a.product_id = expected->>'product_id'
    where to_jsonb(a.colors) = expected->'colors';
  if verified <> 66 then raise exception 'COLOR_FILL_VERIFICATION_FAILED'; end if;
  raise notice 'VITRIFY_COLOR_FILL updated=% verified=%', affected, verified;
end;
$apply$;
commit;
`;
}

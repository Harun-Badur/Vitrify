-- Idempotent replacement for the archived 20260925 backfill.
-- Recognized categories only. Non-null outfit roles are preserved.
-- The statement does not assume how many rows are currently null.

begin;

insert into public.product_attributes as attributes (product_id, outfit_role)
select
  products.id,
  case products.category
    when 'upper_body' then 'top'
    when 'lower_body' then 'bottom'
    when 'dresses' then 'one_piece'
    when 'shoes' then 'shoes'
    when 'bags' then 'bag'
    when 'hats' then 'hat'
    when 'accessories' then 'accessory'
  end
from public.products as products
left join public.product_attributes as existing
  on existing.product_id = products.id
where products.category in (
  'upper_body', 'lower_body', 'dresses', 'shoes', 'bags', 'hats', 'accessories'
)
  and (existing.product_id is null or existing.outfit_role is null)
on conflict (product_id) do update
  set outfit_role = excluded.outfit_role
  where attributes.outfit_role is null;

commit;

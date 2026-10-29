-- Salt okunur: feed_eligible ürünlerde style_tags kapsaması (Faz 5 / S5 kapı kontrolü).
-- Yalnız yerel veya staging'de çalıştır. Beyan edilen (declared) etiket product_attributes.style_tags'tan gelir;
-- türetilmiş (derived) etiket DB'de tutulmaz, kodda alt türden türetilir.
select
  count(*)                                                        as feed_eligible_total,
  count(*) filter (where coalesce(cardinality(pa.style_tags), 0) >= 1) as with_style_tag,
  round(100.0 * count(*) filter (where coalesce(cardinality(pa.style_tags), 0) >= 1) / nullif(count(*), 0), 1) as pct_with_style_tag
from public.products p
left join public.product_attributes pa on pa.product_id = p.id
where p.feed_eligible = true;

-- Read-only: run and save the result before accessory_gender_fix.sql.
select p.id, p.gender, p.feed_eligible, p.eligibility_missing, p.attribute_source, p.attribute_version,
       a.gender as attribute_gender
from public.products p
left join public.product_attributes a on a.product_id = p.id
where p.id in ('flo-201729383', 'flo-201729387', 'flo-201729388', 'flo-201845552', 'flo-201846669', 'hepsiburada-HBCV0000CYITMK', 'trendyol-1086036215', 'trendyol-353730430', 'trendyol-662226049', 'trendyol-943974640', 'trendyol-952669343', 'trendyol-990425210')
order by p.id;

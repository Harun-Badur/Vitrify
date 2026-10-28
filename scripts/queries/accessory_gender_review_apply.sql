begin;

-- Manual review decisions for the accessory gender fix (attribute_source=manual_review).
-- Runs only on rows still in the fixed state (gender NULL, out of the feed).

do $precondition$
declare v_count integer;
begin
  select count(*) into v_count from public.products
  where id in ('flo-201729383', 'flo-201729387', 'flo-201729388', 'flo-201845552', 'flo-201846669', 'hepsiburada-HBCV0000CYITMK', 'trendyol-1086036215', 'trendyol-353730430', 'trendyol-662226049', 'trendyol-943974640', 'trendyol-952669343', 'trendyol-990425210')
    and gender is null and feed_eligible is false;
  if v_count <> 12 then
    raise exception 'accessory_gender_review: expected 12 rows in the fixed state, found %', v_count;
  end if;
end;
$precondition$;

-- flo-201729383: cikar (stays out of the feed, gender NULL)
update public.products
set attribute_source = 'manual_review',
    attribute_version = 1
where id = 'flo-201729383';

-- flo-201729387: cikar (stays out of the feed, gender NULL)
update public.products
set attribute_source = 'manual_review',
    attribute_version = 1
where id = 'flo-201729387';

-- flo-201729388: cikar (stays out of the feed, gender NULL)
update public.products
set attribute_source = 'manual_review',
    attribute_version = 1
where id = 'flo-201729388';

-- flo-201845552: cikar (stays out of the feed, gender NULL)
update public.products
set attribute_source = 'manual_review',
    attribute_version = 1
where id = 'flo-201845552';

-- flo-201846669: cikar (stays out of the feed, gender NULL)
update public.products
set attribute_source = 'manual_review',
    attribute_version = 1
where id = 'flo-201846669';

-- hepsiburada-HBCV0000CYITMK: cikar (stays out of the feed, gender NULL)
update public.products
set attribute_source = 'manual_review',
    attribute_version = 1
where id = 'hepsiburada-HBCV0000CYITMK';

-- trendyol-1086036215: kadin
update public.products
set gender = 'kadin',
    eligibility_missing = array_remove(coalesce(eligibility_missing, '{}'::text[]), 'gender'),
    feed_eligible = cardinality(array_remove(coalesce(eligibility_missing, '{}'::text[]), 'gender')) = 0,
    attribute_source = 'manual_review',
    attribute_version = 1
where id = 'trendyol-1086036215';
update public.product_attributes set gender = 'women' where product_id = 'trendyol-1086036215';

-- trendyol-353730430: unisex
update public.products
set gender = 'unisex',
    eligibility_missing = array_remove(coalesce(eligibility_missing, '{}'::text[]), 'gender'),
    feed_eligible = cardinality(array_remove(coalesce(eligibility_missing, '{}'::text[]), 'gender')) = 0,
    attribute_source = 'manual_review',
    attribute_version = 1
where id = 'trendyol-353730430';
update public.product_attributes set gender = 'unisex' where product_id = 'trendyol-353730430';

-- trendyol-662226049: cikar (stays out of the feed, gender NULL)
update public.products
set attribute_source = 'manual_review',
    attribute_version = 1
where id = 'trendyol-662226049';

-- trendyol-943974640: cikar (stays out of the feed, gender NULL)
update public.products
set attribute_source = 'manual_review',
    attribute_version = 1
where id = 'trendyol-943974640';

-- trendyol-952669343: cikar (stays out of the feed, gender NULL)
update public.products
set attribute_source = 'manual_review',
    attribute_version = 1
where id = 'trendyol-952669343';

-- trendyol-990425210: cikar (stays out of the feed, gender NULL)
update public.products
set attribute_source = 'manual_review',
    attribute_version = 1
where id = 'trendyol-990425210';

commit;

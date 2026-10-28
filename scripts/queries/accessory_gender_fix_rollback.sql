begin;

-- Restores the snapshot taken before accessory_gender_fix.sql. Refuses rows a person has reviewed since.

do $precondition$
declare v_count integer;
begin
  select count(*) into v_count from public.products
  where id in ('flo-201729383', 'flo-201729387', 'flo-201729388', 'flo-201845552', 'flo-201846669', 'hepsiburada-HBCV0000CYITMK', 'trendyol-1086036215', 'trendyol-353730430', 'trendyol-662226049', 'trendyol-943974640', 'trendyol-952669343', 'trendyol-990425210')
    and gender is null and feed_eligible is false
    and attribute_source is distinct from 'manual_review';
  if v_count <> 12 then
    raise exception 'accessory_gender_rollback: expected 12 rows in the fixed state, found %', v_count;
  end if;
end;
$precondition$;

update public.products set gender = 'unisex', feed_eligible = true, eligibility_missing = '{}'::text[], attribute_source = 'title_rules', attribute_version = 2 where id = 'flo-201729383';
update public.product_attributes set gender = null where product_id = 'flo-201729383';
update public.products set gender = 'unisex', feed_eligible = true, eligibility_missing = '{}'::text[], attribute_source = 'title_rules', attribute_version = 2 where id = 'flo-201729387';
update public.product_attributes set gender = null where product_id = 'flo-201729387';
update public.products set gender = 'unisex', feed_eligible = true, eligibility_missing = '{}'::text[], attribute_source = 'title_rules', attribute_version = 2 where id = 'flo-201729388';
update public.product_attributes set gender = null where product_id = 'flo-201729388';
update public.products set gender = 'unisex', feed_eligible = true, eligibility_missing = '{}'::text[], attribute_source = 'title_rules', attribute_version = 2 where id = 'flo-201845552';
update public.product_attributes set gender = null where product_id = 'flo-201845552';
update public.products set gender = 'unisex', feed_eligible = true, eligibility_missing = '{}'::text[], attribute_source = 'title_rules', attribute_version = 2 where id = 'flo-201846669';
update public.product_attributes set gender = null where product_id = 'flo-201846669';
update public.products set gender = 'unisex', feed_eligible = true, eligibility_missing = '{}'::text[], attribute_source = 'title_rules', attribute_version = 2 where id = 'hepsiburada-HBCV0000CYITMK';
update public.product_attributes set gender = 'unisex' where product_id = 'hepsiburada-HBCV0000CYITMK';
update public.products set gender = 'unisex', feed_eligible = true, eligibility_missing = '{}'::text[], attribute_source = 'title_rules', attribute_version = 2 where id = 'trendyol-1086036215';
update public.product_attributes set gender = null where product_id = 'trendyol-1086036215';
update public.products set gender = 'unisex', feed_eligible = true, eligibility_missing = '{}'::text[], attribute_source = 'title_rules', attribute_version = 2 where id = 'trendyol-353730430';
update public.product_attributes set gender = null where product_id = 'trendyol-353730430';
update public.products set gender = 'unisex', feed_eligible = true, eligibility_missing = '{}'::text[], attribute_source = 'title_rules', attribute_version = 2 where id = 'trendyol-662226049';
update public.product_attributes set gender = null where product_id = 'trendyol-662226049';
update public.products set gender = 'unisex', feed_eligible = true, eligibility_missing = '{}'::text[], attribute_source = 'title_rules', attribute_version = 2 where id = 'trendyol-943974640';
update public.product_attributes set gender = null where product_id = 'trendyol-943974640';
update public.products set gender = 'unisex', feed_eligible = true, eligibility_missing = '{}'::text[], attribute_source = 'title_rules', attribute_version = 2 where id = 'trendyol-952669343';
update public.product_attributes set gender = null where product_id = 'trendyol-952669343';
update public.products set gender = 'unisex', feed_eligible = true, eligibility_missing = '{}'::text[], attribute_source = 'title_rules', attribute_version = 2 where id = 'trendyol-990425210';
update public.product_attributes set gender = null where product_id = 'trendyol-990425210';

commit;

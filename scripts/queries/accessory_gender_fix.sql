begin;

-- Accessory gender fix (rule v3): unisex only with explicit evidence.
-- 12 rows: gender NULL in products and product_attributes, out of the feed.
-- Rollback: accessory_gender_fix_rollback.sql.

do $precondition$
declare v_count integer;
begin
  with expected (id, attribute_gender) as (values
    ('flo-201729383', null::text),
    ('flo-201729387', null::text),
    ('flo-201729388', null::text),
    ('flo-201845552', null::text),
    ('flo-201846669', null::text),
    ('hepsiburada-HBCV0000CYITMK', 'unisex'::text),
    ('trendyol-1086036215', null::text),
    ('trendyol-353730430', null::text),
    ('trendyol-662226049', null::text),
    ('trendyol-943974640', null::text),
    ('trendyol-952669343', null::text),
    ('trendyol-990425210', null::text))
  select count(*) into v_count
  from expected e
  join public.products p on p.id = e.id
  left join public.product_attributes a on a.product_id = p.id
  where p.gender is not distinct from 'unisex'
    and p.feed_eligible is true
    and a.gender is not distinct from e.attribute_gender;
  if v_count <> 12 then
    raise exception 'accessory_gender_fix: expected 12 rows in the snapshot state, found %', v_count;
  end if;
end;
$precondition$;

update public.products
set gender = null,
    feed_eligible = false,
    eligibility_missing = case
      when 'gender' = any(coalesce(eligibility_missing, '{}'::text[])) then eligibility_missing
      else array_append(coalesce(eligibility_missing, '{}'::text[]), 'gender')
    end,
    attribute_version = 3
where id in ('flo-201729383', 'flo-201729387', 'flo-201729388', 'flo-201845552', 'flo-201846669', 'hepsiburada-HBCV0000CYITMK', 'trendyol-1086036215', 'trendyol-353730430', 'trendyol-662226049', 'trendyol-943974640', 'trendyol-952669343', 'trendyol-990425210');

update public.product_attributes
set gender = null
where product_id in ('flo-201729383', 'flo-201729387', 'flo-201729388', 'flo-201845552', 'flo-201846669', 'hepsiburada-HBCV0000CYITMK', 'trendyol-1086036215', 'trendyol-353730430', 'trendyol-662226049', 'trendyol-943974640', 'trendyol-952669343', 'trendyol-990425210')
  and gender is not null;

do $verify$
declare v_count integer;
begin
  select count(*) into v_count from public.products
  where id in ('flo-201729383', 'flo-201729387', 'flo-201729388', 'flo-201845552', 'flo-201846669', 'hepsiburada-HBCV0000CYITMK', 'trendyol-1086036215', 'trendyol-353730430', 'trendyol-662226049', 'trendyol-943974640', 'trendyol-952669343', 'trendyol-990425210')
    and gender is null and feed_eligible is false and 'gender' = any(eligibility_missing);
  if v_count <> 12 then
    raise exception 'accessory_gender_fix: verification found % fixed rows', v_count;
  end if;
  if exists (select 1 from public.product_attributes where product_id in ('flo-201729383', 'flo-201729387', 'flo-201729388', 'flo-201845552', 'flo-201846669', 'hepsiburada-HBCV0000CYITMK', 'trendyol-1086036215', 'trendyol-353730430', 'trendyol-662226049', 'trendyol-943974640', 'trendyol-952669343', 'trendyol-990425210') and gender is not null) then
    raise exception 'accessory_gender_fix: product_attributes.gender still set';
  end if;
end;
$verify$;

commit;

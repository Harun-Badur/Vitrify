-- Feed duplicate diagnosis (d3, d4, d5). READ ONLY: counts and function metadata only,
-- no row contents. The transaction is read-only and rolled back, so no statement can write.
-- Run: npx supabase db query --linked --output-format json -f scripts/queries/dup_diagnosis.sql
begin transaction read only;

-- d3: which functions write passed_products, and does any preference/pass function do so?
select p.proname as function_name,
       pg_get_functiondef(p.oid) ~* 'insert\s+into\s+(public\.)?passed_products' as inserts_passed_products,
       pg_get_functiondef(p.oid) ~* 'delete\s+from\s+(public\.)?passed_products' as deletes_passed_products,
       pg_get_functiondef(p.oid) ~* 'passed_products' as mentions_passed_products
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname ~* '(preference|pass)' or pg_get_functiondef(p.oid) ~* 'passed_products')
  and p.prokind = 'f'
order by p.proname;

-- d3: stored passes vs pass events.
select (select count(*) from public.passed_products) as passed_products_rows,
       (select count(distinct user_id) from public.passed_products) as passed_products_users,
       (select count(*) from public.user_events where event_type = 'pass') as pass_events,
       (select count(distinct user_id) from public.user_events where event_type = 'pass') as pass_event_users,
       (select max(c) from (select count(*) c from public.passed_products group by user_id) t) as max_passes_per_user;

-- d3: distinct (user, product) pass events with no stored pass row (undo can explain some).
select count(*) as pass_pairs,
       count(*) filter (where not exists (select 1 from public.passed_products pp
         where pp.user_id = e.user_id and pp.product_id = e.product_id)) as pass_pairs_without_row,
       (select count(*) from public.user_events where event_type = 'undo_pass') as undo_pass_events
from (select distinct user_id, product_id from public.user_events where event_type = 'pass') e;

-- d5: same image under more than one product id.
select count(*) as duplicate_image_groups, coalesce(sum(n), 0) as products_in_groups
from (select image_url, count(*) n from public.products group by image_url having count(*) > 1) d;

select (array_agg(id order by id))[1:3] as example_ids, count(*) as n
from public.products group by image_url having count(*) > 1
order by count(*) desc, min(id) limit 5;

-- d4: row-count context for unbounded PostgREST reads, and any max-rows override on the API roles.
select (select count(*) from public.products) as products_rows,
       (select count(*) from public.product_attributes) as product_attributes_rows;

select rolname, coalesce(array_to_string(rolconfig, ';'), '') ~* 'max_rows' as has_max_rows_setting,
       (select string_agg(c, ';') from unnest(rolconfig) c where c ~* 'max_rows') as max_rows_setting
from pg_roles where rolname in ('authenticator', 'anon', 'authenticated', 'service_role');

rollback;

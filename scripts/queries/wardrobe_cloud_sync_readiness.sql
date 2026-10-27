-- READ-ONLY: dolap subcategory/color bulut senkronu hazırlık incelemesi. Yalnız katalog SELECT'leri; veri okumaz, yazmaz.
-- Çalıştırma: npx supabase db query --linked -f scripts/queries/wardrobe_cloud_sync_readiness.sql --output-format json

select 'column' as kind, c.table_name as name, c.column_name as detail, c.data_type || ' / ' || c.udt_name as type,
       c.is_nullable as nullable, c.column_default as body
from information_schema.columns c
where c.table_schema = 'public' and c.table_name like 'wardrobe%'
union all
select 'function', p.proname, pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid), null,
       pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('wardrobe_apply_change', 'wardrobe_cloud_snapshot')
order by 1, 2, 3;

-- Kısıtlar ve tetikleyiciler (subcategory/color üzerinde CHECK var mı?)
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.wardrobe_items'::regclass
union all
select tgname, pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'public.wardrobe_items'::regclass and not tgisinternal;

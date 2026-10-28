-- Rollback for supabase/migrations/202610280002_profiles_product_pref.sql.
-- Drops the column and its check; stored preferences are lost.
-- Afterwards: supabase migration repair --status reverted 202610280002 --linked
begin;

alter table public.profiles
  drop constraint if exists profiles_product_gender_pref_check;

alter table public.profiles
  drop column if exists product_gender_pref;

commit;

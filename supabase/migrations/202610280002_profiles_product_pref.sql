-- Product preference on the profile: NULL = not chosen (client treats it as 'hepsi').
-- No grant change: anon/authenticated hold table-level SELECT/INSERT/UPDATE on public.profiles,
-- which covers new columns; RLS owner policies (auth.uid() = id) already gate every row.
begin;

alter table public.profiles
  add column if not exists product_gender_pref text null;

do $product_pref_check$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_product_gender_pref_check'
  ) then
    alter table public.profiles
      add constraint profiles_product_gender_pref_check
      check (product_gender_pref in ('kadin', 'erkek', 'hepsi'));
  end if;
end
$product_pref_check$;

commit;

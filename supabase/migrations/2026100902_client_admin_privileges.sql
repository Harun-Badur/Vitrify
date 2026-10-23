-- Remove client administrative privileges from the nine target tables.
-- SELECT, INSERT, UPDATE, and DELETE are unchanged.
-- postgres can narrow its own default ACLs. It cannot alter supabase_admin defaults.
begin;

revoke truncate, trigger, references, maintain on table
  public.users,
  public.products,
  public.profiles,
  public.liked_products,
  public.passed_products,
  public.push_tokens,
  public.price_alerts
  from anon, authenticated;

revoke truncate, trigger, references, maintain on table
  public.user_events,
  public.user_style_profiles
  from authenticated;

alter default privileges for role postgres in schema public
  revoke truncate, trigger, references, maintain on tables from anon, authenticated;

-- Regression check only. A warning leaves the revokes committed.
-- New tables created by supabase_admin still inherit its unchanged defaults.
do $acl_regression$
declare
  admin_default_visible boolean;
  remaining integer;
begin
  select exists (
    select 1
    from pg_default_acl as defaults
    join pg_namespace as schemas on schemas.oid = defaults.defaclnamespace
    where schemas.nspname = 'public'
      and defaults.defaclobjtype = 'r'
      and pg_get_userbyid(defaults.defaclrole) = 'supabase_admin'
  )
    into admin_default_visible;

  select count(*)
    into remaining
  from pg_default_acl as defaults
  join pg_namespace as schemas on schemas.oid = defaults.defaclnamespace
  cross join lateral aclexplode(defaults.defaclacl) as acl
  where schemas.nspname = 'public'
    and defaults.defaclobjtype = 'r'
    and pg_get_userbyid(defaults.defaclrole) = 'supabase_admin'
    and (
      acl.grantee = 0
      or pg_get_userbyid(acl.grantee) in ('anon', 'authenticated')
    )
    and acl.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN');

  if not admin_default_visible then
    raise warning
      'ACL regression check: supabase_admin public table default ACL is not visible. The gap is unresolved.';
  elsif remaining > 0 then
    raise warning
      'ACL regression check: supabase_admin still has % client TRUNCATE, TRIGGER, REFERENCES, or MAINTAIN default privileges on new public tables. postgres cannot change them.',
      remaining;
  end if;
end
$acl_regression$;

commit;

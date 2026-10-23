-- Read-only guard for client administrative privileges on public relations.
-- supabase_admin default ACLs are a known platform constraint: they are reported
-- and do not fail this guard by themselves.
-- postgres defaults, and effective TRUNCATE / TRIGGER / REFERENCES / MAINTAIN
-- for anon or authenticated fail only where the privilege permits an operation.
-- Views support TRIGGER, and TRUNCATE/MAINTAIN authorize LOCK TABLE on views;
-- REFERENCES on a view alone does not authorize a foreign key. Materialized
-- views support MAINTAIN and lock authority, not triggers or foreign keys.
-- Run with a PostgreSQL client supporting this multi-statement read-only transaction,
-- using an explicitly verified staging connection; never use implicit linked targeting.
begin transaction isolation level repeatable read read only;

do $guard$
declare
  object_violations text;
  postgres_defaults text;
  platform_constraints text;
  admin_owned text;
  view_violations text;
  scanned_relations integer;
begin
  select count(*)
    into scanned_relations
  from pg_class as relations
  join pg_namespace as schemas on schemas.oid = relations.relnamespace
  where schemas.nspname = 'public'
    and relations.relkind in ('r', 'p', 'v', 'm', 'f');

  select string_agg(found.item, e'\n' order by found.item)
    into object_violations
  from (
    select format(
      'object kind=%s name=%s role=%s privilege=%s',
      relations.relkind,
      relations.relname,
      roles.role_name,
      privileges.privilege_name
    ) as item
    from pg_class as relations
    join pg_namespace as schemas on schemas.oid = relations.relnamespace
    cross join (
      values ('anon'), ('authenticated')
    ) as roles(role_name)
    cross join (
      values
        ('TRUNCATE', 'rpvmf'), ('TRIGGER', 'rpvf'),
        ('REFERENCES', 'rp'), ('MAINTAIN', 'rpvmf')
    ) as privileges(privilege_name, applicable_kinds)
    where schemas.nspname = 'public'
      and position(relations.relkind::text in privileges.applicable_kinds) > 0
      and has_table_privilege(roles.role_name, relations.oid, privileges.privilege_name)
  ) as found;

  -- An exposed application view must use the caller's base-relation permissions.
  -- v_funnel has an explicit read-only client policy: authenticated SELECT only.
  select string_agg(found.item, e'\n' order by found.item)
    into view_violations
  from (
    select format('view name=%s role=%s violation=%s', relations.relname,
      roles.role_name, checks.violation) as item
    from pg_class as relations
    join pg_namespace as schemas on schemas.oid = relations.relnamespace
    cross join (values ('anon'), ('authenticated')) as roles(role_name)
    cross join lateral (
      select 'security_invoker_required' as violation
      where not coalesce(relations.reloptions @> array['security_invoker=true'], false)
        and (has_table_privilege(roles.role_name, relations.oid, 'SELECT')
          or has_table_privilege(roles.role_name, relations.oid, 'INSERT')
          or has_table_privilege(roles.role_name, relations.oid, 'UPDATE')
          or has_table_privilege(roles.role_name, relations.oid, 'DELETE'))
      union all
      select 'v_funnel_read_only_client_policy'
      where relations.relname = 'v_funnel'
        and (has_table_privilege(roles.role_name, relations.oid, 'INSERT')
          or has_table_privilege(roles.role_name, relations.oid, 'UPDATE')
          or has_table_privilege(roles.role_name, relations.oid, 'DELETE')
          or (roles.role_name = 'anon' and has_table_privilege(roles.role_name, relations.oid, 'SELECT'))
          or (roles.role_name = 'authenticated' and not has_table_privilege(roles.role_name, relations.oid, 'SELECT')))
    ) as checks
    where schemas.nspname = 'public' and relations.relkind = 'v'
  ) as found;

  select string_agg(found.item, e'\n' order by found.item)
    into postgres_defaults
  from (
    select format(
      'postgres_default grantee=%s privilege=%s scope=%s',
      case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
      acl.privilege_type,
      coalesce(schemas.nspname, 'GLOBAL')
    ) as item
    from pg_default_acl as defaults
    left join pg_namespace as schemas on schemas.oid = defaults.defaclnamespace
    cross join lateral aclexplode(defaults.defaclacl) as acl
    where (schemas.nspname = 'public' or defaults.defaclnamespace = 0)
      and defaults.defaclobjtype = 'r'
      and pg_get_userbyid(defaults.defaclrole) = 'postgres'
      and (
        acl.grantee = 0
        or pg_get_userbyid(acl.grantee) in ('anon', 'authenticated')
      )
      and acl.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
  ) as found;

  select string_agg(found.item, e'\n' order by found.item)
    into platform_constraints
  from (
    select format(
      'platform_default creator=%s grantee=%s privilege=%s scope=%s',
      pg_get_userbyid(defaults.defaclrole),
      case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
      acl.privilege_type,
      coalesce(schemas.nspname, 'GLOBAL')
    ) as item
    from pg_default_acl as defaults
    left join pg_namespace as schemas on schemas.oid = defaults.defaclnamespace
    cross join lateral aclexplode(defaults.defaclacl) as acl
    where (schemas.nspname = 'public' or defaults.defaclnamespace = 0)
      and defaults.defaclobjtype = 'r'
      and pg_get_userbyid(defaults.defaclrole) = 'supabase_admin'
      and (
        acl.grantee = 0
        or pg_get_userbyid(acl.grantee) in ('anon', 'authenticated')
      )
      and acl.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
  ) as found;

  select string_agg(found.item, e'\n' order by found.item)
    into admin_owned
  from (
    select format(
      'admin_owned kind=%s name=%s role=%s privilege=%s',
      relations.relkind,
      relations.relname,
      roles.role_name,
      privileges.privilege_name
    ) as item
    from pg_class as relations
    join pg_namespace as schemas on schemas.oid = relations.relnamespace
    cross join (
      values ('anon'), ('authenticated')
    ) as roles(role_name)
    cross join (
      values
        ('SELECT', 'rpvmf'), ('INSERT', 'rpvf'), ('UPDATE', 'rpvf'), ('DELETE', 'rpvf'),
        ('TRUNCATE', 'rpvmf'), ('TRIGGER', 'rpvf'), ('REFERENCES', 'rp'), ('MAINTAIN', 'rpvmf')
    ) as privileges(privilege_name, applicable_kinds)
    where schemas.nspname = 'public'
      and relations.relkind in ('r', 'p', 'v', 'm', 'f')
      and position(relations.relkind::text in privileges.applicable_kinds) > 0
      and pg_get_userbyid(relations.relowner) = 'supabase_admin'
      and has_table_privilege(roles.role_name, relations.oid, privileges.privilege_name)

    union all

    select format(
      'admin_owned kind=sequence name=%s role=%s privilege=%s',
      sequences.relname,
      roles.role_name,
      privileges.privilege_name
    ) as item
    from pg_class as sequences
    join pg_namespace as schemas on schemas.oid = sequences.relnamespace
    cross join (
      values ('anon'), ('authenticated')
    ) as roles(role_name)
    cross join (
      values ('USAGE'), ('SELECT'), ('UPDATE')
    ) as privileges(privilege_name)
    where schemas.nspname = 'public'
      and sequences.relkind = 'S'
      and pg_get_userbyid(sequences.relowner) = 'supabase_admin'
      and has_sequence_privilege(roles.role_name, sequences.oid, privileges.privilege_name)

    union all

    select format(
      'admin_owned kind=function name=%s role=%s privilege=EXECUTE',
      functions.proname,
      roles.role_name
    ) as item
    from pg_proc as functions
    join pg_namespace as schemas on schemas.oid = functions.pronamespace
    cross join (
      values ('anon'), ('authenticated')
    ) as roles(role_name)
    where schemas.nspname = 'public'
      and pg_get_userbyid(functions.proowner) = 'supabase_admin'
      and has_function_privilege(roles.role_name, functions.oid, 'EXECUTE')
  ) as found;

  if object_violations is not null or postgres_defaults is not null
    or view_violations is not null or admin_owned is not null then
    raise exception 'client administrative ACL guard failed scanned_relations=% EFFECTIVE_OBJECT_VIOLATIONS:% POSTGRES_DEFAULT_VIOLATIONS:% PLATFORM_DEFAULT_CONSTRAINT:% SUPABASE_ADMIN_OWNED_EXPOSED:% VIEW_POLICY_VIOLATIONS:%',
      scanned_relations,
      coalesce(e'\n' || object_violations, e'\nnone'),
      coalesce(e'\n' || postgres_defaults, e'\nnone'),
      coalesce(e'\n' || platform_constraints, e'\nnone'),
      coalesce(e'\n' || admin_owned, e'\nnone'),
      coalesce(e'\n' || view_violations, e'\nnone');
  end if;

  raise notice 'platform_default_constraint scanned_relations=% %',
    scanned_relations,
    coalesce(platform_constraints, 'none');
  raise notice 'supabase_admin_owned_exposed %',
    coalesce(admin_owned, 'none');
end
$guard$;

select jsonb_build_object(
  'read_only', current_setting('transaction_read_only'),
  'captured_at', current_timestamp,
  'scanned_relations', (
    select count(*)
    from pg_class as relations
    join pg_namespace as schemas on schemas.oid = relations.relnamespace
    where schemas.nspname = 'public'
      and relations.relkind in ('r', 'p', 'v', 'm', 'f')
  ),
  'effective_object_violations', 'none',
  'postgres_default_violations', 'none',
  'view_policy_violations', 'none',
  'platform_default_constraint_blocking', false,
  'platform_default_constraint', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'creator', pg_get_userbyid(defaults.defaclrole),
        'scope', coalesce(schemas.nspname, 'GLOBAL'),
        'grantee', case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
        'privilege', acl.privilege_type
      )
      order by
        case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
        acl.privilege_type
    )
    from pg_default_acl as defaults
    left join pg_namespace as schemas on schemas.oid = defaults.defaclnamespace
    cross join lateral aclexplode(defaults.defaclacl) as acl
    where (schemas.nspname = 'public' or defaults.defaclnamespace = 0)
      and defaults.defaclobjtype = 'r'
      and pg_get_userbyid(defaults.defaclrole) = 'supabase_admin'
      and (
        acl.grantee = 0
        or pg_get_userbyid(acl.grantee) in ('anon', 'authenticated')
      )
      and acl.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
  ), '[]'::jsonb),
  'supabase_admin_owned_exposed', coalesce((
    select jsonb_agg(found.item order by found.item)
    from (
      select format(
        '%s %s %s %s',
        relations.relkind,
        relations.relname,
        roles.role_name,
        privileges.privilege_name
      ) as item
      from pg_class as relations
      join pg_namespace as schemas on schemas.oid = relations.relnamespace
      cross join (
        values ('anon'), ('authenticated')
      ) as roles(role_name)
      cross join (
        values
          ('SELECT', 'rpvmf'), ('INSERT', 'rpvf'), ('UPDATE', 'rpvf'), ('DELETE', 'rpvf'),
          ('TRUNCATE', 'rpvmf'), ('TRIGGER', 'rpvf'), ('REFERENCES', 'rp'), ('MAINTAIN', 'rpvmf')
      ) as privileges(privilege_name, applicable_kinds)
      where schemas.nspname = 'public'
        and relations.relkind in ('r', 'p', 'v', 'm', 'f')
        and position(relations.relkind::text in privileges.applicable_kinds) > 0
        and pg_get_userbyid(relations.relowner) = 'supabase_admin'
        and has_table_privilege(roles.role_name, relations.oid, privileges.privilege_name)
      union all
      select format(
        'S %s %s %s',
        sequences.relname,
        roles.role_name,
        privileges.privilege_name
      ) as item
      from pg_class as sequences
      join pg_namespace as schemas on schemas.oid = sequences.relnamespace
      cross join (
        values ('anon'), ('authenticated')
      ) as roles(role_name)
      cross join (
        values ('USAGE'), ('SELECT'), ('UPDATE')
      ) as privileges(privilege_name)
      where schemas.nspname = 'public'
        and sequences.relkind = 'S'
        and pg_get_userbyid(sequences.relowner) = 'supabase_admin'
        and has_sequence_privilege(roles.role_name, sequences.oid, privileges.privilege_name)
      union all
      select format(
        'function %s %s EXECUTE',
        functions.proname,
        roles.role_name
      ) as item
      from pg_proc as functions
      join pg_namespace as schemas on schemas.oid = functions.pronamespace
      cross join (
        values ('anon'), ('authenticated')
      ) as roles(role_name)
      where schemas.nspname = 'public'
        and pg_get_userbyid(functions.proowner) = 'supabase_admin'
        and has_function_privilege(roles.role_name, functions.oid, 'EXECUTE')
    ) as found
  ), '[]'::jsonb)
) as guard_report;

rollback;

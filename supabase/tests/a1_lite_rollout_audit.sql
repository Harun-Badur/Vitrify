-- PREPARED / NOT RUN. Catalog-only audit, not a migration or admission/drain proof.
-- Authorized operator must inspect output and test JWT/signed/TUS behavior separately.
begin read only;
set local statement_timeout = '30s';

-- Policy presence is not sufficient: permissive policy OR composition, restrictive
-- policies, role membership and signed URL/TUS behavior all require actual tests.
select policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname='storage' and tablename='objects'
order by policyname;
select grantee, privilege_type from information_schema.role_table_grants
where table_schema='storage' and table_name='objects'
order by grantee, privilege_type;
select n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity,
  pg_get_userbyid(c.relowner) as owner
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='storage' and c.relname='objects';

-- Preserve private tombstones/receipts/operations: these deliberately must NOT
-- cascade from Auth. For app data, expose missing/wrong FK instead of assuming
-- all user columns have ON DELETE CASCADE. Explicit existing cleanup is retained.
select i.relation_name, i.owner_column, a.attnotnull as owner_not_null,
  k.conname, k.convalidated, pg_get_constraintdef(k.oid) as definition
from deletion_private.inventory i
left join pg_class t on t.oid=to_regclass('public.'||quote_ident(i.relation_name))
left join pg_attribute a on a.attrelid=t.oid and a.attname=i.owner_column and not a.attisdropped
left join pg_constraint k on k.conrelid=t.oid and k.contype='f' and a.attnum=any(k.conkey)
order by i.relation_name, k.conname;
select c.relname, k.conname, pg_get_constraintdef(k.oid) as definition
from pg_constraint k join pg_class c on c.oid=k.conrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='deletion_private' and k.contype='f'
order by c.relname, k.conname;
rollback;

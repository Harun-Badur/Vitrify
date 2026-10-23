-- Isolated test database only. Reproduce the LIVE VERIFIED owner/default ACL shape.
create schema deletion_private;
revoke all on schema deletion_private from public,anon,authenticated,service_role;
create table deletion_private.owner_gates(subject uuid primary key,fenced boolean not null default false);
-- Exact fence body resolves this relation when planning its IF expression,
-- even for non-cache tables. Empty compile dependency; no cache jobs are run.
create table deletion_private.cache_write_permits(transaction_id bigint,owner_id uuid,kind text,cache_key_hash text);
insert into deletion_private.owner_gates(subject) select id from auth.users;
create table style_test.install_baseline(source text,acl text,profiles jsonb,events jsonb);
do $$ begin
  execute replace(pg_get_functiondef('public.recompute_profile(uuid)'::regprocedure),
    'FUNCTION public.recompute_profile(', 'FUNCTION style_test.reference_v1(');
end $$;
grant execute on function style_test.reference_v1(uuid) to authenticated;
alter table public.profiles enable row level security;
create policy test_profiles_own on public.profiles for all to authenticated using(auth.uid()=id) with check(auth.uid()=id);
grant select,insert,update,delete on public.profiles to authenticated;
insert into public.profiles(id) select id from auth.users;
revoke select,insert,update,delete on public.users,public.liked_products,public.passed_products,public.profiles from service_role;
grant truncate,trigger,references,maintain on public.users,public.liked_products,public.passed_products,public.profiles to service_role;
revoke create on schema public from public,anon,authenticated,service_role;
-- The bootstrap superuser cannot be demoted. Use an isolated stand-in owner
-- with staging's nonsuperuser/BYPASSRLS properties, leaving bootstrap untouched.
create role style_schema_owner nologin nosuperuser bypassrls;
grant authenticated,anon,service_role to style_schema_owner;
grant usage,create on schema public to style_schema_owner;
alter schema auth owner to style_schema_owner;
alter schema style_test owner to style_schema_owner;
alter schema deletion_private owner to style_schema_owner;
do $$ declare item record; begin
  for item in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','auth','style_test','deletion_private') and c.relkind in ('r','p') loop
    execute format('alter table %I.%I owner to style_schema_owner',item.nspname,item.relname);
  end loop;
  for item in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','auth','style_test','deletion_private') and p.prokind='f' loop
    execute format('alter function %I.%I(%s) owner to style_schema_owner',item.nspname,item.proname,item.args);
  end loop;
end $$;
alter default privileges for role style_schema_owner revoke execute on functions from public;
alter default privileges for role style_schema_owner in schema public grant truncate,trigger,references,maintain on tables to service_role;

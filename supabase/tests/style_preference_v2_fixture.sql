-- Disposable local cluster ONLY. Minimal auth context, NOT JWT verification.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
\ir ../schema_products.sql
\ir ../schema.sql
-- Only price_tracking's required column; no unrelated price/notification modules.
alter table public.liked_products add column notify_on_price_drop boolean not null default true;
create table public.profiles(id uuid primary key references auth.users(id) on delete cascade,style_tags jsonb not null default '[]');
\ir ../recs_v1.sql
\ir ../recs_v1_p1.sql
\ir ../../reports/backend/proposals/20261012_style_preference_v2.sql

create schema style_test;
grant usage on schema style_test to anon,authenticated,service_role;
create function style_test.claim(label text) returns void language plpgsql as $$
declare subject uuid;
begin
  subject:=case label when 'A' then '00000000-0000-4000-8000-000000000001'::uuid
    when 'B' then '00000000-0000-4000-8000-000000000002'::uuid
    when 'C' then '00000000-0000-4000-8000-000000000003'::uuid end;
  perform set_config('request.jwt.claims',case when subject is null then '{}' else jsonb_build_object('sub',subject)::text end,false);
end;
$$;
create function style_test.ok(value boolean,code text) returns void language plpgsql as $$
begin
  if value is distinct from true then raise exception 'FAIL %',code; end if;
  raise notice 'PASS %',code;
end;
$$;
create function style_test.denied(statement text,expected text,code text) returns void language plpgsql as $$
declare got text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics got=message_text;
    if got not like '%'||expected||'%' then raise exception 'FAIL % UNEXPECTED_SQL_ERROR',code; end if;
    raise notice 'PASS %',code;return;
  end;
  raise exception 'FAIL % EXPECTED_REJECTION',code;
end;
$$;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000001','a@synthetic.invalid'),
 ('00000000-0000-4000-8000-000000000002','b@synthetic.invalid'),
 ('00000000-0000-4000-8000-000000000003','c@synthetic.invalid');
insert into public.products(id,provider,external_id,title,price,image_url,product_url,category)
 select 'fixture-'||i,'mock',i::text,'Synthetic fixture',100,'https://example.invalid/image','https://example.invalid/item','upper_body'
 from generate_series(1,8) i;
insert into public.product_attributes(product_id,colors,subcategory,fit,brand_slug,price_band)
 select id,array['siyah'],'tisort','regular','fixture','mid' from public.products;

-- Test-only activation decision; never applied to existing user databases.
insert into public.recs_config(key,value) values
 ('style_preference_writer_v2','{"enabled":true}'),
 ('style_profile_v2','{"algorithm":"style-preference-v2","legacy_policy":"exclude_with_approval"}');

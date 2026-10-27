-- Unapplied. Dolap subcategory/color bulut senkronu.
-- Bodies are the live definitions read 2026-10-27 (scripts/queries/wardrobe_cloud_sync_readiness.md);
-- the only change is subcategory/color. Absent key = keep stored value (old clients never erase it).
-- Server checks format only (lowercase slug, <=40, '' -> NULL); palette membership is the client's job.
-- No table, trigger, grant or privilege change. Owner, ACL, SECURITY INVOKER and search_path are
-- asserted unchanged; the A1 fence trigger and any installed cutout_v2 wrappers are asserted intact.
begin;

create temporary table wardrobe_style_fields_before on commit drop as
-- CREATE OR REPLACE keeps each function's oid, so the after-check reads the very same objects.
select p.oid as fn_oid, p.proname, p.prosecdef, p.proconfig, p.proacl::text as acl, p.proowner,
       p.provolatile, p.prosrc
from pg_proc p
where p.oid in (
  to_regprocedure('public.wardrobe_apply_change(uuid,text,uuid,timestamptz,jsonb)'),
  to_regprocedure('public.wardrobe_cloud_snapshot(uuid)'),
  to_regprocedure('public.wardrobe_apply_change_v2(uuid,text,uuid,timestamptz,jsonb)'),
  to_regprocedure('public.wardrobe_cloud_snapshot_v2(uuid)'));

do $$ begin
 if (select count(*) from pg_attribute where attrelid=to_regclass('public.wardrobe_items') and not attisdropped
     and attname in ('subcategory','color') and atttypid='text'::regtype)<>2
 then raise exception 'WARDROBE_STYLE_FIELDS_COLUMNS'; end if;
 if (select count(*) from wardrobe_style_fields_before
     where proname in ('wardrobe_apply_change','wardrobe_cloud_snapshot') and not prosecdef
       and exists(select 1 from unnest(proconfig) conf where regexp_replace(conf,'[[:space:]]','','g')='search_path=pg_catalog,public'))<>2
 then raise exception 'WARDROBE_STYLE_FIELDS_SECURITY'; end if;
 -- Replace only the exact live bodies copied below (= reports/backend/proposals/20261014_wardrobe_original_photo.sql).
 if (select count(*) from wardrobe_style_fields_before where
     (proname='wardrobe_apply_change' and md5(replace(prosrc,chr(13),''))='e605ba96f84c6c179f8068e0b50247c8')
     or (proname='wardrobe_cloud_snapshot' and md5(replace(prosrc,chr(13),''))='4ccbc5b3c5a46c154ceac0f4dc278757'))<>2
 then raise exception 'WARDROBE_STYLE_FIELDS_SOURCE'; end if;
 if not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.wardrobe_items')
   and tgname='account_deletion_fence' and tgfoid=to_regprocedure('deletion_private.block_owned_write()')
   and tgenabled in ('O','A') and (tgtype::integer & 23)=23 and tgnargs=1 and tgargs=decode('757365725f696400','hex'))
 then raise exception 'WARDROBE_STYLE_FIELDS_FENCE'; end if;
end $$;

create or replace function public.wardrobe_apply_change(p_owner uuid, p_kind text, p_id uuid, p_expected timestamp with time zone, p_value jsonb)
 returns text
 language plpgsql
 set search_path to 'pg_catalog', 'public'
as $function$
declare who uuid:=auth.uid(); current_version timestamptz; found_row boolean; affected integer; reference uuid; product text; position integer:=0; linked uuid[]; style_key text;
begin
 if who is null or who is distinct from p_owner then raise exception 'Wardrobe owner mismatch' using errcode='42501'; end if;
 if p_id is null or p_kind not in ('item','outfit') or p_kind is null then raise exception 'Invalid wardrobe change'; end if;
 if p_kind='item' then
   select updated_at into current_version from public.wardrobe_items where id=p_id and user_id=who for update;
 else
   select updated_at into current_version from public.outfits where id=p_id and user_id=who for update;
 end if;
 found_row:=found;
 if found_row then
   if p_expected is null or current_version is distinct from p_expected then return 'conflict'; end if;
 elsif p_expected is not null then return 'conflict'; end if;
 if p_value is null then
   if not found_row then return 'applied'; end if;
   if p_kind='item' then
     select array_agg(distinct o.id) into linked from public.outfits o join public.outfit_items i on i.outfit_id=o.id
       where o.user_id=who and i.wardrobe_item_id=p_id;
     delete from public.wardrobe_items where id=p_id and user_id=who;
     get diagnostics affected=row_count;
     if affected<>1 then raise exception 'Wardrobe deletion unverified'; end if;
     -- Existing FK CASCADE removes relations; update parent versions so another
     -- device cannot overwrite an outfit using a pre-delete relationship base.
     update public.outfits set updated_at=clock_timestamp() where user_id=who and id=any(coalesce(linked,'{}'::uuid[]));
   else
     delete from public.outfits where id=p_id and user_id=who;
     get diagnostics affected=row_count;
     if affected<>1 then raise exception 'Outfit deletion unverified'; end if;
   end if;
   return 'applied';
 end if;
 if jsonb_typeof(p_value) is distinct from 'object' or nullif(btrim(p_value->>'title'),'') is null then raise exception 'Invalid wardrobe payload'; end if;
 if p_kind='item' then
   if ((p_value->>'imageStoragePath' is null and (p_value->>'imageUrl' is null or p_value->>'imageUrl' !~ '^https://' or p_value->>'imageUrl' like '%/object/sign/%')) or (p_value->>'imageStoragePath' is not null and (p_value->>'imageUrl' is distinct from '' or p_value->>'imageStoragePath' !~ ('^'||who::text||'/'||p_id::text||'/original-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}[.]png$'))))
     or p_value->>'category' is null or p_value->>'category' not in ('upper_body','lower_body','dresses','shoes','bags','hats','accessories') then
     raise exception 'Persistent remote original image/category required'; end if;
   -- Style fields: optional; string or null; non-empty strings must be a short lowercase slug.
   foreach style_key in array array['subcategory','color'] loop
     if p_value ? style_key and (jsonb_typeof(p_value->style_key) not in ('string','null')
        or (p_value->>style_key <> '' and p_value->>style_key !~ '^[a-z0-9_]{1,40}$')) then
       raise exception 'Invalid wardrobe style field' using errcode='22023'; end if;
   end loop;
   if found_row then
     update public.wardrobe_items set name=p_value->>'title',image_url=p_value->>'imageUrl',image_storage_path=p_value->>'imageStoragePath',category=p_value->>'category',brand=coalesce(p_value->>'brand',''),
       subcategory=case when p_value ? 'subcategory' then nullif(p_value->>'subcategory','') else subcategory end,
       color=case when p_value ? 'color' then nullif(p_value->>'color','') else color end
       where id=p_id and user_id=who;
     get diagnostics affected=row_count;
     if affected<>1 then raise exception 'Wardrobe update unverified'; end if;
   else
     insert into public.wardrobe_items(id,user_id,name,image_url,image_storage_path,category,brand,created_at,subcategory,color)
       values(p_id,who,p_value->>'title',p_value->>'imageUrl',p_value->>'imageStoragePath',p_value->>'category',coalesce(p_value->>'brand',''),(p_value->>'createdAt')::timestamptz,
         nullif(p_value->>'subcategory',''),nullif(p_value->>'color',''));
   end if;
 else
   if jsonb_typeof(p_value->'wardrobeItemIds') is distinct from 'array' or jsonb_typeof(p_value->'catalogProductIds') is distinct from 'array'
      or jsonb_array_length(p_value->'wardrobeItemIds')+jsonb_array_length(p_value->'catalogProductIds')>64 then raise exception 'Invalid outfit references'; end if;
   for reference in select value::uuid from jsonb_array_elements_text(p_value->'wardrobeItemIds') loop
     if not exists(select 1 from public.wardrobe_items where id=reference and user_id=who) then raise exception 'Foreign or missing wardrobe reference' using errcode='42501'; end if;
   end loop;
   if found_row then
     update public.outfits set name=p_value->>'title',cover_image=case when p_value->>'imageUrl' ~ '^https://' then p_value->>'imageUrl' else null end where id=p_id and user_id=who;
     get diagnostics affected=row_count;
     if affected<>1 then raise exception 'Outfit update unverified'; end if;
   else
     insert into public.outfits(id,user_id,name,cover_image,created_at) values(p_id,who,p_value->>'title',
       case when p_value->>'imageUrl' ~ '^https://' then p_value->>'imageUrl' else null end,(p_value->>'createdAt')::timestamptz);
   end if;
   delete from public.outfit_items where outfit_id=p_id;
   for reference in select value::uuid from jsonb_array_elements_text(p_value->'wardrobeItemIds') loop
     insert into public.outfit_items(outfit_id,source_type,wardrobe_item_id,position) values(p_id,'wardrobe',reference,position); position:=position+1;
   end loop;
   for product in select value from jsonb_array_elements_text(p_value->'catalogProductIds') loop
     insert into public.outfit_items(outfit_id,source_type,product_id,position) values(p_id,'catalog',product,position); position:=position+1;
   end loop;
 end if;
 return 'applied';
end $function$;

create or replace function public.wardrobe_cloud_snapshot(p_owner uuid)
 returns jsonb
 language plpgsql
 stable
 set search_path to 'pg_catalog', 'public'
as $function$
declare who uuid:=auth.uid(); result jsonb;
begin
 if who is null or who is distinct from p_owner then raise exception 'Wardrobe owner mismatch' using errcode='42501'; end if;
 -- A truncated snapshot must never be treated as authoritative absence.
 if (select count(*) from public.wardrobe_items where user_id=who)>1000
   or (select count(*) from public.outfits where user_id=who)>1000
   or (select count(*) from public.outfit_items i join public.outfits o on o.id=i.outfit_id where o.user_id=who)>10000 then
   raise exception 'Wardrobe snapshot exceeds bounded inventory'; end if;
 select jsonb_build_object('owner',who,'photoVersion',1,
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'title',w.name,'brand',coalesce(w.brand,''),
      'category',w.category,'imageUrl',w.image_url,'imageStoragePath',w.image_storage_path,'createdAt',w.created_at,'updatedAt',w.updated_at)
      -- NULL style fields are omitted, never sent as null, so clients keep their local value.
      || jsonb_strip_nulls(jsonb_build_object('subcategory',w.subcategory,'color',w.color)) order by w.created_at,w.id)
      from public.wardrobe_items w where w.user_id=who),'[]'::jsonb),
   'outfits',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'title',o.name,'createdAt',o.created_at,'updatedAt',o.updated_at,
      'imageUrl',o.cover_image,
      'wardrobeItemIds',coalesce((select jsonb_agg(i.wardrobe_item_id order by i.position,i.id) from public.outfit_items i where i.outfit_id=o.id and i.source_type='wardrobe'),'[]'::jsonb),
      'catalogProductIds',coalesce((select jsonb_agg(i.product_id order by i.position,i.id) from public.outfit_items i where i.outfit_id=o.id and i.source_type='catalog'),'[]'::jsonb)) order by o.created_at,o.id)
      from public.outfits o where o.user_id=who),'[]'::jsonb)) into result;
 return result;
end $function$;

do $$ declare before record; after record; begin
 for before in select * from wardrobe_style_fields_before loop
   select p.prosecdef, p.proconfig, p.proacl::text as acl, p.proowner, p.provolatile, p.prosrc into after
   from pg_proc p where p.oid=before.fn_oid;
   if not found or after.proowner<>before.proowner or after.acl is distinct from before.acl
   then raise exception 'WARDROBE_STYLE_FIELDS_ACL %', before.proname; end if;
   if after.prosecdef<>before.prosecdef or after.proconfig is distinct from before.proconfig or after.provolatile<>before.provolatile
   then raise exception 'WARDROBE_STYLE_FIELDS_SECURITY %', before.proname; end if;
   -- cutout_v2 wrappers (present only where 202610210001_cutout_v2 is installed) must be byte-identical
   -- and still delegate to the replaced V1 functions with their own elevated rights intact.
   if before.proname like '%\_v2' and (after.prosrc<>before.prosrc or not after.prosecdef
      or after.prosrc not like '%public.wardrobe_%(%' or not has_function_privilege('authenticated',before.fn_oid,'EXECUTE'))
   then raise exception 'WARDROBE_STYLE_FIELDS_V2_WRAPPER %', before.proname; end if;
 end loop;
 if not has_function_privilege('authenticated','public.wardrobe_apply_change(uuid,text,uuid,timestamptz,jsonb)','EXECUTE')
   or not has_function_privilege('authenticated','public.wardrobe_cloud_snapshot(uuid)','EXECUTE')
   or has_function_privilege('anon','public.wardrobe_apply_change(uuid,text,uuid,timestamptz,jsonb)','EXECUTE')
   or has_function_privilege('anon','public.wardrobe_cloud_snapshot(uuid)','EXECUTE')
 then raise exception 'WARDROBE_STYLE_FIELDS_ACL execute'; end if;
 if not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.wardrobe_items')
   and tgname='account_deletion_fence' and tgenabled in ('O','A'))
 then raise exception 'WARDROBE_STYLE_FIELDS_FENCE after'; end if;
end $$;

commit;

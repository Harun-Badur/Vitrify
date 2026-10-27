# Dolap bulut senkronu: canlı şema okuması (READ-ONLY)

Kaynak: `scripts/queries/wardrobe_cloud_sync_readiness.sql`, proje `hnujkabyyrlsxohjhxlg`, 2026-10-27. Yalnız katalog SELECT; veri satırı okunmadı.

## public.wardrobe_items kolonları

| kolon | tip | null |
|---|---|---|
| brand | text | YES |
| category | text | NO |
| color | text | YES |
| created_at | timestamp with time zone | NO |
| id | uuid | NO |
| image_storage_path | text | YES |
| image_url | text | NO |
| name | text | NO |
| notes | text | YES |
| pattern | text | YES |
| season | text | YES |
| secondary_colors | jsonb | NO |
| size | text | YES |
| style_tags | jsonb | NO |
| subcategory | text | YES |
| updated_at | timestamp with time zone | NO |
| user_id | uuid | NO |

Kısıtlar: subcategory ve color üzerinde CHECK yok. Tetikleyiciler: `account_deletion_fence`, `trg_wardrobe_items_updated_at`.

## wardrobe_apply_change

```sql
CREATE OR REPLACE FUNCTION public.wardrobe_apply_change(p_owner uuid, p_kind text, p_id uuid, p_expected timestamp with time zone, p_value jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare who uuid:=auth.uid(); current_version timestamptz; found_row boolean; affected integer; reference uuid; product text; position integer:=0; linked uuid[];
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
   if found_row then
     update public.wardrobe_items set name=p_value->>'title',image_url=p_value->>'imageUrl',image_storage_path=p_value->>'imageStoragePath',category=p_value->>'category',brand=coalesce(p_value->>'brand','')
       where id=p_id and user_id=who;
     get diagnostics affected=row_count;
     if affected<>1 then raise exception 'Wardrobe update unverified'; end if;
   else
     insert into public.wardrobe_items(id,user_id,name,image_url,image_storage_path,category,brand,created_at)
       values(p_id,who,p_value->>'title',p_value->>'imageUrl',p_value->>'imageStoragePath',p_value->>'category',coalesce(p_value->>'brand',''),(p_value->>'createdAt')::timestamptz);
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
end $function$
```

## wardrobe_cloud_snapshot

```sql
CREATE OR REPLACE FUNCTION public.wardrobe_cloud_snapshot(p_owner uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
      'category',w.category,'imageUrl',w.image_url,'imageStoragePath',w.image_storage_path,'createdAt',w.created_at,'updatedAt',w.updated_at) order by w.created_at,w.id)
      from public.wardrobe_items w where w.user_id=who),'[]'::jsonb),
   'outfits',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'title',o.name,'createdAt',o.created_at,'updatedAt',o.updated_at,
      'imageUrl',o.cover_image,
      'wardrobeItemIds',coalesce((select jsonb_agg(i.wardrobe_item_id order by i.position,i.id) from public.outfit_items i where i.outfit_id=o.id and i.source_type='wardrobe'),'[]'::jsonb),
      'catalogProductIds',coalesce((select jsonb_agg(i.product_id order by i.position,i.id) from public.outfit_items i where i.outfit_id=o.id and i.source_type='catalog'),'[]'::jsonb)) order by o.created_at,o.id)
      from public.outfits o where o.user_id=who),'[]'::jsonb)) into result;
 return result;
end $function$
```

-- Existing isolated runner only (-BackendMedia, after 202610270001_wardrobe_style_fields_sync.sql); synthetic claims.
begin;
select style_test.ok(not (select prosecdef from pg_proc where oid='public.wardrobe_apply_change(uuid,text,uuid,timestamptz,jsonb)'::regprocedure)
 and not (select prosecdef from pg_proc where oid='public.wardrobe_cloud_snapshot(uuid)'::regprocedure),'STYLE_RPC_STAYS_INVOKER');
select style_test.ok(has_function_privilege('authenticated','public.wardrobe_apply_change(uuid,text,uuid,timestamptz,jsonb)','EXECUTE')
 and not has_function_privilege('anon','public.wardrobe_apply_change(uuid,text,uuid,timestamptz,jsonb)','EXECUTE')
 and has_function_privilege('authenticated','public.wardrobe_cloud_snapshot(uuid)','EXECUTE')
 and not has_function_privilege('anon','public.wardrobe_cloud_snapshot(uuid)','EXECUTE'),'STYLE_RPC_ACL_UNCHANGED');
select style_test.ok(exists(select 1 from pg_trigger where tgrelid='public.wardrobe_items'::regclass and tgname='account_deletion_fence' and tgenabled in ('O','A')),'STYLE_FENCE_TRIGGER_KEPT');
set local role authenticated;
select style_test.claim('A');
select style_test.ok(public.wardrobe_apply_change(auth.uid(),'item','66666666-6666-4666-8666-666666666666',null,
 jsonb_build_object('title','Gömlek','imageUrl','https://images.example/top.jpg','category','upper_body','brand','',
  'subcategory','gomlek','color','siyah','createdAt',clock_timestamp()))='applied','STYLE_FIELDS_WRITTEN');
select style_test.ok((select subcategory='gomlek' and color='siyah' from public.wardrobe_items where id='66666666-6666-4666-8666-666666666666'),'STYLE_FIELDS_STORED');
select style_test.ok(public.wardrobe_cloud_snapshot(auth.uid())->'items'->0 @> '{"subcategory":"gomlek","color":"siyah"}','STYLE_FIELDS_RETURNED');
-- Old client: same item, no style keys -> stored values survive.
select style_test.ok(public.wardrobe_apply_change(auth.uid(),'item','66666666-6666-4666-8666-666666666666',
 (public.wardrobe_cloud_snapshot(auth.uid())->'items'->0->>'updatedAt')::timestamptz,
 jsonb_build_object('title','Yeni ad','imageUrl','https://images.example/top.jpg','category','upper_body','brand',''))='applied','KEYLESS_UPDATE_APPLIED');
select style_test.ok((select name='Yeni ad' and subcategory='gomlek' and color='siyah' from public.wardrobe_items where id='66666666-6666-4666-8666-666666666666'),'KEYLESS_UPDATE_PRESERVES_FIELDS');
-- Explicit empty string clears to NULL; snapshot omits the key instead of returning null.
select style_test.ok(public.wardrobe_apply_change(auth.uid(),'item','66666666-6666-4666-8666-666666666666',
 (public.wardrobe_cloud_snapshot(auth.uid())->'items'->0->>'updatedAt')::timestamptz,
 jsonb_build_object('title','Yeni ad','imageUrl','https://images.example/top.jpg','category','upper_body','brand','','color',''))='applied','EMPTY_COLOR_APPLIED');
select style_test.ok((select color is null and subcategory='gomlek' from public.wardrobe_items where id='66666666-6666-4666-8666-666666666666'),'EMPTY_STRING_STORED_AS_NULL');
select style_test.ok(not (public.wardrobe_cloud_snapshot(auth.uid())->'items'->0 ? 'color'),'NULL_FIELD_OMITTED_FROM_SNAPSHOT');
-- Old client insert without keys -> NULL columns, no keys in snapshot.
select style_test.ok(public.wardrobe_apply_change(auth.uid(),'item','77777777-7777-4777-8777-777777777771',null,
 jsonb_build_object('title','Eski','imageUrl','https://images.example/old.jpg','category','lower_body','brand','','createdAt',clock_timestamp()))='applied','OLD_CLIENT_INSERT_APPLIED');
select style_test.ok((select subcategory is null and color is null from public.wardrobe_items where id='77777777-7777-4777-8777-777777777771'),'OLD_CLIENT_INSERT_NULLS');
-- Format-only server validation; nothing is written on rejection.
select style_test.denied($command$select public.wardrobe_apply_change(auth.uid(),'item','77777777-7777-4777-8777-777777777772',null,
 '{"title":"X","imageUrl":"https://images.example/x.jpg","category":"upper_body","brand":"","color":"Siyah","createdAt":"2026-10-27T00:00:00Z"}')$command$,'Invalid wardrobe style field','UPPERCASE_SLUG_DENIED');
select style_test.denied($command$select public.wardrobe_apply_change(auth.uid(),'item','77777777-7777-4777-8777-777777777772',null,
 jsonb_build_object('title','X','imageUrl','https://images.example/x.jpg','category','upper_body','brand','','subcategory',repeat('a',41),'createdAt','2026-10-27T00:00:00Z'))$command$,'Invalid wardrobe style field','LONG_SLUG_DENIED');
select style_test.denied($command$select public.wardrobe_apply_change(auth.uid(),'item','77777777-7777-4777-8777-777777777772',null,
 '{"title":"X","imageUrl":"https://images.example/x.jpg","category":"upper_body","brand":"","color":"kırmızı","createdAt":"2026-10-27T00:00:00Z"}')$command$,'Invalid wardrobe style field','NON_ASCII_SLUG_DENIED');
select style_test.denied($command$select public.wardrobe_apply_change(auth.uid(),'item','77777777-7777-4777-8777-777777777772',null,
 '{"title":"X","imageUrl":"https://images.example/x.jpg","category":"upper_body","brand":"","color":42,"createdAt":"2026-10-27T00:00:00Z"}')$command$,'Invalid wardrobe style field','NON_STRING_SLUG_DENIED');
select style_test.denied($command$select public.wardrobe_apply_change(auth.uid(),'item','66666666-6666-4666-8666-666666666666',
 (public.wardrobe_cloud_snapshot(auth.uid())->'items'->0->>'updatedAt')::timestamptz,
 '{"title":"Bozuk","imageUrl":"https://images.example/top.jpg","category":"upper_body","brand":"","subcategory":"Gömlek"}')$command$,'Invalid wardrobe style field','INVALID_UPDATE_DENIED');
select style_test.ok(not exists(select 1 from public.wardrobe_items where id='77777777-7777-4777-8777-777777777772')
 and (select name='Yeni ad' and subcategory='gomlek' from public.wardrobe_items where id='66666666-6666-4666-8666-666666666666'),'REJECTION_WRITES_NOTHING');
select style_test.claim('B');
select style_test.ok(jsonb_array_length(public.wardrobe_cloud_snapshot(auth.uid())->'items')=0,'STYLE_FIELDS_OTHER_OWNER_EMPTY');
reset role;
rollback;
select style_test.ok(not exists(select 1 from public.wardrobe_items where id in ('66666666-6666-4666-8666-666666666666','77777777-7777-4777-8777-777777777771')),'STYLE_TEST_ROWS_ROLLED_BACK');

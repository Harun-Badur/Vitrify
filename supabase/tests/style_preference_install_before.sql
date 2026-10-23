-- Use the exact copied dependency bodies, with only the relevant live triggers.
create trigger deletion_seed_owner before insert on auth.users for each row execute function deletion_private.seed_owner();
create trigger deletion_auth_metadata_fence before update on auth.users for each row execute function deletion_private.block_owned_write('id');
do $$ declare name text; begin
  foreach name in array array['liked_products','passed_products','user_events','user_style_profiles','profiles','users'] loop
    execute format('create trigger account_deletion_fence before insert or update on public.%I for each row execute function deletion_private.block_owned_write(%L)',name,case when name in ('users','profiles') then 'id' else 'user_id' end);
  end loop;
end $$;
update public.product_attributes set colors=array['beyaz'] where product_id='fixture-2';
insert into public.user_events(event_id,user_id,session_id,event_type,product_id,payload,created_at) values
 ('90000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','like','fixture-1','{"action_id":"90000000-0000-4000-8000-000000000099"}',now()-interval '3 days'),
 ('90000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','dolap_add','fixture-1','{"action_id":"90000000-0000-4000-8000-000000000099"}',now()-interval '3 days'),
 ('90000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','like','fixture-2','{}',now()-interval '1 day'),
 ('90000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','pass','fixture-3','{}',now());
do $$ begin perform style_test.claim('A');perform public.recompute_profile(auth.uid());end $$;
insert into style_test.install_baseline select
 (select prosrc from pg_proc where oid='public.recompute_profile(uuid)'::regprocedure),
 (select proacl::text from pg_proc where oid='public.recompute_profile(uuid)'::regprocedure),
 (select jsonb_agg(to_jsonb(p) order by user_id) from public.user_style_profiles p),
 (select jsonb_agg(to_jsonb(e) order by event_id) from public.user_events e);

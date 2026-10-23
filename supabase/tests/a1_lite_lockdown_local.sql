-- Synthetic PostgreSQL role/RLS fixture only, NOT JWT/Storage HTTP behavior.
begin;
set local role authenticated;
do $$ begin
  begin insert into storage.objects values ('model-photos','A/new.jpg');
    raise exception 'Protected INSERT allowed'; exception when insufficient_privilege then null; end;
  begin insert into storage.objects values ('wardrobe-cutouts','A/new.png');
    raise exception 'Cutout INSERT allowed'; exception when insufficient_privilege then null; end;
  if exists(select 1 from storage.objects where bucket_id='model-photos') is not true then
    raise exception 'Existing SELECT broken'; end if;
  update storage.objects set name='modified' where bucket_id='model-photos';
  if found then raise exception 'Protected UPDATE allowed'; end if;
  delete from storage.objects where bucket_id='wardrobe-cutouts';
  if found then raise exception 'Protected DELETE allowed'; end if;
  insert into storage.objects values ('other-bucket','allowed.jpg');
  begin update storage.objects set bucket_id='model-photos' where bucket_id='other-bucket';
    raise exception 'Move into protected bucket allowed'; exception when insufficient_privilege then null; end;
  update storage.objects set bucket_id='other-bucket' where bucket_id='model-photos';
  if found then raise exception 'Move out of protected bucket allowed'; end if;
  update storage.objects set name='changed.jpg' where bucket_id='other-bucket';
  if not found then raise exception 'Other bucket UPDATE broken'; end if;
  delete from storage.objects where bucket_id='other-bucket';
  if not found then raise exception 'Other bucket DELETE broken'; end if;
  raise notice 'PASS authenticated INSERT/UPDATE/DELETE denied; SELECT and other bucket retained; moves denied';
end $$;
set local role anon;
do $$ begin
  begin insert into storage.objects values ('model-photos','anonymous.jpg');
    raise exception 'Anonymous INSERT allowed'; exception when insufficient_privilege then null; end;
  begin insert into storage.objects values ('wardrobe-cutouts','anonymous.png');
    raise exception 'Anonymous cutout INSERT allowed'; exception when insufficient_privilege then null; end;
  raise notice 'PASS anon protected INSERT denied despite permissive policy';
end $$;
set local role service_role;
do $$ begin
  insert into storage.objects values ('model-photos','A/service.jpg');
  insert into storage.objects values ('wardrobe-cutouts','B/service.png');
  raise notice 'PASS modeled BYPASSRLS service can write both owners; separate server owner fence mandatory';
end $$;
reset role;
rollback;
do $$ begin
  if (select count(*) from storage.objects)<>2 or exists(select 1 from storage.objects where name<>'original') then
    raise exception 'Fixture rollback failed'; end if;
  raise notice 'PASS fixture data unchanged after rollback';
end $$;

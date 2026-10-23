-- Explicit decision ONLY inside newly created synthetic local DB.
update public.recs_config set value=value||'{"rollback_to_v1_approved":true}' where key='style_profile_v2';

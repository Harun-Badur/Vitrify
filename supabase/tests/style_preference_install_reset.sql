-- Only the new runner-owned synthetic database. Restore baseline regression inputs.
truncate public.style_preference_actions,public.liked_products,public.passed_products,public.user_events,public.user_style_profiles;
update deletion_private.owner_gates set fenced=false;
update public.product_attributes set colors=array['siyah'];

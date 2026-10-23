-- LOCAL PROPOSAL ONLY. Not applied. Gate 1 Q16A/Q16B identified PUBLIC EXECUTE.
-- Exact existing signature; no function body, limits, auth or quota logic change.
begin;
revoke execute on function public.consume_vton_quota(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_vton_quota(uuid, integer, integer)
  to service_role;
commit;

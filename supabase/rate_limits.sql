-- =============================================================================
-- Kabin — VTON kota tablosu (Edge Function rate limit)
-- SQL Editor'e TAMAMINI yapıştırıp Run.
-- Önkoşul: schema.sql (auth.users mevcut).
-- =============================================================================
-- Kota: kullanıcı başına dakikada 3, günde 20 sanal deneme.
-- Sayaçlar yalnızca service_role (Edge Function) tarafından güncellenir;
-- istemcinin bu tabloya hiçbir erişimi yoktur (RLS açık, policy yok).
-- =============================================================================

create table if not exists public.rate_limits (
  user_id uuid primary key references auth.users (id) on delete cascade,
  minute_window timestamptz not null default date_trunc('minute', now()),
  minute_count integer not null default 0,
  day_window date not null default current_date,
  day_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.rate_limits enable row level security;

-- Policy tanımlanmadı: authenticated/anon rolleri okuyamaz ve yazamaz.
-- service_role RLS'i baypas ettiği için Edge Function çalışmaya devam eder.
revoke all on public.rate_limits from anon, authenticated;
grant all on public.rate_limits to service_role;

-- Atomik kota tüketimi. Aynı kullanıcıdan gelen paralel istekler
-- satır kilidi altında sayıldığı için yarış koşulu oluşmaz.
create or replace function public.consume_vton_quota(
  p_user_id uuid,
  p_minute_limit integer default 3,
  p_day_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_minute timestamptz := date_trunc('minute', v_now);
  v_today date := (v_now at time zone 'UTC')::date;
  v_minute_count integer;
  v_day_count integer;
begin
  insert into public.rate_limits as rl (
    user_id, minute_window, minute_count, day_window, day_count, updated_at
  )
  values (p_user_id, v_minute, 0, v_today, 0, v_now)
  on conflict (user_id) do update
    set minute_window = case
          when rl.minute_window = v_minute then rl.minute_window
          else v_minute
        end,
        minute_count = case
          when rl.minute_window = v_minute then rl.minute_count
          else 0
        end,
        day_window = case
          when rl.day_window = v_today then rl.day_window
          else v_today
        end,
        day_count = case
          when rl.day_window = v_today then rl.day_count
          else 0
        end,
        updated_at = v_now
  returning rl.minute_count, rl.day_count
  into v_minute_count, v_day_count;

  if v_day_count >= p_day_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'daily_limit',
      'retry_after_seconds',
      greatest(1, ceil(extract(epoch from ((v_today + 1)::timestamptz - v_now)))::integer)
    );
  end if;

  if v_minute_count >= p_minute_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'minute_limit',
      'retry_after_seconds',
      greatest(1, ceil(extract(epoch from (v_minute + interval '1 minute' - v_now)))::integer)
    );
  end if;

  update public.rate_limits
  set minute_count = minute_count + 1,
      day_count = day_count + 1,
      updated_at = v_now
  where user_id = p_user_id;

  return jsonb_build_object(
    'allowed', true,
    'minute_count', v_minute_count + 1,
    'day_count', v_day_count + 1
  );
end;
$$;

-- Function EXECUTE defaults to PUBLIC; revoking only named client roles is insufficient.
revoke execute on function public.consume_vton_quota(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_vton_quota(uuid, integer, integer)
  to service_role;

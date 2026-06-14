create table if not exists public.ad_reward_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  idempotency_key text not null,
  ad_unit_id text not null,
  reward_type text not null default 'cache_key',
  reward_amount integer not null default 1,
  status text not null default 'granted',
  granted_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint ad_reward_grants_status_check check (status in ('granted', 'rejected')),
  constraint ad_reward_grants_reward_type_check check (reward_type in ('cache_key')),
  constraint ad_reward_grants_reward_amount_check check (reward_amount = 1),
  unique (user_id, idempotency_key)
);

alter table public.ad_reward_grants enable row level security;

drop policy if exists "ad_reward_grants_select_own" on public.ad_reward_grants;
create policy "ad_reward_grants_select_own"
  on public.ad_reward_grants
  for select
  to authenticated
  using (user_id = auth.uid());

revoke all on table public.ad_reward_grants from public, anon;
grant select on table public.ad_reward_grants to authenticated;
grant all on table public.ad_reward_grants to service_role;

create or replace function public.cc_claim_rewarded_cache_key(
  nonce text,
  ad_unit_id text,
  reward_source text default 'admob_rewarded'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  prior jsonb;
  p public.profiles%rowtype;
  grant_count integer;
  result jsonb;
  clean_ad_unit_id text := nullif(trim(coalesce(ad_unit_id, '')), '');
  clean_reward_source text := nullif(trim(coalesce(reward_source, 'admob_rewarded')), '');
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if clean_ad_unit_id is null then raise exception 'ad_unit_id is required'; end if;

  select result_payload into prior
  from public.verified_action_ledger
  where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select count(*) into grant_count
  from public.ad_reward_grants
  where user_id = actor
    and reward_type = 'cache_key'
    and status = 'granted'
    and granted_at >= date_trunc('day', now());

  if grant_count >= 3 then
    raise exception 'Daily rewarded cache key limit reached';
  end if;

  if exists (
    select 1
    from public.ad_reward_grants
    where user_id = actor
      and reward_type = 'cache_key'
      and status = 'granted'
      and granted_at > now() - interval '5 minutes'
  ) then
    raise exception 'Rewarded cache key cooldown active';
  end if;

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  update public.profiles
     set cache_tokens = cache_tokens + 1,
         updated_at = now()
   where id = actor
   returning * into p;

  insert into public.ad_reward_grants (
    user_id,
    idempotency_key,
    ad_unit_id,
    reward_type,
    reward_amount,
    status,
    metadata
  ) values (
    actor,
    nonce,
    clean_ad_unit_id,
    'cache_key',
    1,
    'granted',
    jsonb_build_object('source', coalesce(clean_reward_source, 'admob_rewarded'))
  );

  result := jsonb_build_object(
    'action_type', 'cc_claim_rewarded_cache_key',
    'profile', public.cc_profile_snapshot(p),
    'reward_type', 'cache_key',
    'reward_amount', 1,
    'daily_grants_used', grant_count + 1
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_claim_rewarded_cache_key', nonce, result);

  return result;
end;
$$;

revoke execute on function public.cc_claim_rewarded_cache_key(text, text, text) from public, anon;
grant execute on function public.cc_claim_rewarded_cache_key(text, text, text) to authenticated, service_role;

create table if not exists public.user_push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null unique,
  platform text not null default 'android',
  app_version text,
  enabled boolean not null default true,
  last_registered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint user_push_devices_platform_check check (platform in ('android', 'ios', 'web'))
);

alter table public.user_push_devices enable row level security;

drop policy if exists "user_push_devices_select_own" on public.user_push_devices;
create policy "user_push_devices_select_own"
  on public.user_push_devices
  for select
  to authenticated
  using (user_id = auth.uid());

revoke all on table public.user_push_devices from public, anon;
grant select on table public.user_push_devices to authenticated;
grant all on table public.user_push_devices to service_role;

create table if not exists public.user_notification_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  offline_rewards boolean not null default true,
  crafting_complete boolean not null default true,
  marketplace_events boolean not null default true,
  cache_ready boolean not null default true,
  limited_events boolean not null default false,
  inactivity_nudges boolean not null default false,
  quiet_hours_start time,
  quiet_hours_end time,
  updated_at timestamptz not null default now()
);

alter table public.user_notification_settings enable row level security;

drop policy if exists "user_notification_settings_select_own" on public.user_notification_settings;
create policy "user_notification_settings_select_own"
  on public.user_notification_settings
  for select
  to authenticated
  using (user_id = auth.uid());

revoke all on table public.user_notification_settings from public, anon;
grant select on table public.user_notification_settings to authenticated;
grant all on table public.user_notification_settings to service_role;

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null,
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint notification_events_category_check check (category in ('offline_rewards', 'crafting_complete', 'marketplace_events', 'cache_ready', 'limited_events', 'inactivity_nudges', 'system')),
  constraint notification_events_status_check check (status in ('queued', 'sent', 'failed', 'skipped'))
);

alter table public.notification_events enable row level security;

drop policy if exists "notification_events_select_own" on public.notification_events;
create policy "notification_events_select_own"
  on public.notification_events
  for select
  to authenticated
  using (user_id = auth.uid());

revoke all on table public.notification_events from public, anon;
grant select on table public.notification_events to authenticated;
grant all on table public.notification_events to service_role;

create or replace function public.cc_register_push_device(
  push_token text,
  platform text default 'android',
  app_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  device public.user_push_devices%rowtype;
  normalized_platform text := lower(coalesce(platform, 'android'));
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if push_token is null or length(trim(push_token)) < 16 then raise exception 'token is required'; end if;
  if normalized_platform not in ('android', 'ios', 'web') then normalized_platform := 'android'; end if;

  insert into public.user_push_devices (
    user_id,
    token,
    platform,
    app_version,
    enabled,
    last_registered_at,
    last_seen_at,
    disabled_at
  ) values (
    actor,
    trim(push_token),
    normalized_platform,
    app_version,
    true,
    now(),
    now(),
    null
  )
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        app_version = excluded.app_version,
        enabled = true,
        last_registered_at = now(),
        last_seen_at = now(),
        disabled_at = null
  returning * into device;

  insert into public.user_notification_settings(user_id)
  values (actor)
  on conflict (user_id) do nothing;

  return jsonb_build_object(
    'action_type', 'cc_register_push_device',
    'device', to_jsonb(device)
  );
end;
$$;

revoke execute on function public.cc_register_push_device(text, text, text) from public, anon;
grant execute on function public.cc_register_push_device(text, text, text) to authenticated, service_role;

create or replace function public.cc_disable_push_device(push_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if push_token is null or length(trim(push_token)) < 16 then raise exception 'token is required'; end if;

  update public.user_push_devices
     set enabled = false,
         disabled_at = now(),
         last_seen_at = now()
   where user_id = actor
     and token = trim(push_token);

  return jsonb_build_object('action_type', 'cc_disable_push_device');
end;
$$;

revoke execute on function public.cc_disable_push_device(text) from public, anon;
grant execute on function public.cc_disable_push_device(text) to authenticated, service_role;

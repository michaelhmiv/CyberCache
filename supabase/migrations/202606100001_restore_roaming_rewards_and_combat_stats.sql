-- Restore runtime backend pieces used by the live idle ticker.
-- The client currently calls cc_claim_roaming_rewards every 3 seconds during
-- roaming and persists combat telemetry through public.combat_stats.

create table if not exists public.combat_stats (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  total_kills bigint not null default 0 check (total_kills >= 0),
  total_deaths bigint not null default 0 check (total_deaths >= 0),
  longest_kill_streak bigint not null default 0 check (longest_kill_streak >= 0),
  last_kill_at timestamptz,
  run_started_at timestamptz,
  kills_by_area jsonb not null default '{}'::jsonb,
  kills_by_weapon_type jsonb not null default '{}'::jsonb,
  kills_by_boss jsonb not null default '{}'::jsonb,
  kills_by_element jsonb not null default '{}'::jsonb,
  highest_boss_tier integer not null default 0 check (highest_boss_tier >= 0),
  active_play_seconds bigint not null default 0 check (active_play_seconds >= 0),
  idle_play_seconds bigint not null default 0 check (idle_play_seconds >= 0),
  updated_at timestamptz not null default now()
);

alter table public.combat_stats enable row level security;

drop policy if exists combat_stats_select_own on public.combat_stats;
create policy combat_stats_select_own on public.combat_stats
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists combat_stats_insert_own on public.combat_stats;
create policy combat_stats_insert_own on public.combat_stats
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists combat_stats_update_own on public.combat_stats;
create policy combat_stats_update_own on public.combat_stats
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.cc_claim_roaming_rewards(
  nonce text,
  ticks integer default 1,
  area_id text default null
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
  safe_ticks integer := least(20, greatest(1, coalesce(ticks, 1)));
  xp_award bigint := safe_ticks;
  credit_award bigint := safe_ticks * 10;
  scrap_award bigint := safe_ticks * 2;
  fragment_award integer := case when safe_ticks >= 10 then 1 else 0 end;
  xp_state jsonb;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior
  from public.verified_action_ledger vl
  where vl.user_id = actor and vl.idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  xp_state := public.cc_apply_xp(p.player_level, p.player_xp, xp_award);

  update public.profiles
  set player_level = (xp_state ->> 'player_level')::integer,
      player_xp = (xp_state ->> 'player_xp')::bigint,
      credits = credits + credit_award,
      scrap = scrap + scrap_award,
      cache_token_parts = cache_token_parts + fragment_award,
      updated_at = now()
  where id = actor
  returning * into p;

  result := jsonb_build_object(
    'action_type', 'cc_claim_roaming_rewards',
    'area_id', nullif(area_id, ''),
    'ticks', safe_ticks,
    'xp_awarded', xp_award,
    'credits_awarded', credit_award,
    'scrap_awarded', scrap_award,
    'cache_fragments_awarded', fragment_award,
    'materials', '{}'::jsonb,
    'essences', '{}'::jsonb,
    'profile', public.cc_profile_snapshot(p)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_claim_roaming_rewards', nonce, result);

  return result;
end;
$$;

revoke execute on function public.cc_claim_roaming_rewards(text, integer, text) from public, anon;
grant execute on function public.cc_claim_roaming_rewards(text, integer, text) to authenticated, service_role;

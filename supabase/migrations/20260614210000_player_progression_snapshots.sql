-- Migration 20260614210000: Player progression snapshots

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.player_progression_snapshots (
  id bigint generated always as identity primary key,
  player_id uuid not null references auth.users(id) on delete cascade,
  snapshot_at timestamptz not null default now(),
  source text not null,
  snapshot_version int not null default 1,
  level int,
  xp bigint,
  credits bigint,
  scrap bigint,
  total_kills bigint,
  total_deaths bigint,
  net_worth bigint,
  total_items int,
  weapons_owned int,
  legendary_items int,
  highest_item_level int,
  total_mastery_xp bigint,
  highest_mastery_level int,
  highest_boss_tier int,
  active_action text,
  metadata jsonb default '{}'::jsonb
);

create index if not exists idx_player_progression_snapshots_player_time
  on public.player_progression_snapshots (player_id, snapshot_at desc);

create index if not exists idx_player_progression_snapshots_source_time
  on public.player_progression_snapshots (source, snapshot_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.player_progression_snapshots enable row level security;

drop policy if exists "Players read own snapshots" on public.player_progression_snapshots;
create policy "Players read own snapshots"
  on public.player_progression_snapshots
  for select
  to authenticated
  using (player_id = auth.uid());

drop policy if exists "Service role inserts snapshots" on public.player_progression_snapshots;
create policy "Service role inserts snapshots"
  on public.player_progression_snapshots
  for insert
  to service_role
  with check (true);

-- ---------------------------------------------------------------------------
-- Snapshot computation
-- ---------------------------------------------------------------------------
create or replace function public.cc_compute_player_snapshot(_player_id uuid)
returns public.player_progression_snapshots
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_stats public.player_public_stats%rowtype;
  v_snapshot public.player_progression_snapshots;
  v_runtime public.player_runtime_snapshots%rowtype;
  v_action text;
begin
  select * into v_stats
  from public.player_public_stats
  where user_id = _player_id;

  select * into v_runtime
  from public.player_runtime_snapshots
  where user_id = _player_id
  order by snapshot_at desc
  limit 1;

  select coalesce(public_payload->>'activity_label', active_action)
  into v_action
  from public.active_actions
  where user_id = _player_id
  order by updated_at desc
  limit 1;

  v_snapshot.player_id := _player_id;
  v_snapshot.snapshot_at := now();
  v_snapshot.level := v_runtime.level;
  v_snapshot.xp := v_runtime.xp;
  v_snapshot.credits := v_runtime.credits;
  v_snapshot.scrap := v_runtime.scrap;
  v_snapshot.total_kills := v_stats.total_kills;
  v_snapshot.total_deaths := v_stats.total_deaths;
  v_snapshot.net_worth := v_stats.net_worth;
  v_snapshot.total_items := v_stats.total_items;
  v_snapshot.weapons_owned := v_stats.weapons_owned;
  v_snapshot.legendary_items := v_stats.legendary_items;
  v_snapshot.highest_item_level := v_stats.highest_item_level;
  v_snapshot.total_mastery_xp := v_stats.total_mastery_xp;
  v_snapshot.highest_mastery_level := v_stats.highest_mastery_level;
  v_snapshot.highest_boss_tier := v_stats.highest_boss_tier;
  v_snapshot.active_action := v_action;

  return v_snapshot;
end;
$$;

-- ---------------------------------------------------------------------------
-- Snapshot recording with source throttling
-- ---------------------------------------------------------------------------
create or replace function public.cc_record_player_snapshot(
  _player_id uuid,
  _source text,
  _metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot public.player_progression_snapshots%rowtype;
  v_new_id bigint;
  v_last_at timestamptz;
  v_min_interval interval := interval '5 minutes';
begin
  -- Throttle identical sources to avoid bursts.
  select snapshot_at into v_last_at
  from public.player_progression_snapshots
  where player_id = _player_id and source = _source
  order by snapshot_at desc
  limit 1;

  if v_last_at is not null and now() - v_last_at < v_min_interval then
    return null;
  end if;

  v_snapshot := public.cc_compute_player_snapshot(_player_id);
  v_snapshot.source := _source;
  v_snapshot.metadata := _metadata;

  insert into public.player_progression_snapshots (
    player_id, snapshot_at, source, snapshot_version,
    level, xp, credits, scrap, total_kills, total_deaths, net_worth,
    total_items, weapons_owned, legendary_items, highest_item_level,
    total_mastery_xp, highest_mastery_level, highest_boss_tier, active_action, metadata
  ) values (
    v_snapshot.player_id, v_snapshot.snapshot_at, v_snapshot.source, v_snapshot.snapshot_version,
    v_snapshot.level, v_snapshot.xp, v_snapshot.credits, v_snapshot.scrap,
    v_snapshot.total_kills, v_snapshot.total_deaths, v_snapshot.net_worth,
    v_snapshot.total_items, v_snapshot.weapons_owned, v_snapshot.legendary_items,
    v_snapshot.highest_item_level, v_snapshot.total_mastery_xp, v_snapshot.highest_mastery_level,
    v_snapshot.highest_boss_tier, v_snapshot.active_action, v_snapshot.metadata
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Daily heartbeat batch (called by Railway cron or Hermes cron)
-- ---------------------------------------------------------------------------
create or replace function public.cc_record_daily_heartbeats()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_id bigint;
  rec record;
begin
  for rec in
    select id
    from public.profiles
    where updated_at > now() - interval '7 days'
      and not exists (
        select 1 from public.player_progression_snapshots
        where player_id = profiles.id
          and source = 'daily_heartbeat'
          and snapshot_at > now() - interval '20 hours'
      )
  loop
    v_id := public.cc_record_player_snapshot(rec.id, 'daily_heartbeat');
    if v_id is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers / hooks
-- ---------------------------------------------------------------------------
-- Boss victories do not write to verified_action_ledger, so redefine the RPC
-- to record a progression snapshot before returning.
create or replace function public.cc_record_boss_victory(
  _player_id uuid,
  _boss_id text,
  _damage_dealt integer,
  _medkits_consumed integer,
  _duration_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  current_boss_state jsonb;
  result jsonb;
begin
  select * into p from public.profiles where id = _player_id;
  if not found then raise exception 'Profile not found'; end if;

  current_boss_state := coalesce(p.boss_state, '{}'::jsonb);

  update public.profiles
     set boss_state = current_boss_state ||
           jsonb_build_object(
             ('defeated_' || _boss_id), true,
             ('pity_' || _boss_id), 0,
             ('last_boss_victory', jsonb_build_object(
               'boss_id', _boss_id,
               'damage_dealt', _damage_dealt,
               'medkits_consumed', _medkits_consumed,
               'duration_ms', _duration_ms,
               'at', extract(epoch from now())::bigint
             ))
           )
   where id = _player_id
   returning * into p;

  result := jsonb_build_object(
    'action_type', 'cc_record_boss_victory',
    'profile', public.cc_profile_snapshot(p),
    'boss_id', _boss_id
  );

  perform public.cc_record_player_snapshot(_player_id, 'boss_defeat', jsonb_build_object('boss_id', _boss_id));

  return result;
end;
$$;

revoke execute on function public.cc_record_boss_victory(uuid, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.cc_record_boss_victory(uuid, text, integer, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Authority
-- ---------------------------------------------------------------------------
revoke execute on function public.cc_compute_player_snapshot(uuid) from anon, authenticated, service_role;
grant execute on function public.cc_compute_player_snapshot(uuid) to service_role;

revoke execute on function public.cc_record_player_snapshot(uuid, text, jsonb) from anon, authenticated;
grant execute on function public.cc_record_player_snapshot(uuid, text, jsonb) to service_role;

revoke execute on function public.cc_record_daily_heartbeats() from anon, authenticated;
grant execute on function public.cc_record_daily_heartbeats() to service_role;

revoke all on table public.player_progression_snapshots from anon;
grant select on public.player_progression_snapshots to authenticated;
grant insert on public.player_progression_snapshots to service_role;

-- ---------------------------------------------------------------------------
-- Trigger: record snapshot on meaningful verified actions
-- This avoids redefining large Chef/settlement functions in this migration.
-- ---------------------------------------------------------------------------
create or replace function public.trg_record_snapshot_on_verified_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.action_type = 'cc_apply_chef_rewards' then
    perform public.cc_record_player_snapshot(new.user_id, 'chef_claim', jsonb_build_object('ledger_id', new.id));
  elsif new.action_type = 'cc_settle_offline_roaming' then
    perform public.cc_record_player_snapshot(new.user_id, 'settlement', jsonb_build_object('ledger_id', new.id));
  end if;
  return new;
end;
$$;

drop trigger if exists record_snapshot_on_verified_action on public.verified_action_ledger;
create trigger record_snapshot_on_verified_action
  after insert on public.verified_action_ledger
  for each row
  execute function public.trg_record_snapshot_on_verified_action();

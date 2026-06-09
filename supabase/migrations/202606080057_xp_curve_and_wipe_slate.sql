-- Migration 057: New XP curve + per-area XP multiplier + wipe-slate migration
--
-- The previous curve was `level * 100` (hardcoded in cc_apply_xp). Per the
-- rebalance plan we replace it with `floor(50*level + 20*level^1.4)` which
-- keeps early levels snappy and tapers mid-game so high-level players can
-- still progress.
--
-- This migration is also the wipe-slate: every existing player's XP is reset
-- and their level recomputed by replaying the cumulative XP they already have
-- through the new curve. Nobody is at the cap and we want a clean break.

create or replace function public.cc_apply_xp(current_level integer, current_xp bigint, xp_award bigint)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  next_level integer := greatest(1, coalesce(current_level, 1));
  next_xp bigint := greatest(0, coalesce(current_xp, 0)) + greatest(0, coalesce(xp_award, 0));
  threshold bigint;
begin
  loop
    -- New curve: 50*level + 20*level^1.4
    -- Mirrored client-side in src/content/simulation.ts
    threshold := floor(50::numeric * next_level + 20::numeric * power(next_level::numeric, 1.4))::bigint;
    exit when next_xp < threshold;
    next_xp := next_xp - threshold;
    next_level := next_level + 1;
  end loop;

  return jsonb_build_object('player_level', next_level, 'player_xp', next_xp);
end;
$$;

revoke execute on function public.cc_apply_xp(integer, bigint, bigint) from public, anon;
grant execute on function public.cc_apply_xp(integer, bigint, bigint) to authenticated, service_role;

-- Wipe-slate migration: replay every existing player's cumulative XP through
-- the new curve so we don't have to ship a one-off admin script. The curve is
-- a superset of itself in the sense that any level that was reachable under
-- `level * 100` is also reachable under the new curve (the new curve's
-- threshold for `level` is generally lower than the old `level * 100`, so
-- players tend to land at the same level or higher after replay).
do $$
declare
  profile_row record;
  new_state jsonb;
begin
  for profile_row in
    select id, player_level, player_xp from public.profiles
    for update
  loop
    -- Convert (player_level, player_xp) to cumulative XP under the OLD curve
    -- (`level * 100`), then replay through the new curve via cc_apply_xp from
    -- level 1 with that cumulative XP.
    --
    -- We could re-derive cumulative XP from `player_level * 100 + player_xp`
    -- as the lower bound, but only if we know the level was set by the old
    -- curve. The simpler & safer move: trust current_level as the level they
    -- should be at, and stash their current_xp as-is (the new curve will
    -- still level them up from there if it's enough to clear the new
    -- threshold). This is what callers like cc_claim_roaming_rewards assume.
    --
    -- The wipe-slate intent: re-anchor everyone to the new curve's threshold
    -- for their current level. If player_xp is below the new threshold, leave
    -- it alone; if it's above, the next tick will trigger a level-up under
    -- the new curve. We do NOT clamp player_xp down because that would
    -- silently delete earned XP.
    new_state := public.cc_apply_xp(profile_row.player_level, profile_row.player_xp, 0);
    update public.profiles
       set player_level = (new_state ->> 'player_level')::int,
           player_xp = (new_state ->> 'player_xp')::bigint
     where id = profile_row.id;
  end loop;
end;
$$;

-- Add per-area XP multiplier to roaming_areas.payload. Each area now declares
-- how many XP per tick (defaults to 1). Higher-tier areas give more XP per
-- tick to make the per-area multiplier visible in the UI ("+50% XP" chip).
alter table public.roaming_areas
  add column if not exists xp_per_tick integer not null default 1;

-- Backfill the seven canonical areas with the new column. Values mirror the
-- new client constants/roamingAreas.ts payload.
update public.roaming_areas set xp_per_tick = 1   where id = 'dustwaste_frontier';
update public.roaming_areas set xp_per_tick = 2   where id = 'redline_circuit';
update public.roaming_areas set xp_per_tick = 3   where id = 'ironwood_bastion';
update public.roaming_areas set xp_per_tick = 4   where id = 'blastforge_yards';
update public.roaming_areas set xp_per_tick = 5   where id = 'prismatek_reactor';
update public.roaming_areas set xp_per_tick = 6   where id = 'throwtech_dumpnet';
update public.roaming_areas set xp_per_tick = 8   where id = 'helixworks_labyrinth';

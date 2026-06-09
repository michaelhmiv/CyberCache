-- Migration 057: New XP curve (50n + 20n^1.4) + wipe-slate re-anchor
--
-- Replaces the `level * 100` threshold inside cc_apply_xp with the gentler
-- `floor(50*level + 20*level^1.4)` curve. Wipes no XP — the DO block re-anchors
-- every existing profile to the new threshold for its current level so a
-- level-up triggers on the next tick if the new threshold is met.
--
-- This migration is intentionally self-contained: it does NOT depend on the
-- `roaming_areas` table or `cc_claim_roaming_rewards` RPC from migration 055.
-- The per-area XP multiplier plumbing ships separately (see PR #58).

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
    -- Mirrored client-side in src/content/simulation.ts (xpToNextLevel).
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

-- Wipe-slate re-anchor: replay every existing profile through the new curve
-- without deleting earned XP. (player_level, player_xp) under the old curve
-- is reinterpreted under the new curve's threshold. If a profile is already
-- over the new threshold for its level, the next cc_apply_xp call will roll
-- them up. If a profile is under, nothing changes.
do $$
declare
  profile_row record;
  new_state jsonb;
begin
  for profile_row in
    select id, player_level, player_xp from public.profiles
    for update
  loop
    new_state := public.cc_apply_xp(profile_row.player_level, profile_row.player_xp, 0);
    update public.profiles
       set player_level = (new_state ->> 'player_level')::int,
           player_xp = (new_state ->> 'player_xp')::bigint
     where id = profile_row.id;
  end loop;
end;
$$;

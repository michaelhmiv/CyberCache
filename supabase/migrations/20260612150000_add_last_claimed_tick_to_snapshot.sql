-- Migration 20260612150000: expose last_claimed_tick in profile snapshot
--
-- The client-side tick counter (totalTickCount) starts at 0 on every
-- page load, but the server-side profiles.last_claimed_tick persists
-- across sessions. Both cc_apply_chef_rewards and cc_claim_roaming_rewards
-- reject claims where tick_count <= last_claimed_tick, so after the first
-- successful claim in a session, a page refresh causes all subsequent
-- claims to fail silently (credits/xp/scrap stop updating).
--
-- Fix: include last_claimed_tick in cc_profile_snapshot so the client
-- can seed its counter to the server's value on page load.

create or replace function public.cc_profile_snapshot(profile_row public.profiles)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', profile_row.id,
    'player_level', profile_row.player_level,
    'player_xp', profile_row.player_xp,
    'credits', profile_row.credits,
    'scrap', profile_row.scrap,
    'cache_tokens', profile_row.cache_tokens,
    'cache_token_parts', profile_row.cache_token_parts,
    'materials', profile_row.materials,
    'essences', profile_row.essences,
    'consumables', profile_row.consumables,
    'skill_spends', profile_row.skill_spends,
    'boss_state', profile_row.boss_state,
    'last_idle_claim_at', profile_row.last_idle_claim_at,
    'last_claimed_tick', profile_row.last_claimed_tick
  );
$$;

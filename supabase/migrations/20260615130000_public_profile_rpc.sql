-- Migration 20260615130000: Public profile RPC
--
-- Returns only the public-facing fields for any player. Excludes credits,
-- scrap, wallet details, and inventory internals. Used by leaderboard row
-- taps and future player search.

CREATE OR REPLACE FUNCTION public.cc_get_public_profile(_player_id uuid)
RETURNS TABLE (
  player_id uuid,
  username text,
  display_name text,
  level int,
  xp bigint,
  net_worth bigint,
  total_kills bigint,
  total_deaths bigint,
  kill_death_ratio numeric,
  highest_boss_tier int,
  total_mastery_xp bigint,
  highest_mastery_level int,
  legendary_items int,
  total_items int,
  weapons_owned int,
  highest_item_level int,
  joined_at timestamptz,
  last_active_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.user_id,
    s.username,
    s.display_name,
    s.player_level::int,
    s.player_xp::bigint,
    s.net_worth::bigint,
    s.total_kills::bigint,
    s.total_deaths::bigint,
    s.kill_death_ratio::numeric,
    s.highest_boss_tier::int,
    s.total_mastery_xp::bigint,
    s.highest_mastery_level::int,
    s.legendary_items::int,
    s.total_items::int,
    s.weapons_owned::int,
    s.highest_item_level::int,
    s.joined_at,
    s.last_active_at
  FROM public.player_public_stats s
  WHERE s.user_id = _player_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cc_get_public_profile(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cc_get_public_profile(uuid) TO authenticated;

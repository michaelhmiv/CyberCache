-- Migration 20260615120000: Global leaderboard RPC
--
-- Returns ranked player lists derived from daily progression snapshots.
-- Metrics are allow-listed server-side; callers cannot query arbitrary columns.
-- Designed so future scope filters (guild/friends) can be added without
-- changing the RPC signature.

-- Index to support leaderboard window queries
CREATE INDEX IF NOT EXISTS idx_player_progression_snapshots_metric_time
  ON public.player_progression_snapshots (snapshot_at DESC)
  INCLUDE (player_id, level, xp, net_worth, total_kills, total_deaths, highest_boss_tier, total_mastery_xp, highest_mastery_level, legendary_items, total_items);

-- Metric allowlist with column/direction metadata
CREATE OR REPLACE FUNCTION public.cc_get_leaderboard(
  _metric text,
  _period text DEFAULT 'all_time',
  _limit int DEFAULT 100
)
RETURNS TABLE (
  rank bigint,
  player_id uuid,
  username text,
  value numeric,
  previous_value numeric,
  trend numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min_time timestamptz;
  v_metric text;
BEGIN
  -- Validate metric
  IF _metric NOT IN ('level', 'xp', 'net_worth', 'total_kills', 'kdr', 'highest_boss_tier', 'total_mastery_xp', 'highest_mastery_level', 'legendary_items', 'total_items') THEN
    RAISE EXCEPTION 'Invalid leaderboard metric: %', _metric;
  END IF;

  -- Validate period
  IF _period = 'all_time' THEN
    v_min_time := '1970-01-01'::timestamptz;
  ELSIF _period = 'weekly' THEN
    v_min_time := now() - interval '7 days';
  ELSIF _period = 'daily' THEN
    v_min_time := now() - interval '1 day';
  ELSE
    RAISE EXCEPTION 'Invalid leaderboard period: %', _period;
  END IF;

  v_metric := _metric;

  RETURN QUERY
  WITH latest AS (
    SELECT DISTINCT ON (s.player_id)
      s.player_id,
      s.level,
      s.xp,
      s.net_worth,
      s.total_kills,
      s.total_deaths,
      s.highest_boss_tier,
      s.total_mastery_xp,
      s.highest_mastery_level,
      s.legendary_items,
      s.total_items,
      s.snapshot_at
    FROM public.player_progression_snapshots s
    WHERE s.snapshot_at >= v_min_time
    ORDER BY s.player_id, s.snapshot_at DESC
  ),
  prior AS (
    SELECT DISTINCT ON (s.player_id)
      s.player_id,
      s.level,
      s.xp,
      s.net_worth,
      s.total_kills,
      s.total_deaths,
      s.highest_boss_tier,
      s.total_mastery_xp,
      s.highest_mastery_level,
      s.legendary_items,
      s.total_items
    FROM public.player_progression_snapshots s
    WHERE s.snapshot_at < v_min_time
    ORDER BY s.player_id, s.snapshot_at DESC
  ),
  selected AS (
    SELECT
      l.player_id,
      p.username,
      CASE v_metric
        WHEN 'level' THEN l.level::numeric
        WHEN 'xp' THEN l.xp::numeric
        WHEN 'net_worth' THEN l.net_worth::numeric
        WHEN 'total_kills' THEN l.total_kills::numeric
        WHEN 'kdr' THEN (l.total_kills::numeric / nullif(l.total_deaths, 0)::numeric)
        WHEN 'highest_boss_tier' THEN l.highest_boss_tier::numeric
        WHEN 'total_mastery_xp' THEN l.total_mastery_xp::numeric
        WHEN 'highest_mastery_level' THEN l.highest_mastery_level::numeric
        WHEN 'legendary_items' THEN l.legendary_items::numeric
        WHEN 'total_items' THEN l.total_items::numeric
      END AS current_value,
      CASE v_metric
        WHEN 'level' THEN pr.level::numeric
        WHEN 'xp' THEN pr.xp::numeric
        WHEN 'net_worth' THEN pr.net_worth::numeric
        WHEN 'total_kills' THEN pr.total_kills::numeric
        WHEN 'kdr' THEN (pr.total_kills::numeric / nullif(pr.total_deaths, 0)::numeric)
        WHEN 'highest_boss_tier' THEN pr.highest_boss_tier::numeric
        WHEN 'total_mastery_xp' THEN pr.total_mastery_xp::numeric
        WHEN 'highest_mastery_level' THEN pr.highest_mastery_level::numeric
        WHEN 'legendary_items' THEN pr.legendary_items::numeric
        WHEN 'total_items' THEN pr.total_items::numeric
      END AS previous_value
    FROM latest l
    JOIN public.profiles p ON p.id = l.player_id
    LEFT JOIN prior pr ON pr.player_id = l.player_id
  )
  SELECT
    ROW_NUMBER() OVER (ORDER BY s.current_value DESC NULLS LAST)::bigint AS rank,
    s.player_id,
    s.username,
    s.current_value AS value,
    s.previous_value,
    CASE
      WHEN s.previous_value IS NULL OR s.previous_value = 0 THEN 0
      ELSE ((s.current_value - s.previous_value) / s.previous_value)::numeric
    END AS trend
  FROM selected s
  WHERE s.current_value IS NOT NULL
  ORDER BY s.current_value DESC NULLS LAST
  LIMIT _limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cc_get_leaderboard(text, text, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cc_get_leaderboard(text, text, int) TO authenticated;

-- Convenience: caller's own rank for any metric/period
CREATE OR REPLACE FUNCTION public.cc_get_my_leaderboard_rank(
  _metric text,
  _period text DEFAULT 'all_time'
)
RETURNS TABLE (
  rank bigint,
  value numeric,
  previous_value numeric,
  trend numeric,
  total_players bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_player_id uuid := auth.uid();
BEGIN
  RETURN QUERY
  WITH board AS (
    SELECT * FROM public.cc_get_leaderboard(_metric, _period, 100000)
  )
  SELECT
    b.rank,
    b.value,
    b.previous_value,
    b.trend,
    (SELECT count(*)::bigint FROM board) AS total_players
  FROM board b
  WHERE b.player_id = v_player_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cc_get_my_leaderboard_rank(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cc_get_my_leaderboard_rank(text, text) TO authenticated;

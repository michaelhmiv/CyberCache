-- 0098 — The global leaderboard counts only hunters with a kill.
--
-- Owner-ruled 2026-11-15: the public standings board listed every
-- profile with a progression snapshot — 634 profiles in production,
-- most of them zero-activity guest accounts that never killed
-- anything. The ruling is a DISPLAY FILTER ONLY: no profile or
-- snapshot is deleted; the board — and the field-size readout that
-- counts it — shows only hunters whose latest snapshot carries at
-- least one lifetime kill.
--
-- This restates cc_get_leaderboard from its ONLY definition
-- (migration 0003, kept verbatim below) with exactly two changes:
--   1. the `selected` CTE also carries l.total_kills;
--   2. the final SELECT gains `and coalesce(s.total_kills, 0) >= 1`
--      (a null kill count reads as zero — excluded).
-- Metric validation, period windows, trend math and the limit are
-- untouched. cc_get_my_leaderboard_rank needs NO restatement: it
-- composes cc_get_leaderboard(metric, period, 100000), so entries,
-- ranks and its total_players count all inherit the filter; a
-- caller with zero kills gets no row back and simply has no
-- standing on the board.
--
-- Semantics: the filter keys on the LATEST in-window snapshot's
-- lifetime total_kills — the same snapshot every board value is
-- read from — so on week/day boards a hunter with lifetime kills
-- but no kills inside the window still appears, ranked by their
-- in-window metric value.
--
-- The in-memory twin (computeLeaderboard in src/server/reads/
-- store.ts) carries the identical skip; both sides are pinned by
-- src/test/leaderboardKillFilter.test.ts and chefReads.test.ts.
-- CREATE OR REPLACE keeps the restatement idempotent, matching
-- 0089/0094/0097; like them it carries no GRANT statements (the
-- read functions have never carried any).

-- Global leaderboard over progression snapshots (ported verbatim from
-- 20260615120000; it never used auth.uid()).
create or replace function public.cc_get_leaderboard(
  _metric text,
  _period text default 'all_time',
  _limit int default 100
)
returns table (
  rank bigint,
  player_id uuid,
  username text,
  value numeric,
  previous_value numeric,
  trend numeric
)
language plpgsql
stable
set search_path = public
as $$
declare
  v_min_time timestamptz;
  v_metric text;
begin
  if _metric not in ('level', 'xp', 'net_worth', 'total_kills', 'kdr', 'highest_boss_tier', 'total_mastery_xp', 'highest_mastery_level', 'legendary_items', 'total_items') then
    raise exception 'Invalid leaderboard metric: %', _metric;
  end if;

  if _period = 'all_time' then
    v_min_time := '1970-01-01'::timestamptz;
  elsif _period = 'weekly' then
    v_min_time := now() - interval '7 days';
  elsif _period = 'daily' then
    v_min_time := now() - interval '1 day';
  else
    raise exception 'Invalid leaderboard period: %', _period;
  end if;

  v_metric := _metric;

  return query
  with latest as (
    select distinct on (s.player_id)
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
    from public.player_progression_snapshots s
    where s.snapshot_at >= v_min_time
    order by s.player_id, s.snapshot_at desc
  ),
  prior as (
    select distinct on (s.player_id)
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
    from public.player_progression_snapshots s
    where s.snapshot_at < v_min_time
    order by s.player_id, s.snapshot_at desc
  ),
  selected as (
    select
      l.player_id,
      p.username,
      l.total_kills,
      case v_metric
        when 'level' then l.level::numeric
        when 'xp' then l.xp::numeric
        when 'net_worth' then l.net_worth::numeric
        when 'total_kills' then l.total_kills::numeric
        when 'kdr' then (l.total_kills::numeric / nullif(l.total_deaths, 0)::numeric)
        when 'highest_boss_tier' then l.highest_boss_tier::numeric
        when 'total_mastery_xp' then l.total_mastery_xp::numeric
        when 'highest_mastery_level' then l.highest_mastery_level::numeric
        when 'legendary_items' then l.legendary_items::numeric
        when 'total_items' then l.total_items::numeric
      end as current_value,
      case v_metric
        when 'level' then pr.level::numeric
        when 'xp' then pr.xp::numeric
        when 'net_worth' then pr.net_worth::numeric
        when 'total_kills' then pr.total_kills::numeric
        when 'kdr' then (pr.total_kills::numeric / nullif(pr.total_deaths, 0)::numeric)
        when 'highest_boss_tier' then pr.highest_boss_tier::numeric
        when 'total_mastery_xp' then pr.total_mastery_xp::numeric
        when 'highest_mastery_level' then pr.highest_mastery_level::numeric
        when 'legendary_items' then pr.legendary_items::numeric
        when 'total_items' then pr.total_items::numeric
      end as previous_value
    from latest l
    join public.profiles p on p.id = l.player_id
    left join prior pr on pr.player_id = l.player_id
  )
  select
    row_number() over (order by s.current_value desc nulls last)::bigint as rank,
    s.player_id,
    s.username,
    s.current_value as value,
    s.previous_value,
    case
      when s.previous_value is null or s.previous_value = 0 then 0
      else ((s.current_value - s.previous_value) / s.previous_value)::numeric
    end as trend
  from selected s
  where s.current_value is not null
    and coalesce(s.total_kills, 0) >= 1
  order by s.current_value desc nulls last
  limit _limit;
end;
$$;

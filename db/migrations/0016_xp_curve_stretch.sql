-- 0016_xp_curve_stretch.sql
--
-- Pacing-baseline tuning (owner directive, 2026-10-30): stretch the XP
-- curve to a Torn-like horizon. The launch curve (50L + 20·L^1.4,
-- 766,955 XP to level 100) put a regular player at the cap in ~45
-- days. The new curve keeps the early game quick, walks the boss
-- ladder over ~7 weeks, and makes the tail a prestige marathon:
--
--   L < 25:  floor(100 · L^1.72)
--   L ≥ 25:  floor(25377 · (L/25)^0.5 · 1.048^max(0, L−45))
--
-- 25377 is the first segment evaluated at 25, so the curve is
-- continuous at the joint; past 45 each level costs 4.8% more than
-- the last. Modeled on the lifecycle evaluation's faucet rates
-- (best-area XP/hr by level band): regulars (~6 roaming-h/day) reach
-- L25 in ~17 days, L45 in ~51 days, L100 in ~24 months; casuals need
-- 4+ years for the cap; each level in the 90s takes 3–5 weeks.
--
-- cc_apply_xp is state-based (current level + current XP in, new
-- state out), so existing profiles keep their level and simply
-- progress under the new thresholds from their next award — no data
-- migration. Mirrored client-side in src/content/simulation.ts
-- (xpToNextLevel / XP_CURVE_FORMULA) and in the in-memory store's
-- applyXp port, which reads the same shared formula.

create or replace function public.cc_apply_xp(current_level integer, current_xp bigint, xp_award bigint)
 returns jsonb
 language plpgsql
 immutable
 set search_path to 'public'
as $function$
declare
  next_level integer := greatest(1, coalesce(current_level, 1));
  next_xp bigint := greatest(0, coalesce(current_xp, 0)) + greatest(0, coalesce(xp_award, 0));
  threshold bigint;
begin
  loop
    -- Stretched curve (0016): 100·L^1.72 below 25; at/above 25 a sqrt
    -- climb from the continuous joint value 25377, compounding
    -- ×1.048 per level past 45.
    -- Mirrored client-side in src/content/simulation.ts (xpToNextLevel).
    if next_level < 25 then
      threshold := floor(100::numeric * power(next_level::numeric, 1.72))::bigint;
    else
      threshold := floor(25377::numeric * power(next_level::numeric / 25, 0.5) * power(1.048::numeric, greatest(0, next_level - 45)))::bigint;
    end if;
    exit when next_xp < threshold;
    next_xp := next_xp - threshold;
    next_level := next_level + 1;
  end loop;

  return jsonb_build_object('player_level', next_level, 'player_xp', next_xp);
end;
$function$;

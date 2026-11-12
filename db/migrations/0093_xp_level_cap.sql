-- 0093 — cc_apply_xp stops at the level cap (audit HTR-06).
--
-- The XP loop had no ceiling: levels (and the level-1 skill budget)
-- minted past 100 indefinitely, and the hero plate promised
-- 'Level 101'. This restates cc_apply_xp from 0016 with exactly one
-- change — an exit at the cap at the top of the loop. The TS twin
-- (applyXp in src/server/writes/store.ts) clamps identically, and
-- MAX_PLAYER_LEVEL in src/content/simulation.ts names the cap.
--

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
    -- Level cap (audit HTR-06): never level past 100 — the curve's
    -- design horizon (0016) and the lawful end of the level-1 skill
    -- budget (99 points). Leftover XP stays banked on the row. The
    -- TS twin (applyXp) breaks identically.
    exit when next_level >= 100;
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

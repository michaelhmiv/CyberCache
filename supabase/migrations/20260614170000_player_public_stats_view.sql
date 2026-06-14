-- Migration 20260614170000: Player public stats projection
--
-- One row per player intended for authenticated profile pages and future
-- leaderboards. Exposes economy/combat/collection aggregates but NOT email,
-- full inventory rows, runtime snapshots, or loadout internals.
--
-- Access model:
-- - The view is readable only by authenticated users.
-- - `cc_my_stats_summary()` returns the caller's own row.
-- - `cc_public_stats(user_id)` returns any player's row; it is the gated
--   public lookup path we will use once username enforcement lands.
-- - This view is optimized for single-row lookups. If we later use it for
--   global leaderboards we should materialize it or pre-compute aggregates.

-- Supporting indexes for the aggregate subqueries.
create index if not exists idx_item_instances_owner_kind on public.item_instances(owner_user_id, kind);
create index if not exists idx_item_instances_owner_rarity on public.item_instances(owner_user_id, rarity);
create index if not exists idx_player_masteries_user on public.player_masteries(user_id);
create index if not exists idx_player_stat_counters_user_key on public.player_stat_counters(user_id, stat_key);

create or replace view public.player_public_stats as
select
  p.id as user_id,
  p.username,
  p.display_name,
  p.player_level,
  p.player_xp,
  p.credits,
  p.scrap,
  p.cache_tokens,
  p.cache_token_parts,
  coalesce(c.total_kills, 0) as total_kills,
  coalesce(c.total_deaths, 0) as total_deaths,
  (coalesce(c.total_kills, 0)::numeric / nullif(c.total_deaths, 0)::numeric) as kill_death_ratio,
  coalesce(c.highest_boss_tier, 0) as highest_boss_tier,
  coalesce(c.longest_kill_streak, 0) as longest_kill_streak,
  coalesce(c.active_play_seconds, 0) as active_play_seconds,
  coalesce(c.idle_play_seconds, 0) as idle_play_seconds,
  coalesce(c.kills_by_area, '{}'::jsonb) as kills_by_area,
  coalesce(c.kills_by_weapon_type, '{}'::jsonb) as kills_by_weapon_type,
  coalesce(c.kills_by_element, '{}'::jsonb) as kills_by_element,
  coalesce(psc.stat_value, 0) as net_worth,
  (select count(*) from public.item_instances ii where ii.owner_user_id = p.id) as total_items,
  (select count(*) from public.item_instances ii where ii.owner_user_id = p.id and ii.kind = 'weapon') as weapons_owned,
  (select count(*) from public.item_instances ii where ii.owner_user_id = p.id and ii.rarity = 'Legendary') as legendary_items,
  (select coalesce(max(ii.item_level), 0) from public.item_instances ii where ii.owner_user_id = p.id) as highest_item_level,
  (select coalesce(sum(pm.mastery_xp), 0) from public.player_masteries pm where pm.user_id = p.id) as total_mastery_xp,
  (select coalesce(max(pm.mastery_level), 0) from public.player_masteries pm where pm.user_id = p.id) as highest_mastery_level,
  p.updated_at as last_active_at,
  p.created_at as joined_at
from public.profiles p
left join public.combat_stats c on c.user_id = p.id
left join public.player_stat_counters psc on psc.user_id = p.id and psc.stat_key = 'account.net_worth';

-- Authenticated-only. Public/anon access must go through a gated RPC or
-- materialized leaderboard table in the future.
grant select on public.player_public_stats to authenticated;

-- Returns the full row from player_public_stats for the calling user.
create or replace function public.cc_my_stats_summary()
returns public.player_public_stats
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.player_public_stats
  where user_id = auth.uid()
  limit 1;
$$;

revoke execute on function public.cc_my_stats_summary() from public, anon;
grant execute on function public.cc_my_stats_summary() to authenticated;

-- Returns the public stats row for any user ID.
-- Callers must be authenticated; username-enforcement gating belongs in UX.
create or replace function public.cc_public_stats(_user_id uuid)
returns public.player_public_stats
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.player_public_stats
  where user_id = _user_id
  limit 1;
$$;

revoke execute on function public.cc_public_stats(uuid) from public, anon;
grant execute on function public.cc_public_stats(uuid) to authenticated;

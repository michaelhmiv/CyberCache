-- Migration 20260615110000: Net worth as total assets
--
-- Redefines net_worth to include credits + scrap + the estimated value of
-- all owned items. Exposes the aggregate publicly; the composition remains
-- private. Adds item-instance triggers so net worth stays current when items
-- are created, destroyed, or change owners.

-- 1. Helper: recompute and persist a player's net worth from authoritative sources
create or replace function public.cc_recalculate_net_worth(_player_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits bigint;
  v_scrap bigint;
  v_items bigint;
  v_total bigint;
begin
  if _player_id is null then return 0; end if;

  select coalesce(credits, 0), coalesce(scrap, 0)
    into v_credits, v_scrap
    from public.profiles
   where id = _player_id;

  if not found then return 0; end if;

  select coalesce(sum(estimated_value), 0)
    into v_items
    from public.item_instances
   where owner_user_id = _player_id;

  v_total := v_credits + v_scrap + v_items;
  v_total := greatest(0, v_total);

  perform public.cc_set_stat(_player_id, 'account.net_worth', v_total);
  perform public.cc_set_mastery_xp(_player_id, 'account.net_worth', v_total);

  return v_total;
end;
$$;

revoke execute on function public.cc_recalculate_net_worth(uuid) from public, anon, authenticated;
grant execute on function public.cc_recalculate_net_worth(uuid) to service_role;

-- 2. Update player_public_stats view to compute net_worth from all assets
--    (removes dependency on player_stat_counters for this metric)
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
  (coalesce(p.credits, 0) + coalesce(p.scrap, 0) + coalesce((
    select sum(ii.estimated_value)
    from public.item_instances ii
    where ii.owner_user_id = p.id
  ), 0))::bigint as net_worth,
  (select count(*) from public.item_instances ii where ii.owner_user_id = p.id) as total_items,
  (select count(*) from public.item_instances ii where ii.owner_user_id = p.id and ii.kind = 'weapon') as weapons_owned,
  (select count(*) from public.item_instances ii where ii.owner_user_id = p.id and ii.rarity = 'Legendary') as legendary_items,
  (select coalesce(max(ii.item_level), 0) from public.item_instances ii where ii.owner_user_id = p.id) as highest_item_level,
  (select coalesce(sum(pm.mastery_xp), 0) from public.player_masteries pm where pm.user_id = p.id) as total_mastery_xp,
  (select coalesce(max(pm.mastery_level), 0) from public.player_masteries pm where pm.user_id = p.id) as highest_mastery_level,
  p.updated_at as last_active_at,
  p.created_at as joined_at
from public.profiles p
left join public.combat_stats c on c.user_id = p.id;

-- Preserve grants
grant select on public.player_public_stats to authenticated;

-- 3. Update the verified-action mastery trigger to use the new authoritative recalculation
--    instead of credits+scrap only.
create or replace function public.cc_apply_mastery_for_verified_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  action text := new.action_type;
  amount bigint;
  won boolean;
  player_id uuid := new.user_id;
begin
  perform public.cc_add_stat(player_id, 'actions.total', 1);
  perform public.cc_add_stat(player_id, 'actions.' || action, 1);

  if action in ('cc_make_item', 'cc_draw_item') then
    perform public.cc_add_stat(player_id, 'inventory.cache_draws', 1);
    perform public.cc_add_mastery_xp(player_id, 'inventory.cache_draws', 30);
  elsif action in ('cc_recycle_item', 'cc_salvage_item') then
    amount := greatest(0, coalesce((new.result_payload ->> 'scrap_award')::bigint, 0));
    perform public.cc_add_stat(player_id, 'inventory.recycle.count', 1);
    perform public.cc_add_stat(player_id, 'inventory.scrap_generated', amount);
    perform public.cc_add_mastery_xp(player_id, 'inventory.recycle', 25);
    perform public.cc_add_mastery_xp(player_id, 'inventory.scrap_generated', amount);
  elsif action = 'cc_vendor_buy' then
    amount := greatest(1, coalesce((new.result_payload ->> 'quantity')::bigint, 1));
    perform public.cc_add_stat(player_id, 'economy.vendor_buys', amount);
    perform public.cc_add_mastery_xp(player_id, 'economy.vendor_buys', amount * 15);
  elsif action = 'cc_market_create' then
    perform public.cc_add_stat(player_id, 'economy.market_listings', 1);
    perform public.cc_add_mastery_xp(player_id, 'economy.market_listings', 20);
  elsif action in ('cc_accept_listing', 'cc_market_transfer') then
    amount := greatest(0, coalesce((new.result_payload -> 'listing' ->> 'price_credits')::bigint, 0));
    perform public.cc_add_stat(player_id, 'economy.market_sales', 1);
    perform public.cc_add_stat(player_id, 'economy.trade_volume', amount);
    perform public.cc_add_mastery_xp(player_id, 'economy.market_sales', 50);
    perform public.cc_add_mastery_xp(player_id, 'economy.trade_volume', amount);
  elsif action in ('cc_battle_result', 'cc_boss_attempt') then
    won := coalesce(new.result_payload -> 'draw' ->> 'outcome', '') = 'victory';
    perform public.cc_add_stat(player_id, 'combat.boss_attempts', 1);
    perform public.cc_add_mastery_xp(player_id, 'combat.boss_attempts', 20);
    perform public.cc_add_mastery_xp(player_id, 'locations.dustwaste', 25);
    if won then
      perform public.cc_add_stat(player_id, 'combat.boss_defeats', 1);
      perform public.cc_add_mastery_xp(player_id, 'combat.boss_defeats', 100);
    end if;
  elsif action in ('cc_retrain', 'cc_skill_reset') then
    perform public.cc_add_stat(player_id, 'skills.retrain', 1);
    perform public.cc_add_mastery_xp(player_id, 'skills.training', 25);
  elsif action = 'cc_idle_claim' then
    amount := greatest(0, coalesce((new.result_payload -> 'rewards' ->> 'xp')::bigint, 0));
    perform public.cc_add_stat(player_id, 'combat.idle_xp_claimed', amount);
    perform public.cc_add_mastery_xp(player_id, 'locations.dustwaste', greatest(1, amount));
  end if;

  -- Net worth now includes credits + scrap + owned item values.
  perform public.cc_recalculate_net_worth(player_id);

  return new;
end;
$$;

revoke execute on function public.cc_apply_mastery_for_verified_action() from public, anon, authenticated;

-- 4. Trigger functions to keep net worth current when items change.
create or replace function public.cc_item_instances_recalc_net_worth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_player uuid;
begin
  if tg_op = 'DELETE' then
    affected_player := old.owner_user_id;
  elsif tg_op = 'UPDATE' and old.owner_user_id is distinct from new.owner_user_id then
    -- Both old and new owners may have changed wealth.
    perform public.cc_recalculate_net_worth(old.owner_user_id);
    affected_player := new.owner_user_id;
  else
    affected_player := new.owner_user_id;
  end if;

  if affected_player is not null then
    perform public.cc_recalculate_net_worth(affected_player);
  end if;

  if tg_op = 'DELETE' then
    return old;
  else
    return new;
  end if;
end;
$$;

revoke execute on function public.cc_item_instances_recalc_net_worth() from public, anon, authenticated;

-- Ensure trigger exists (idempotent)
drop trigger if exists trg_item_instances_recalc_net_worth on public.item_instances;
create trigger trg_item_instances_recalc_net_worth
  after insert or update or delete on public.item_instances
  for each row
  execute function public.cc_item_instances_recalc_net_worth();

-- 5. Backfill net worth for all players
select public.cc_recalculate_net_worth(p.id)
from public.profiles p;

-- Roaming Consumable Engine — server-authoritative consumable processing
--
-- 1. Mastery definitions for ordnance + consumable efficiency
-- 2. Atomic consumable consumption RPC (called by Chef after processRoamingClaim)
-- 3. Mastery XP award on consumable consumption

-- =====================================================================
-- 1. Mastery definitions
-- =====================================================================

insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active)
values
  ('combat.ordnance', 'combat', 'Ordnance Mastery',
   'Mastery over ordnance deployment during roaming. Reduces ordnance fire interval.',
   'fires', 10, true, true),
  ('consumable.efficiency', 'economy', 'Consumable Efficiency',
   'Mastery over consumable usage during roaming. Higher levels reduce consumption rate.',
   'uses', 15, true, true)
on conflict (id) do nothing;

-- =====================================================================
-- 2. Atomic consumable consumption RPC
--
-- Called by the Chef claim route after processRoamingClaim returns
-- consumed consumables. Decrements profiles.consumables atomically
-- with a FOR UPDATE lock and logs each consumption to consumable_events.
--
-- Security: security definer. The Chef route authenticates the JWT and
-- passes the resolved player_id — the RPC trusts the caller (Chef only).
-- =====================================================================

create or replace function public.cc_consume_roaming_consumables(
  _player_id uuid,
  _consumed jsonb,
  _area_id text,
  _tick_count bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  key text;
  count_val integer;
  current_count integer;
  new_consumables jsonb;
begin
  select consumables into new_consumables
  from profiles
  where id = _player_id
  for update;

  if new_consumables is null then
    new_consumables := '{}'::jsonb;
  end if;

  for key, count_val in select key, value::integer from jsonb_each_text(_consumed)
  loop
    if count_val <= 0 then continue; end if;

    current_count := coalesce((new_consumables ->> key)::integer, 0);
    count_val := least(count_val, current_count);

    if count_val <= 0 then continue; end if;

    new_consumables := jsonb_set(
      new_consumables,
      array[key],
      to_jsonb(current_count - count_val)
    );

    insert into consumable_events (
      user_id, consumable_type, quantity_delta,
      event_type, activity_type, reason
    )
    values (
      _player_id, key, -count_val,
      'used', 'roaming_loot',
      'Consumed during roaming tick ' || _tick_count || ' in ' || _area_id
    );
  end loop;

  update profiles
  set consumables = new_consumables, updated_at = now()
  where id = _player_id;

  return jsonb_build_object('consumables', new_consumables);
end;
$$;

revoke execute on function public.cc_consume_roaming_consumables(uuid, jsonb, text, bigint)
  from public, anon, authenticated;
grant execute on function public.cc_consume_roaming_consumables(uuid, jsonb, text, bigint)
  to authenticated;

-- =====================================================================
-- 3. Mastery XP for consumable usage
--
-- Extend the verified action trigger to award mastery XP when
-- roaming claims include consumed consumables. The Chef's
-- cc_apply_chef_rewards RPC inserts a verified_action_ledger row;
-- the trigger fires and awards XP based on consumedConsumables.
-- =====================================================================

create or replace function public.cc_apply_mastery_for_verified_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_payload jsonb := coalesce(new.result_payload -> 'profile', '{}'::jsonb);
  reward_payload jsonb := coalesce(new.result_payload -> 'rewards', '{}'::jsonb);
  action text := new.action_type;
  amount bigint;
  won boolean;
  credits_value bigint;
  scrap_value bigint;
  net_worth_value bigint;
  consumed_map jsonb;
  consumable_type text;
  consumable_count integer;
begin
  perform public.cc_add_stat(new.user_id, 'actions.total', 1);
  perform public.cc_add_stat(new.user_id, 'actions.' || action, 1);

  if action in ('cc_make_item', 'cc_draw_item') then
    perform public.cc_add_stat(new.user_id, 'inventory.cache_draws', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'inventory.cache_draws', 30);
  elsif action in ('cc_recycle_item', 'cc_salvage_item') then
    amount := greatest(0, coalesce((new.result_payload ->> 'scrap_award')::bigint, 0));
    perform public.cc_add_stat(new.user_id, 'inventory.recycle.count', 1);
    perform public.cc_add_stat(new.user_id, 'inventory.scrap_generated', amount);
    perform public.cc_add_mastery_xp(new.user_id, 'inventory.recycle', 25);
    perform public.cc_add_mastery_xp(new.user_id, 'inventory.scrap_generated', amount);
  elsif action = 'cc_vendor_buy' then
    amount := greatest(1, coalesce((new.result_payload ->> 'quantity')::bigint, 1));
    perform public.cc_add_stat(new.user_id, 'economy.vendor_buys', amount);
    perform public.cc_add_mastery_xp(new.user_id, 'economy.vendor_buys', amount * 15);
  elsif action = 'cc_market_create' then
    perform public.cc_add_stat(new.user_id, 'economy.market_listings', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'economy.market_listings', 20);
  elsif action in ('cc_accept_listing', 'cc_market_transfer') then
    amount := greatest(0, coalesce((new.result_payload -> 'listing' ->> 'price_credits')::bigint, 0));
    perform public.cc_add_stat(new.user_id, 'economy.market_sales', 1);
    perform public.cc_add_stat(new.user_id, 'economy.trade_volume', amount);
    perform public.cc_add_mastery_xp(new.user_id, 'economy.market_sales', 50);
    perform public.cc_add_mastery_xp(new.user_id, 'economy.trade_volume', amount);
  elsif action in ('cc_item_service_request', 'cc_item_service_accept') then
    perform public.cc_add_stat(new.user_id, 'services.jobs_touched', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'services.repair', 10);
  elsif action = 'cc_item_job_finish' then
    amount := greatest(0, coalesce((new.result_payload ->> 'price_credits')::bigint, 0));
    perform public.cc_add_stat(new.user_id, 'services.completed', 1);
    perform public.cc_add_stat(new.user_id, 'services.revenue', amount);
    perform public.cc_add_mastery_xp(new.user_id, 'services.repair', 50 + amount);
  elsif action in ('cc_battle_result', 'cc_boss_attempt') then
    won := coalesce(new.result_payload -> 'draw' ->> 'outcome', '') = 'victory';
    perform public.cc_add_stat(new.user_id, 'combat.boss_attempts', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'combat.boss_attempts', 20);
    perform public.cc_add_mastery_xp(new.user_id, 'locations.dustwaste', 25);
    if won then
      perform public.cc_add_stat(new.user_id, 'combat.boss_defeats', 1);
      perform public.cc_add_mastery_xp(new.user_id, 'combat.boss_defeats', 100);
    end if;
  elsif action in ('cc_retrain', 'cc_skill_reset') then
    perform public.cc_add_stat(new.user_id, 'skills.retrain', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'skills.training', 25);
  elsif action = 'cc_idle_claim' then
    amount := greatest(0, coalesce((reward_payload ->> 'xp')::bigint, 0));
    perform public.cc_add_stat(new.user_id, 'combat.idle_xp_claimed', amount);
    perform public.cc_add_mastery_xp(new.user_id, 'locations.dustwaste', greatest(1, amount));
  end if;

  -- NEW: Consumable usage mastery (from roaming claims)
  consumed_map := coalesce(new.result_payload -> 'consumedConsumables', '{}'::jsonb);
  if consumed_map <> '{}'::jsonb then
    for consumable_type, consumable_count in select key, value::integer from jsonb_each_text(consumed_map)
    loop
      if consumable_count > 0 then
        perform public.cc_add_mastery_xp(new.user_id, 'consumable.efficiency', consumable_count * 10);
        -- Ordnance family gets combat.ordnance mastery
        if consumable_type like 'Ordnance%'
           or consumable_type like 'EMP%'
           or consumable_type like 'Corrosive%'
           or consumable_type like 'Magnetized%'
           or consumable_type like 'PhaseShift%'
           or consumable_type like 'Void%'
        then
          perform public.cc_add_mastery_xp(new.user_id, 'combat.ordnance', consumable_count * 10);
        end if;
      end if;
    end loop;
  end if;

  if profile_payload ? 'credits' then
    credits_value := greatest(0, coalesce((profile_payload ->> 'credits')::bigint, 0));
    scrap_value := greatest(0, coalesce((profile_payload ->> 'scrap')::bigint, 0));
    net_worth_value := credits_value + scrap_value;
    perform public.cc_set_stat(new.user_id, 'account.net_worth', net_worth_value);
    perform public.cc_set_mastery_xp(new.user_id, 'account.net_worth', net_worth_value);
  end if;

  return new;
end;
$$;

revoke execute on function public.cc_apply_mastery_for_verified_action()
  from public, anon, authenticated;

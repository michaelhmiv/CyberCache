-- 0040 — Audit fix A: truth in numbers (CONS-02 + CONS-04).
--
-- 1. cc_apply_chef_boss_attempt restated (0030 body) with a 13th
--    parameter, p_items/_items: the attempt's rolled loot, stored by
--    the applier itself inside the attempt transaction. Before this
--    migration the boss route stored loot in a SECOND call after the
--    applier committed; when that call failed (the overload incident
--    migration 0039 hot-fixed), the attempt, its rewards and its
--    victory ledger row persisted while the loot never arrived, and
--    the lifetime fold counted victories the downed/collection folds
--    disagreed with. The 12-argument signature is dropped first so
--    twelve-argument calls cannot resolve ambiguously against the new
--    defaulted 13th parameter (the 0030/0039 overload lesson).
--
-- 2. player_public_stats restated (0003 body) with ONE collection
--    counting rule (CONS-04): collection aggregates count the gear the
--    inventory surfaces can actually show — vehicles are excluded
--    (they are reported separately, never as collection items), and
--    the sparse bootstrap starter row is excluded (a weapon payload
--    with no baseDamage is the cc_seed_starter_weapon seed row: it
--    exists so fresh-guest claims have a server-side starter, but it
--    is not a displayable item and must not inflate Total Items /
--    Weapons / Legendary counts or the trophy shelf).

drop function if exists public.cc_apply_chef_boss_attempt(uuid, text, bigint, boolean, bigint, bigint, jsonb, jsonb, text, bigint, bigint, text);

create or replace function public.cc_apply_chef_boss_attempt(
  _player_id uuid,
  _boss_id text,
  _attempt_nonce bigint,
  _victory boolean,
  _credits_delta bigint,
  _xp bigint,
  _consumables jsonb,
  _attempt jsonb,
  _unlocked_boss_id text default null,
  _scrap_delta bigint default 0,
  _entry_fee bigint default 0,
  _action_skill_tree text default null,
  _items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  result jsonb;
  prior jsonb;
  nonce_key text;
  xp_state jsonb;
  next_level integer;
  next_xp bigint;
  next_consumables jsonb;
  con_key text;
  con_val integer;
  current_count integer;
  consumed_batches jsonb := '[]'::jsonb;
  consumed_one jsonb;
  boss_state_next jsonb;
  defeated_ids jsonb;
  unlocked_ids jsonb;
  pity_counters jsonb;
  current_pity integer;
  -- 0030: action skill charge resolution.
  v_mod_payload jsonb;
  v_charge_after numeric;
  v_charge_rate numeric := least(100, greatest(0,
    public.cc_economy_config_number('actionSkillChargePerBossAttempt', 34)));
begin
  select * into p from public.profiles where id = _player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  nonce_key := _player_id::text || ':chef-boss:' || _boss_id || ':' || _attempt_nonce::text;
  select result_payload into prior
    from public.verified_action_ledger
   where user_id = _player_id
     and idempotency_key = nonce_key;
  if prior is not null then return prior || jsonb_build_object('idempotent_replay', true); end if;

  -- 0011: entry-fee affordability guard, under the row lock. A replay
  -- returned above never reaches this — its fee was already charged.
  if coalesce(_entry_fee, 0) > 0 and p.credits < _entry_fee then
    raise exception 'Insufficient credits for boss entry fee';
  end if;

  -- 0030: action skill spend / accrue. A fire validates selection,
  -- qualification (own records only), and a full pool, then zeroes
  -- the pool; any other resolved attempt accrues at the lever rate.
  if _action_skill_tree is not null then
    if _action_skill_tree not in ('Gunslinger', 'Demolition', 'Scavenger', 'Fixer') then
      raise exception 'Unknown action skill tree: %', _action_skill_tree;
    end if;
    if coalesce(p.action_skill_selection, '') <> _action_skill_tree then
      raise exception 'Action skill selection mismatch';
    end if;
    select payload into v_mod_payload from public.item_instances
     where owner_user_id = _player_id and runtime_state = 'equipped' and payload ? 'treeBonus'
     limit 1;
    if not public.cc_action_skill_qualified(p.skill_spends, v_mod_payload, _action_skill_tree) then
      raise exception 'Action skill not qualified for the selected tree';
    end if;
    if coalesce(p.action_skill_charge, 0) < 100 then
      raise exception 'Action skill is not charged';
    end if;
    v_charge_after := 0;
  else
    v_charge_after := least(100, coalesce(p.action_skill_charge, 0) + v_charge_rate);
  end if;

  xp_state := public.cc_apply_xp(p.player_level, p.player_xp, greatest(_xp, 0));
  next_level := (xp_state ->> 'player_level')::integer;
  next_xp := (xp_state ->> 'player_xp')::bigint;

  next_consumables := coalesce(p.consumables, '{}'::jsonb);
  for con_key, con_val in select key, value::integer from jsonb_each_text(coalesce(_consumables, '{}'::jsonb)) loop
    current_count := coalesce((next_consumables ->> con_key)::integer, 0);
    if current_count < con_val then raise exception 'Insufficient consumable quantity for %', con_key; end if;

    if not exists (select 1 from public.consumable_batches where owner_user_id = _player_id and consumable_type = con_key and quantity > 0) then
      perform public.cc_add_consumable_batch(_player_id, con_key, current_count, 100, 'vendor', null, null, 'admin_adjust', 'Backfilled legacy count into 100% batch before boss consumption', '{}'::jsonb);
    end if;

    consumed_one := public.cc_consume_consumable_batch(_player_id, con_key, con_val, 'boss', 'Boss attempt consumption', jsonb_build_object('boss_id', _boss_id, 'attempt_nonce', _attempt_nonce));
    consumed_batches := consumed_batches || jsonb_build_array(consumed_one);
    next_consumables := jsonb_set(next_consumables, array[con_key], to_jsonb(greatest(current_count - con_val, 0)), true);
  end loop;

  boss_state_next := coalesce(p.boss_state, '{}'::jsonb);
  defeated_ids := coalesce(boss_state_next -> 'defeatedBossIds', '[]'::jsonb);
  unlocked_ids := coalesce(boss_state_next -> 'unlockedBossIds', '["dune_tyrant"]'::jsonb);
  pity_counters := coalesce(boss_state_next -> 'pityCounters', '{}'::jsonb);
  current_pity := coalesce((pity_counters ->> _boss_id)::integer, 0);

  if _victory then
    if not defeated_ids ? _boss_id then defeated_ids := defeated_ids || to_jsonb(_boss_id); end if;
    if _unlocked_boss_id is not null and not unlocked_ids ? _unlocked_boss_id then unlocked_ids := unlocked_ids || to_jsonb(_unlocked_boss_id); end if;
    pity_counters := jsonb_set(pity_counters, array[_boss_id], '0'::jsonb, true);
  else
    pity_counters := jsonb_set(pity_counters, array[_boss_id], to_jsonb(current_pity + 1), true);
  end if;

  boss_state_next := boss_state_next || jsonb_build_object('defeatedBossIds', defeated_ids, 'unlockedBossIds', unlocked_ids, 'pityCounters', pity_counters, 'lastBossAttempt', _attempt);

  update public.profiles
     set credits = greatest(0, credits + _credits_delta),
         scrap = scrap + coalesce(_scrap_delta, 0),
         player_level = next_level,
         player_xp = next_xp,
         consumables = next_consumables,
         boss_state = boss_state_next,
         action_skill_charge = v_charge_after,
         updated_at = now()
   where id = _player_id
   returning * into p;

  -- Audit fix A (0040): the attempt's rolled loot is stored INSIDE this
  -- transaction. Before 0040 the route stored items in a second call
  -- after this applier had already committed, so a failure there (the
  -- 0039 cc_store_chef_items overload incident) left a fully recorded
  -- victory whose loot never arrived — the profile fold then counted a
  -- victory the collection fold disagreed with (CONS-02). Storing here
  -- makes attempt + rewards + loot + ledger row one atomic commit; any
  -- failure rolls the whole attempt back. cc_store_chef_items is
  -- idempotent per item id, and a nonce replay returns before this
  -- point, so loot can never double-store.
  perform public.cc_store_chef_items(_player_id, coalesce(_items, '[]'::jsonb));

  result := jsonb_build_object(
    'action_type', 'cc_apply_boss_attempt',
    'profile', public.cc_profile_snapshot(p),
    'boss_id', _boss_id,
    'attempt', _attempt,
    'consumed_batches', consumed_batches,
    'scrap_awarded', coalesce(_scrap_delta, 0),
    'entry_fee', coalesce(_entry_fee, 0),
    'action_skill', jsonb_build_object(
      'tree', _action_skill_tree,
      'fired', _action_skill_tree is not null,
      'charge_after', v_charge_after)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (_player_id, 'cc_apply_boss_attempt', nonce_key, result);

  return result;
end;
$$;

-- ─── player_public_stats: one collection counting rule ─────────────

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
  (select count(*) from public.item_instances ii where ii.owner_user_id = p.id and ii.kind <> 'vehicle' and not (ii.kind = 'weapon' and ii.payload -> 'baseDamage' is null)) as total_items,
  (select count(*) from public.item_instances ii where ii.owner_user_id = p.id and ii.kind = 'weapon' and ii.payload -> 'baseDamage' is not null) as weapons_owned,
  (select count(*) from public.item_instances ii where ii.owner_user_id = p.id and ii.rarity = 'Legendary' and ii.kind <> 'vehicle' and not (ii.kind = 'weapon' and ii.payload -> 'baseDamage' is null)) as legendary_items,
  (select coalesce(max(ii.item_level), 0) from public.item_instances ii where ii.owner_user_id = p.id and ii.kind <> 'vehicle' and not (ii.kind = 'weapon' and ii.payload -> 'baseDamage' is null)) as highest_item_level,
  (select coalesce(sum(pm.mastery_xp), 0) from public.player_masteries pm where pm.user_id = p.id) as total_mastery_xp,
  (select coalesce(max(pm.mastery_level), 0) from public.player_masteries pm where pm.user_id = p.id) as highest_mastery_level,
  p.updated_at as last_active_at,
  p.created_at as joined_at
from public.profiles p
left join public.combat_stats c on c.user_id = p.id
left join public.player_stat_counters psc on psc.user_id = p.id and psc.stat_key = 'account.net_worth';

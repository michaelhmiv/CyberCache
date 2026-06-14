-- Migration 20260615100000: Item estimated_value
--
-- Adds a server-computed estimated_value column to item_instances so that
-- net worth and wealth leaderboards can include gear in a single aggregate.
-- The formula is intentionally conservative and kind-aware; future market
-- data can refine it without changing callers.

-- 1. Add column
alter table public.item_instances
  add column if not exists estimated_value bigint not null default 0;

-- 2. Index for fast net worth aggregation per player
create index if not exists idx_item_instances_owner_value
  on public.item_instances (owner_user_id, estimated_value);

-- 3. Valuation helper
--
-- Computes a relative baseline value from item payload. Weapons use their
-- already-computed combatPower; shields use hp*mitigation; class mods use
-- node boost count + affixes; relics use affix count; ordnance uses damage.
-- Rarity multipliers match the salvaging rarity scale (1/2/5/10/25x).
create or replace function public.cc_compute_item_estimated_value(
  _payload jsonb,
  _kind text,
  _rarity text,
  _item_level integer
)
returns bigint
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_rarity_mult numeric := case _rarity
    when 'Common' then 1
    when 'Uncommon' then 2
    when 'Rare' then 5
    when 'Epic' then 10
    when 'Legendary' then 25
    else 1
  end;
  v_level numeric := greatest(1, coalesce(_item_level, 1));
  v_base numeric := v_level * 100 * v_rarity_mult;
  v_kind_bonus numeric := 0;
  v_affix_count integer;
begin
  if _kind = 'weapon' then
    v_kind_bonus := coalesce((_payload ->> 'combatPower')::numeric, 0) * 2;
  elsif _kind = 'shield' then
    v_kind_bonus := coalesce((_payload ->> 'hp')::numeric, 0) * 0.5
                  * (1 + coalesce((_payload ->> 'mitigation')::numeric, 0));
  elsif _kind = 'classMod' then
    v_affix_count := coalesce(jsonb_array_length(_payload -> 'affixes'), 0);
    v_kind_bonus := (coalesce((select count(*) from jsonb_object_keys(coalesce(_payload -> 'nodeBoosts', '{}'::jsonb))), 0) * 50 + v_affix_count * 30) * v_level;
  elsif _kind = 'relic' then
    v_affix_count := coalesce(jsonb_array_length(_payload -> 'affixes'), 0);
    v_kind_bonus := v_affix_count * 40 * v_rarity_mult;
  elsif _kind = 'ordnance' then
    v_kind_bonus := (
      coalesce((_payload ->> 'damage')::numeric, 0)
      + coalesce((_payload ->> 'shieldDamage')::numeric, 0)
      + coalesce((_payload ->> 'armorDamage')::numeric, 0)
    ) * 1.5;
  end if;

  return floor(v_base + v_kind_bonus)::bigint;
end;
$$;

revoke execute on function public.cc_compute_item_estimated_value(jsonb, text, text, integer) from public, anon;
grant execute on function public.cc_compute_item_estimated_value(jsonb, text, text, integer) to service_role;

-- 4. Backfill existing items
update public.item_instances
   set estimated_value = public.cc_compute_item_estimated_value(payload, kind, rarity, item_level)
 where estimated_value = 0;

-- 5. Update cc_store_chef_items to compute estimated_value at insert time
create or replace function public.cc_store_chef_items(
  _player_id uuid,
  _items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  item_kind text;
  item_rarity text;
  item_level integer;
  item_value bigint;
  inserted_count integer := 0;
begin
  if _items is null or jsonb_array_length(_items) = 0 then
    return jsonb_build_object('inserted', 0);
  end if;

  for item in select * from jsonb_array_elements(_items) loop
    item_kind := case
      when item ? 'weaponType' then 'weapon'
      when item ? 'mitigation' then 'shield'
      when item ? 'treeBonus' then 'classMod'
      when item ? 'damage' and not (item ? 'weaponType') then 'ordnance'
      when item ? 'affixes' and not (item ? 'weaponType') then 'relic'
      else 'gear'
    end;
    item_rarity := item ->> 'rarity';
    item_level := coalesce((item ->> 'level')::integer, 1);
    item_value := public.cc_compute_item_estimated_value(item, item_kind, item_rarity, item_level);

    insert into public.item_instances (
      owner_user_id,
      kind,
      runtime_state,
      is_locked,
      rarity,
      item_level,
      estimated_value,
      payload
    ) values (
      _player_id,
      item_kind,
      'available',
      false,
      item_rarity,
      item_level,
      item_value,
      item
    );
    inserted_count := inserted_count + 1;
  end loop;

  return jsonb_build_object('inserted', inserted_count);
end;
$$;

revoke execute on function public.cc_store_chef_items(uuid, jsonb) from public, anon;
grant execute on function public.cc_store_chef_items(uuid, jsonb) to service_role;

-- 6. Update cc_make_item to compute estimated_value at insert time
create or replace function public.cc_make_item(nonce text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  prior jsonb;
  p public.profiles%rowtype;
  item public.item_instances%rowtype;
  result jsonb;
  odds jsonb;
  rarity_value text;
  item_value bigint;
  item_level integer;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  if p.cache_tokens < 1 then raise exception 'Not enough tokens'; end if;

  odds := public.cc_draw_odds('cache_primary_rarity');
  rarity_value := odds ->> 'outcome';

  update public.profiles set cache_tokens = cache_tokens - 1 where id = actor returning * into p;

  item_level := greatest(1, p.player_level);
  item_value := public.cc_compute_item_estimated_value(
    jsonb_build_object('odds', odds),
    'gear',
    rarity_value,
    item_level
  );

  insert into public.item_instances (owner_user_id, kind, item_level, rarity, estimated_value, supply_mode, payload)
  values (actor, 'gear', item_level, rarity_value, item_value, 'verified_action', jsonb_build_object('odds', odds))
  returning * into item;

  result := jsonb_build_object('action_type', 'cc_make_item', 'profile', public.cc_profile_snapshot(p), 'odds', odds, 'item', to_jsonb(item));

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_make_item', nonce, result);

  return result;
end;
$$;

revoke execute on function public.cc_make_item(text) from public, anon;
grant execute on function public.cc_make_item(text) to authenticated, service_role;

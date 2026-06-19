-- Generate a real weapon payload for cache draws.
create or replace function public.cc_generate_weapon_payload(
  _level integer,
  _rarity text
) returns jsonb
language plpgsql
immutable
as $$
declare
  _types text[] := array['Pistol','SMG','Shotgun','Sniper','Launcher','Beam'];
  _manufacturers text[] := array['Redline','Ironwood','BlastForge','Prismatek','ThrowTech','HelixWorks'];
  _elements text[] := array['Kinetic','Fire','Shock','Corrosive','Cryo','Void'];
  _type text;
  _manufacturer text;
  _element text;
  _base jsonb;
  _level_scalar numeric;
  _rarity_scalar numeric;
  _base_damage numeric;
  _attack_speed numeric;
  _crit_chance numeric;
  _crit_damage numeric;
  _status_chance numeric;
  _status_damage numeric;
  _boss_damage_mod numeric;
  _wave_damage_mod numeric;
  _shield_damage_mod numeric;
  _armor_damage_mod numeric;
  _combat_power numeric;
begin
  _type := _types[1 + floor(random() * array_length(_types, 1))::integer];
  _manufacturer := _manufacturers[1 + floor(random() * array_length(_manufacturers, 1))::integer];
  _element := _elements[1 + floor(random() * array_length(_elements, 1))::integer];

  _level_scalar := 1 + (_level - 1) * 0.08;

  _rarity_scalar := case _rarity
    when 'Common' then 1.0
    when 'Uncommon' then 1.1
    when 'Rare' then 1.25
    when 'Epic' then 1.45
    when 'Legendary' then 1.7
    else 1.0
  end;

  _base := case _type
    when 'Pistol' then '{"baseDamage":80,"attackSpeed":1.2,"critChance":0.1,"critDamage":1.5,"statusChance":0.08,"statusDamage":1.2,"bossDamageMod":1.0,"waveDamageMod":1.0,"shieldDamageMod":1.0,"armorDamageMod":1.0}'::jsonb
    when 'SMG' then '{"baseDamage":45,"attackSpeed":2.0,"critChance":0.08,"critDamage":1.4,"statusChance":0.12,"statusDamage":1.1,"bossDamageMod":0.95,"waveDamageMod":1.15,"shieldDamageMod":1.05,"armorDamageMod":0.9}'::jsonb
    when 'Shotgun' then '{"baseDamage":140,"attackSpeed":0.7,"critChance":0.06,"critDamage":1.6,"statusChance":0.1,"statusDamage":1.3,"bossDamageMod":0.9,"waveDamageMod":1.3,"shieldDamageMod":0.95,"armorDamageMod":1.05}'::jsonb
    when 'Sniper' then '{"baseDamage":200,"attackSpeed":0.5,"critChance":0.25,"critDamage":2.0,"statusChance":0.05,"statusDamage":1.0,"bossDamageMod":1.2,"waveDamageMod":0.7,"shieldDamageMod":1.0,"armorDamageMod":1.1}'::jsonb
    when 'Launcher' then '{"baseDamage":300,"attackSpeed":0.35,"critChance":0.03,"critDamage":1.8,"statusChance":0.15,"statusDamage":1.5,"bossDamageMod":1.15,"waveDamageMod":1.1,"shieldDamageMod":0.85,"armorDamageMod":1.3}'::jsonb
    when 'Beam' then '{"baseDamage":60,"attackSpeed":1.5,"critChance":0.07,"critDamage":1.35,"statusChance":0.2,"statusDamage":1.4,"bossDamageMod":1.0,"waveDamageMod":0.95,"shieldDamageMod":1.15,"armorDamageMod":1.15}'::jsonb
    else '{"baseDamage":80,"attackSpeed":1.2,"critChance":0.1,"critDamage":1.5,"statusChance":0.08,"statusDamage":1.2,"bossDamageMod":1.0,"waveDamageMod":1.0,"shieldDamageMod":1.0,"armorDamageMod":1.0}'::jsonb
  end;

  _base_damage := round((_base->>'baseDamage')::numeric * _level_scalar * _rarity_scalar);
  _attack_speed := round(((_base->>'attackSpeed')::numeric * _level_scalar * 0.98)::numeric, 2);
  _crit_chance := round(least(0.9, (_base->>'critChance')::numeric * _level_scalar * 0.95)::numeric, 3);
  _crit_damage := round(((_base->>'critDamage')::numeric * _level_scalar * 0.97)::numeric, 2);
  _status_chance := round(least(0.9, (_base->>'statusChance')::numeric * _level_scalar)::numeric, 3);
  _status_damage := round(((_base->>'statusDamage')::numeric * _level_scalar * 0.96)::numeric, 2);

  _boss_damage_mod := (_base->>'bossDamageMod')::numeric;
  _wave_damage_mod := (_base->>'waveDamageMod')::numeric;
  _shield_damage_mod := (_base->>'shieldDamageMod')::numeric;
  _armor_damage_mod := (_base->>'armorDamageMod')::numeric;

  _combat_power := round(_base_damage * _attack_speed * (1 + _crit_chance * _crit_damage) * (1 + _status_chance * _status_damage * 0.3));

  return jsonb_build_object(
    'id', null,
    'weaponType', _type,
    'manufacturer', _manufacturer,
    'element', _element,
    'name', _rarity || ' Cache ' || _type,
    'level', _level,
    'rarity', _rarity,
    'baseDamage', _base_damage,
    'attackSpeed', _attack_speed,
    'critChance', _crit_chance,
    'critDamage', _crit_damage,
    'statusChance', _status_chance,
    'statusDamage', _status_damage,
    'bossDamageMod', _boss_damage_mod,
    'waveDamageMod', _wave_damage_mod,
    'shieldDamageMod', _shield_damage_mod,
    'armorDamageMod', _armor_damage_mod,
    'offlineEarningsMod', 0,
    'rareDropChanceMod', 0,
    'scrapYieldMod', 0,
    'rollQuality', 50,
    'parts', '[]'::jsonb,
    'affixes', '[]'::jsonb,
    'sourceTag', 'Cache-Forged',
    'isLocked', false,
    'combatPower', _combat_power,
    'bossPower', _combat_power,
    'farmPower', _combat_power,
    'economyScore', 0
  );
end;
$$;

-- Tighten weapon-slot acceptance: null/empty payload is no longer treated as a weapon.
create or replace function public.cc_item_accepts_slot(payload jsonb, slot_name text)
returns boolean
language sql
immutable
as $$
  select case
    when slot_name in ('primary','secondary','heavy') then payload ? 'weaponType'
    when slot_name = 'shield' then payload ? 'hp' and not payload ? 'weaponType'
    when slot_name = 'classMod' then payload ? 'treeBonus'
    when slot_name = 'ordnance' then payload ? 'damage' and payload ? 'effect' and not payload ? 'weaponType'
    when slot_name = 'relic' then payload ? 'affixes' and not payload ? 'weaponType' and not payload ? 'hp' and not payload ? 'treeBonus' and not payload ? 'damage'
    else false
  end;
$$;

-- cc_make_item now creates a real weapon
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
    'weapon',
    rarity_value,
    item_level
  );

  insert into public.item_instances (
    owner_user_id,
    kind,
    item_level,
    rarity,
    estimated_value,
    supply_mode,
    payload
  ) values (
    actor,
    'weapon',
    item_level,
    rarity_value,
    item_value,
    'verified_action',
    public.cc_generate_weapon_payload(item_level, rarity_value)
  ) returning * into item;

  result := jsonb_build_object('action_type', 'cc_make_item', 'profile', public.cc_profile_snapshot(p), 'odds', odds, 'item', to_jsonb(item));

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_make_item', nonce, result);

  return result;
end;
$$;

-- Clean up historical broken cache rows. They were never equippable and the
-- verified_action_ledger still records the draw for audit purposes.
update public.item_instances
set runtime_state = 'consumed',
    tradeable = false,
    equipped_slot = null
where kind = 'gear'
  and payload ? 'odds'
  and not (payload ? 'weaponType')
  and not (payload ? 'hp')
  and not (payload ? 'damage')
  and not (payload ? 'treeBonus')
  and not (payload ? 'affixes');

revoke execute on function public.cc_generate_weapon_payload(integer, text) from public, anon;
grant execute on function public.cc_generate_weapon_payload(integer, text) to authenticated, service_role;
revoke execute on function public.cc_item_accepts_slot(jsonb, text) from public, anon;
revoke execute on function public.cc_make_item(text) from public, anon;
grant execute on function public.cc_make_item(text) to authenticated, service_role;

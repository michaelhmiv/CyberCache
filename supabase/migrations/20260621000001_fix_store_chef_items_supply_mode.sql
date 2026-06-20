-- =============================================================================
-- Fix: cc_store_chef_items omits supply_mode (NOT NULL, no default)
-- =============================================================================
-- Root cause of the "phantom items" bug. Every Chef-generated item
-- (weapon, shield, classMod, relic, ordnance) failed to persist because
-- the INSERT omitted the supply_mode column, which is NOT NULL with no
-- default value. The claim routes swallowed the error (console.error only)
-- and returned the items to the client anyway, where they accumulated
-- as phantom items that could not be equipped.
--
-- This migration rewrites cc_store_chef_items with supply_mode included.
-- =============================================================================

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
  item_value numeric;
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
      supply_mode,
      payload
    ) values (
      _player_id,
      item_kind,
      'available',
      false,
      item_rarity,
      item_level,
      item_value,
      'verified_action',
      item
    );
    inserted_count := inserted_count + 1;
  end loop;

  return jsonb_build_object('inserted', inserted_count);
end;
$$;

revoke execute on function public.cc_store_chef_items(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.cc_store_chef_items(uuid, jsonb) to service_role;

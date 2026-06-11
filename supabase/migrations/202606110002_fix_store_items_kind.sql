-- Migration 202606110002: Fix cc_store_chef_items missing kind column
--
-- The Chef generates items but cc_store_chef_items didn't include the
-- required `kind` column in its INSERT. The column is NOT NULL.
-- Fix: add `kind` derived from the item payload, defaulting to 'gear'.

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
  inserted_count integer := 0;
begin
  if _items is null or jsonb_array_length(_items) = 0 then
    return jsonb_build_object('inserted', 0);
  end if;

  for item in select * from jsonb_array_elements(_items) loop
    -- Derive kind from the item payload. Weapons have 'weaponType',
    -- shields have 'hp' with 'mitigation', classMods have 'treeBonus',
    -- relics have 'affixes' without 'weaponType', ordnance has 'damage'.
    -- Fall back to 'gear' for any unknown shape.
    item_kind := case
      when item ? 'weaponType' then 'weapon'
      when item ? 'mitigation' then 'shield'
      when item ? 'treeBonus' then 'classMod'
      when item ? 'damage' and not (item ? 'weaponType') then 'ordnance'
      when item ? 'affixes' and not (item ? 'weaponType') then 'relic'
      else 'gear'
    end;

    insert into public.item_instances (
      owner_user_id,
      kind,
      runtime_state,
      is_locked,
      rarity,
      item_level,
      payload
    ) values (
      _player_id,
      item_kind,
      'available',
      false,
      item ->> 'rarity',
      coalesce((item ->> 'level')::integer, 1),
      item
    );
    inserted_count := inserted_count + 1;
  end loop;

  return jsonb_build_object('inserted', inserted_count);
end;
$$;

revoke execute on function public.cc_store_chef_items(uuid, jsonb) from public, anon;
grant execute on function public.cc_store_chef_items(uuid, jsonb) to service_role;

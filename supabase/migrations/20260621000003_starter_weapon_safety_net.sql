-- Safety net: auto-grant a starter weapon on login if the user has zero
-- equippable items. Prevents accounts from getting stuck in an unplayable
-- state (no weapon, no cache tokens, can't farm).
--
-- Called by AuthProvider after syncRuntimeItemsForUser on login.

create or replace function public.cc_ensure_starter_weapon(_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item_count integer;
begin
  select count(*) into item_count
    from public.item_instances
   where owner_user_id = _player_id
     and runtime_state in ('available', 'equipped');

  if item_count = 0 then
    insert into public.item_instances (
      owner_user_id,
      kind,
      supply_mode,
      runtime_state,
      is_locked,
      rarity,
      item_level,
      payload
    ) values (
      _player_id,
      'weapon',
      'verified_action',
      'available',
      false,
      'Common',
      1,
      public.cc_generate_weapon_payload(1, 'Common')
    );
    return jsonb_build_object('granted', true);
  end if;

  return jsonb_build_object('granted', false);
end;
$$;

revoke execute on function public.cc_ensure_starter_weapon(uuid) from public, anon;
grant execute on function public.cc_ensure_starter_weapon(uuid) to authenticated, service_role;

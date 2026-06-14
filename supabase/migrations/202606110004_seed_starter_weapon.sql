-- Migration 202606110003: Seed starter weapon for all profiles
create or replace function public.cc_seed_starter_weapon()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.item_instances where owner_user_id = new.id and kind = 'weapon') then
    return new;
  end if;
  insert into public.item_instances (owner_user_id, kind, supply_mode, runtime_state, is_locked, rarity, item_level, equipped_slot, payload)
  values (new.id, 'weapon', 'verified_action', 'equipped', false, 'Common', 1, 'primary',
    jsonb_build_object('id', gen_random_uuid()::text, 'name', 'Starter Pistol', 'weaponType', 'Pistol', 'element', 'Kinetic', 'manufacturer', 'Redline', 'rarity', 'Common', 'level', 1, 'combatPower', 5, 'bossPower', 3, 'dps', 5, 'sourceTag', 'Starter Kit')
  );
  return new;
end;
$$;

drop trigger if exists trg_seed_starter_weapon on public.profiles;
create trigger trg_seed_starter_weapon after insert on public.profiles for each row execute function public.cc_seed_starter_weapon();

-- Backfill existing profiles — insert AND equip if no weapon in primary slot
insert into public.item_instances (owner_user_id, kind, supply_mode, runtime_state, is_locked, rarity, item_level, equipped_slot, payload)
select p.id, 'weapon', 'verified_action', 'equipped', false, 'Common', 1, 'primary',
  jsonb_build_object('id', gen_random_uuid()::text, 'name', 'Starter Pistol', 'weaponType', 'Pistol', 'element', 'Kinetic', 'manufacturer', 'Redline', 'rarity', 'Common', 'level', 1, 'combatPower', 5, 'bossPower', 3, 'dps', 5, 'sourceTag', 'Starter Kit')
from public.profiles p
where not exists (select 1 from public.item_instances ii where ii.owner_user_id = p.id and ii.equipped_slot = 'primary');

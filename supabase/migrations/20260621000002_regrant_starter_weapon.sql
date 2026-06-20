-- Re-grant a starter weapon for the CyberCacheAdmin account.
-- The user recycled their Starter Pistol on June 17 and all 16 cache
-- draws produced phantom odds-only gear (pre-migration bug). The account
-- has zero equippable items. This inserts a real generated weapon using
-- cc_generate_weapon_payload so the user can play immediately.

insert into public.item_instances (
  owner_user_id,
  kind,
  supply_mode,
  runtime_state,
  is_locked,
  rarity,
  item_level,
  equipped_slot,
  payload
) values (
  '3cbc2896-63ec-4680-9036-14a462dc4539',
  'weapon',
  'verified_action',
  'available',
  false,
  'Common',
  1,
  null,
  public.cc_generate_weapon_payload(1, 'Common')
);

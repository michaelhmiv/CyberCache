-- 0047_item_identity.sql
--
-- DEVICE DEFECT FIX (2026-11-01): "Item not found" on EVERY equip.
--
-- Root cause: cc_store_chef_items inserted every Chef-generated item
-- (roaming claims, offline settlements, boss/endless loot) with a
-- fresh gen_random_uuid() row id while the payload — the object every
-- Chef route hands the client, and the object the client upserts into
-- its inventory — kept the generator's own id. The two id spaces never
-- met: /api/runtime/items returns row ids (equips work after a cold
-- re-sync), but every item earned during a session was displayed and
-- addressed under its payload id, which no item_instances row holds,
-- so cc_equip_item (and salvage / reforge / lock / listing / turn-in)
-- raised 'Item not found' for it. Reproduced end-to-end over HTTP:
-- claim -> response item id -> equip = 404 'Item not found'; the same
-- item under its row id = 200.
--
-- Fix: the stored row takes the payload's id when it is a well-formed
-- uuid not already held (the overwhelmingly normal case), falling back
-- to gen_random_uuid() otherwise. Everything else in the function is
-- the 0021 body verbatim (dedupe still keys on payload id per owner).
-- Existing rows are NOT rewritten: their payload ids are inert display
-- data (the client adapter always addresses rows by row id after a
-- sync), and post-fix stores make the two ids coincide going forward.
--
-- The TS twin (src/server/gameplay/memory.ts storeChefItems) applies
-- the same id rule.

create or replace function public.cc_store_chef_items(
  p_player_id uuid,
  p_items jsonb,
  p_source text default 'chef_claim'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor uuid := p_player_id;
  entry jsonb;
  item_id text;
  row_id uuid;
  kind text;
  stored integer := 0;
  stored_items jsonb := '[]'::jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'items must be an array'; end if;

  for entry in select value from jsonb_array_elements(p_items)
  loop
    item_id := entry ->> 'id';
    if item_id is null or item_id = '' then continue; end if;
    if exists (select 1 from public.item_instances where owner_user_id = actor and payload ->> 'id' = item_id) then continue; end if;

    -- Item identity (0047): the row takes the payload's own id when
    -- it is a well-formed uuid that no row holds yet, so the item the
    -- Chef hands the client IS the item the server can find. Before
    -- 0047 the row minted gen_random_uuid() and every Chef-delivered
    -- item (claim / settle-offline / boss loot) reached the client
    -- under a phantom id — every id-addressed op on it (equip first
    -- among them) failed with 'Item not found'. A payload id already
    -- held by another owner's row falls back to a fresh uuid.
    row_id := null;
    if item_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       and not exists (select 1 from public.item_instances where id = item_id::uuid) then
      row_id := item_id::uuid;
    end if;

    kind := case
      when entry ? 'vehicleClassId' then 'vehicle'
      when entry ? 'weaponType' then 'weapon'
      when entry ? 'mitigation' then 'shield'
      when entry ? 'treeBonus' then 'classMod'
      when entry ? 'damage' then 'ordnance'
      when entry ? 'affixes' then 'relic'
      else 'gear'
    end;

    insert into public.item_instances (
      id, owner_user_id, kind, item_level, rarity,
      condition_current, condition_max,
      supply_mode, tradeable, account_bound, payload, runtime_state,
      estimated_value
    ) values (
      coalesce(row_id, gen_random_uuid()), actor, kind,
      coalesce(nullif(entry ->> 'level', '')::integer, 1),
      coalesce(nullif(entry ->> 'rarity', ''), 'Common'),
      case when kind = 'vehicle' then 100 else null end,
      case when kind = 'vehicle' then 100 else null end,
      'verified_action', true, false, entry, 'available',
      public.cc_compute_item_estimated_value(entry, kind, coalesce(nullif(entry ->> 'rarity', ''), 'Common'), coalesce(nullif(entry ->> 'level', '')::integer, 1))
    );
    stored := stored + 1;
    stored_items := stored_items || entry;
  end loop;

  return jsonb_build_object('source', p_source, 'stored', stored, 'items', stored_items);
end;
$function$;

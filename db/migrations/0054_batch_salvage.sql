-- 0054: Batch salvage — one ceiling-based settlement (owner ruling,
-- 2026-11-02).
--
-- The client bulk-scrap flow used to loop cc_recycle_item once per
-- item: a 1,000+ item salvage fired 1,000 requests and 1,000 result
-- pop-ups and froze the game on the owner's phone. Salvage is now a
-- threshold choice ("everything Rare and under") settled by ONE call:
--
--   cc_recycle_batch(p_player_id, nonce, p_max_rarity)
--
-- p_max_rarity is a CEILING in ('Common','Uncommon','Rare','Epic').
-- 'Legendary' is deliberately NOT a valid ceiling: legendaries are
-- never bulk-scrapped — they recycle one at a time, deliberately,
-- through cc_recycle_item.
--
-- The eligible set is resolved HERE, server-side, from the player's
-- own inventory at settle time (never from a client-supplied list):
-- owned, runtime_state = 'available', not locked, gear kinds only
-- (weapon / shield / ordnance / classMod / relic — vehicles and
-- cosmetic parts keep their own lanes), rarity at or under the
-- ceiling. Equipped items are excluded: the loadout is never
-- dismantled by a bulk op.
--
-- Each item is recycled by the EXISTING cc_recycle_item (derived
-- nonce '<batch nonce>:<item id>'), so the yield is the per-item
-- formula summed — Market Crash 4x, salvage skill bonuses, King of
-- Scrap material rolls, and legendary-core yields all behave exactly
-- as the one-at-a-time path, and every item lands its own
-- verified_action_ledger row (stats/mastery/collection folds see the
-- same records either way). The whole batch runs in this function's
-- transaction: any failure rolls back every item — nothing scraps.
-- The aggregate result is recorded under the batch nonce, so a
-- replayed request returns the original settlement untouched.
--
-- Result shape (aggregates only — no per-item yield list):
--   action_type 'cc_recycle_batch', max_rarity, scrapped_count,
--   counts_by_rarity {rarity: n}, scrap_award (total), cores_award
--   (total), bonus_materials {material: n}, items (the consumed item
--   rows, for client state sync), profile, loadout.

create or replace function public.cc_recycle_batch(p_player_id uuid, nonce text, p_max_rarity text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  result jsonb;
  ceiling_rank integer;
  item_ids uuid[] := '{}'::uuid[];
  item_rarities text[] := '{}'::text[];
  r jsonb;
  i integer;
  n integer := 0;
  scrap_total integer := 0;
  cores_total integer := 0;
  counts_by_rarity jsonb := '{}'::jsonb;
  bonus_materials jsonb := '{}'::jsonb;
  items_out jsonb := '[]'::jsonb;
  bm text;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  ceiling_rank := case p_max_rarity
    when 'Common' then 1
    when 'Uncommon' then 2
    when 'Rare' then 3
    when 'Epic' then 4
    else null
  end;
  if ceiling_rank is null then raise exception 'Invalid salvage ceiling'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  -- Resolve the eligible set up front (ids + rarities, id order for
  -- determinism): the loop below mutates runtime_state as it goes.
  select coalesce(array_agg(id order by id), '{}'::uuid[]),
         coalesce(array_agg(rarity order by id), '{}'::text[])
    into item_ids, item_rarities
    from public.item_instances
   where owner_user_id = actor
     and runtime_state = 'available'
     and is_locked = false
     and kind in ('weapon', 'shield', 'ordnance', 'classMod', 'relic')
     and (case rarity
            when 'Common' then 1
            when 'Uncommon' then 2
            when 'Rare' then 3
            when 'Epic' then 4
            when 'Legendary' then 5
            else 99
          end) <= ceiling_rank;

  n := coalesce(array_length(item_ids, 1), 0);

  for i in 1 .. n loop
    r := public.cc_recycle_item(actor, nonce || ':' || item_ids[i]::text, item_ids[i]);
    scrap_total := scrap_total + coalesce((r ->> 'scrap_award')::integer, 0);
    cores_total := cores_total + coalesce((r ->> 'cores_award')::integer, 0);
    counts_by_rarity := jsonb_set(
      counts_by_rarity,
      array[item_rarities[i]],
      to_jsonb(coalesce((counts_by_rarity ->> item_rarities[i])::integer, 0) + 1),
      true
    );
    bm := r ->> 'bonus_material';
    if bm is not null then
      bonus_materials := jsonb_set(
        bonus_materials,
        array[bm],
        to_jsonb(coalesce((bonus_materials ->> bm)::integer, 0) + 1),
        true
      );
    end if;
    items_out := items_out || jsonb_build_array(r -> 'item');
  end loop;

  select * into p from public.profiles where id = actor;

  result := jsonb_build_object(
    'action_type', 'cc_recycle_batch',
    'max_rarity', p_max_rarity,
    'scrapped_count', n,
    'counts_by_rarity', counts_by_rarity,
    'scrap_award', scrap_total,
    'cores_award', cores_total,
    'bonus_materials', bonus_materials,
    'items', items_out,
    'profile', public.cc_profile_snapshot(p),
    'loadout', public.cc_loadout_snapshot(actor)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_recycle_batch', nonce, result);

  return result;
end;
$function$;

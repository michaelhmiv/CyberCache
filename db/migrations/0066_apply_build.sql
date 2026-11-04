-- 0066: Saved Builds SB-1 — truthful build apply (cc_apply_build).
--
-- A build (the client's loadout preset) used to apply through the
-- client's parallel fan-out of cc_equip_item calls, which had three
-- verified defects (Saved Builds brief §1.2, 2026-11-03):
--   1. The vehicle never swapped — the client resolved every slot
--      through the gear inventory store, which vehicles never enter,
--      so a saved vehicle id always read as missing.
--   2. Missing items failed silently (a console.warn) and the slot's
--      current occupant stayed equipped while the build claimed to
--      be applied — the slice header even claimed the slot was
--      "left empty," which the code never did.
--   3. Application was non-atomic but the active-build marker was
--      not: any subset of equips could land while the UI marked the
--      build active.
--
-- cc_apply_build replaces the fan-out with ONE server operation:
-- one nonce, one transaction, the player's advisory lock, slots
-- processed in canonical slot order with exactly cc_equip_item's
-- per-slot semantics (clear the slot's other occupants, set the
-- row's equipped_slot / runtime_state = 'equipped'). It returns the
-- canonical snapshots plus a PER-SLOT OUTCOME list so the client
-- renders truth instead of guessing:
--
--   equipped     the slot now wears the build's item
--   empty        the build itself has null in that slot; the slot
--                was cleared. Not a failure.
--   gone         the item no longer exists for this player (sold,
--                salvaged, consumed, or never theirs). Remedy:
--                pick a replacement.
--   listed       the item is on the market (runtime_state 'listed');
--                carries the active listing_id. Remedy: delist &
--                equip.
--   in_service   the item is out on dispatch; carries the active
--                mission_id and its ends_at as returns_at. Remedy:
--                wait, or recall where dispatch recall allows.
--   locked       the item is committed to a repair / shield-tech
--                board job (an open service_jobs row targets it —
--                board posting also sets runtime_state 'in_service',
--                so the job row is what distinguishes this from
--                dispatch); carries job_id + job_kind
--                (profession_id). The job's completion is the remedy.
--   incompatible the item exists and is free but no longer fits the
--                slot (cc_item_accepts_slot refuses, or a vehicle
--                payload's class no longer resolves). A build saved
--                from a live loadout cannot produce this; it exists
--                so a stale build reports instead of throwing the
--                whole apply away. Remedy: pick a replacement.
--
-- Partial application is allowed and fully reported: every slot the
-- op can apply, it applies; a slot it cannot apply LEAVES ITS
-- CURRENT OCCUPANT EQUIPPED (a build that can't fully land never
-- strips working gear) and names why in its outcome. The result's
-- `applied` flag is true only when every slot outcome is 'equipped'
-- or 'empty' — the client moves the active-build marker only then.
--
-- Edge rules, chosen deliberately:
--   * Builds are references, not claims (brief D8): nothing here
--     locks, reserves, or warns on items a build merely names.
--   * A build naming the same item id in two slots is malformed
--     (a live loadout can never produce one — an item occupies
--     exactly one slot). The first slot in canonical order wins;
--     later duplicates report 'gone' — from that slot's perspective
--     the item is not available to it, and the remedy (pick a
--     replacement) is the correct player action.
--   * Swap-anywhere (brief D4): like cc_equip_item, this op has NO
--     active-action check. Craft jobs and dispatch settle from
--     departure snapshots; roaming / boss / offline derive from the
--     equipped records at settlement, so a mid-action swap only
--     changes what the next settlement derives.
--   * The belt (boss consumable assignments) is client display
--     state and is NOT part of this op; the client applies it only
--     after this op returns, so a failed apply never leaves belt
--     and gear from different builds.
--
-- The InMemory twin (InMemoryWriteStore.applyBuild) mirrors this
-- function outcome-for-outcome; parity is pinned by
-- src/test/savedBuildsApply.test.ts.

CREATE OR REPLACE FUNCTION public.cc_apply_build(p_player_id uuid, nonce text, slots jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  slot_name text;
  raw jsonb;
  target_text text;
  target_id uuid;
  item public.item_instances%rowtype;
  seen_ids uuid[] := '{}';
  outcomes jsonb := '[]'::jsonb;
  changed_items jsonb := '[]'::jsonb;
  cleared_items jsonb;
  v_listing_id uuid;
  v_job_id uuid;
  v_job_kind text;
  v_mission_id uuid;
  v_returns_at timestamptz;
  v_outcome text;
  v_applied boolean;
  v_equipped_count integer := 0;
  v_attention_count integer := 0;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if slots is null or jsonb_typeof(slots) <> 'object' then raise exception 'Invalid build'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  foreach slot_name in array array['primary','secondary','heavy','ordnance','shield','classMod','relic','vehicle'] loop
    raw := slots -> slot_name;
    v_listing_id := null;
    v_job_id := null;
    v_job_kind := null;
    v_mission_id := null;
    v_returns_at := null;

    if raw is null or raw = 'null'::jsonb then
      -- The build itself leaves this slot empty: clear it.
      with cleared as (
        update public.item_instances
        set equipped_slot = null,
            runtime_state = case when is_locked then 'locked' else 'available' end
        where owner_user_id = actor
          and equipped_slot = slot_name
        returning *
      )
      select coalesce(jsonb_agg(to_jsonb(cleared)), '[]'::jsonb) into cleared_items from cleared;
      changed_items := changed_items || cleared_items;
      outcomes := outcomes || jsonb_build_array(jsonb_build_object(
        'slot', slot_name,
        'item_id', null,
        'outcome', 'empty',
        'listing_id', null,
        'mission_id', null,
        'returns_at', null,
        'job_id', null,
        'job_kind', null
      ));
      continue;
    end if;

    if jsonb_typeof(raw) <> 'string' then raise exception 'Invalid build'; end if;
    target_text := raw #>> '{}';
    if target_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Invalid build';
    end if;
    target_id := target_text::uuid;

    if target_id = any(seen_ids) then
      -- Malformed build (same item named twice): first slot won.
      outcomes := outcomes || jsonb_build_array(jsonb_build_object(
        'slot', slot_name,
        'item_id', target_id,
        'outcome', 'gone',
        'listing_id', null,
        'mission_id', null,
        'returns_at', null,
        'job_id', null,
        'job_kind', null
      ));
      v_attention_count := v_attention_count + 1;
      continue;
    end if;
    seen_ids := seen_ids || target_id;

    select * into item from public.item_instances where id = target_id and owner_user_id = actor for update;

    if not found then
      v_outcome := 'gone';
    elsif item.runtime_state in ('consumed','salvaged') then
      v_outcome := 'gone';
    elsif item.runtime_state = 'listed' then
      v_outcome := 'listed';
      select id into v_listing_id
      from public.market_listings
      where seller_user_id = actor
        and item_instance_id = item.id
        and status = 'active'
      order by listed_at asc
      limit 1;
    elsif exists (
      select 1 from public.service_jobs j
      where j.owner_user_id = actor
        and j.target_item_instance_id = item.id
        and j.status not in ('completed','cancelled')
    ) then
      v_outcome := 'locked';
      select id, profession_id into v_job_id, v_job_kind
      from public.service_jobs j
      where j.owner_user_id = actor
        and j.target_item_instance_id = item.id
        and j.status not in ('completed','cancelled')
      order by j.created_at asc
      limit 1;
    elsif item.runtime_state = 'in_service' then
      v_outcome := 'in_service';
      select id, ends_at into v_mission_id, v_returns_at
      from public.dispatch_missions
      where user_id = actor
        and status = 'active'
        and (item.id = any(loadout_item_ids) or vehicle_item_id = item.id)
      order by ends_at asc
      limit 1;
    elsif not public.cc_item_accepts_slot(coalesce(item.payload, '{}'::jsonb), slot_name) then
      v_outcome := 'incompatible';
    elsif slot_name = 'vehicle' and public.cc_vehicle_unlock_level(item.payload ->> 'vehicleClassId') is null then
      -- cc_equip_item's payload-integrity check, as an outcome.
      v_outcome := 'incompatible';
    else
      -- Equip with cc_equip_item's semantics: clear the slot's other
      -- occupants, then move the item in.
      with cleared as (
        update public.item_instances
        set equipped_slot = null,
            runtime_state = case when is_locked then 'locked' else 'available' end
        where owner_user_id = actor
          and equipped_slot = slot_name
          and id <> item.id
        returning *
      )
      select coalesce(jsonb_agg(to_jsonb(cleared)), '[]'::jsonb) into cleared_items from cleared;

      update public.item_instances
      set equipped_slot = slot_name,
          runtime_state = 'equipped'
      where id = item.id
      returning * into item;

      changed_items := changed_items || cleared_items || jsonb_build_array(to_jsonb(item));
      v_outcome := 'equipped';
    end if;

    if v_outcome = 'equipped' then
      v_equipped_count := v_equipped_count + 1;
    else
      v_attention_count := v_attention_count + 1;
    end if;

    outcomes := outcomes || jsonb_build_array(jsonb_build_object(
      'slot', slot_name,
      'item_id', target_id,
      'outcome', v_outcome,
      'listing_id', v_listing_id,
      'mission_id', v_mission_id,
      'returns_at', v_returns_at,
      'job_id', v_job_id,
      'job_kind', v_job_kind
    ));
  end loop;

  v_applied := v_attention_count = 0;

  result := jsonb_build_object(
    'action_type', 'cc_apply_build',
    'profile', public.cc_profile_snapshot(p),
    'loadout', public.cc_loadout_snapshot(actor),
    'items', changed_items,
    'outcomes', outcomes,
    'applied', v_applied,
    'equipped_count', v_equipped_count,
    'attention_count', v_attention_count
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_apply_build', nonce, result);
  return result;
end;
$function$;

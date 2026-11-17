-- =====================================================================
-- 0100 — The look record learns hunter identity (device-pass fix
-- round, Batch 3 — portraits).
--
-- The paintings conversion (DESIGN.md §12, 2026-11-15 Cast B ruling;
-- 2026-11-17 no-weapon-in-hand entry) retired the segmented part
-- figure on the stage and the Hunter tab, but the PUBLIC portrait
-- surfaces — Standings rows, the profile sheet and panel — still
-- render other hunters from the parts-based look record, because
-- the record never said WHICH hunter a player fields. This
-- migration closes that gap:
--
--   * cc_hunter_look_view restated (0053 body VERBATIM + the ONE
--     marked 0100 insertion): the returned record gains
--     `activeHunterId` — the player's fielded hunter, resolved by
--     0097's own cc_profile_active_hunter, so a NULL or stale
--     stored id resolves through the action-skill selection to the
--     default hunter exactly as every other surface resolves it.
--     The parts payload is unchanged: parts stay grandfathered
--     collection data, and the record keeps carrying them for the
--     readers that remain until Batch 4 retires the write path.
--
-- What this migration deliberately does NOT carry: a worn
-- whole-skin id. Wearing is device-local presentation state
-- (hunterWardrobeSlice, 'cc-hunter-wardrobe') — the server holds
-- whole-skin OWNERSHIP records (0099) but no worn selection, so
-- there is no server fact to project. Portraits therefore render
-- the fielded hunter's base painting, which is also the only
-- painting that exists per hunter today (the slice (d) catalog
-- holds base skins only).
--
-- Application: staging rehearsal first, then production — applied
-- manually by the parent before merge; the Chef never runs
-- migrations.
-- =====================================================================

-- ─── cc_hunter_look_view (0053 head + the marked 0100 insertion) ──

create or replace function public.cc_hunter_look_view(p_player_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  sel public.player_skin_selection%rowtype;
  v_found boolean;
  v_parts jsonb := '{}'::jsonb;
  v_slot text;
  v_item_id text;
  v_item public.item_instances%rowtype;
begin
  select * into sel from public.player_skin_selection where user_id = p_player_id;
  v_found := found;
  if v_found then
    for v_slot, v_item_id in
      select key, value from jsonb_each_text(sel.equipped)
    loop
      select * into v_item from public.item_instances
       where id = v_item_id::uuid and owner_user_id = p_player_id
         and kind = 'cosmetic' and runtime_state in ('available', 'locked');
      if found then
        v_parts := jsonb_set(v_parts, array[v_slot], jsonb_build_object(
          'partId', v_item.payload ->> 'partId',
          'tintPaletteId', v_item.payload ->> 'tintPaletteId',
          'quality', (v_item.payload ->> 'quality')::integer
        ), true);
      end if;
    end loop;
  end if;
  return jsonb_build_object(
    'headVariant', case when v_found then sel.head_variant else 'visor' end,
    'parts', v_parts,
    -- 0100 insertion: the fielded hunter's identity, resolved by
    -- 0097's cc_profile_active_hunter (stored id when valid, else
    -- the selection-derived default). NULL only when the profile
    -- itself does not exist; the client falls back the same way.
    'activeHunterId', (
      select public.cc_profile_active_hunter(p)
        from public.profiles p
       where p.id = p_player_id
    )
  );
end;
$$;

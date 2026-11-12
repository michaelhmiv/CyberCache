-- 0092 — cc_cosmetics_view: tier is a string union, not an integer (audit G-F4).
--
-- The 0053 view casts the payload tier to integer, but crafted
-- cosmetics carry the string tiers of the tint system ('repaint',
-- 'shaped') — so GET /api/cosmetics/me 500'd with 'invalid input
-- syntax for type integer: "repaint"' for exactly the accounts that
-- own repaint-tier cosmetics. The in-memory twin has always mapped
-- the value as the string union (repaint/shaped pass through,
-- anything else reads 'palette'). This restates cc_cosmetics_view
-- from 0053 with exactly that one expression changed to the twin's
-- mapping. No other expression changes.
--

create or replace function public.cc_cosmetics_view(p_player_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  sel public.player_skin_selection%rowtype;
  v_found boolean;
begin
  select * into sel from public.player_skin_selection where user_id = p_player_id;
  v_found := found;
  return jsonb_build_object(
    'selectionExists', v_found,
    'selection', jsonb_build_object(
      'equipped', case when v_found then sel.equipped else '{}'::jsonb end,
      'headVariant', case when v_found then sel.head_variant else 'visor' end
    ),
    'parts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'name', i.payload ->> 'name',
        'partId', i.payload ->> 'partId',
        'slot', i.payload ->> 'slot',
        'setId', i.payload ->> 'setId',
        'tier', case when i.payload ->> 'tier' in ('repaint', 'shaped')
                     then i.payload ->> 'tier' else 'palette' end,
        'quality', (i.payload ->> 'quality')::integer,
        'tintPaletteId', i.payload ->> 'tintPaletteId',
        'runtimeState', i.runtime_state
      ) order by i.created_at)
      from public.item_instances i
      where i.owner_user_id = p_player_id
        and i.kind = 'cosmetic'
        and i.runtime_state in ('available', 'locked')
    ), '[]'::jsonb),
    'grandfatherHeads', coalesce((
      select jsonb_agg(ms.manufacturer order by ms.manufacturer)
      from public.manufacturer_standing ms
      where ms.player_id = p_player_id and ms.rank >= 3
    ), '[]'::jsonb)
  );
end;
$$;

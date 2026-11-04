-- 0070_drop_receipts.sql — Activity Log slice AL-1 (drop receipts, recording only)
--
-- The game computes an item's provenance and its drop odds at the
-- moment of generation and discards them: generated items land in
-- item_instances with source_id NULL on every path, and the shaped
-- chances in force for the roll are stored nowhere. AL-1 makes the
-- Chef stamp the receipt onto the item payload at generation
-- (foundVia / foundContext / foundEnemy / dropOdds — TS side:
-- src/server/dropReceipts.ts + the generation sites in
-- src/server/chef.ts). This migration is the SQL half:
--
--   1. cc_store_chef_items (restated from its chain head, 0047)
--      additionally writes the existing source_id column, derived
--      from the payload's receipt: foundVia, or
--      foundVia:foundContext when a context is stamped. Unstamped
--      payloads keep NULL — pre-AL-1 items are never back-computed.
--   2. cc_draw_odds(text, numeric) (restated from its chain head,
--      0031) additionally stamps odds_table_version — the version of
--      the odds_tables row the draw read — onto the draw record, so
--      a future re-seed can never silently re-read historical cache
--      probabilities against new weights. cc_make_item embeds this
--      record verbatim, so every cache draw record gains the stamp.
--
-- Deliberately NOT restated here: cc_apply_chef_rewards and
-- cc_settle_offline_roaming already record area_id in their
-- result_payloads (0014 / 0034, verified in the SQL bodies and in
-- both TS twins) — AL-1 pins that by test instead of restating two
-- hot appliers for nothing. cc_apply_chef_boss_attempt is likewise
-- untouched: it stores the attempt jsonb verbatim, and the
-- dedicated-drop stamp (dedicatedChance / dedicatedDropAwarded /
-- dropLuckBonus) rides that jsonb from processBossAttempt.
--
-- Recording only: no payout, price, drop-rate, or outcome behavior
-- changes anywhere in this migration.
--
-- NOT APPLIED TO PRODUCTION — the parent applies this live pre-merge.
--
-- Provenance:
--   cc_store_chef_items  <- 0047 body verbatim + the source_id write.
--   cc_draw_odds         <- 0031 body verbatim + the version stamp.

-- ---------------------------------------------------------------------
-- 1. cc_store_chef_items: the 0047 body verbatim, plus source_id.
-- ---------------------------------------------------------------------
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
      estimated_value, source_id
    ) values (
      coalesce(row_id, gen_random_uuid()), actor, kind,
      coalesce(nullif(entry ->> 'level', '')::integer, 1),
      coalesce(nullif(entry ->> 'rarity', ''), 'Common'),
      case when kind = 'vehicle' then 100 else null end,
      case when kind = 'vehicle' then 100 else null end,
      'verified_action', true, false, entry, 'available',
      public.cc_compute_item_estimated_value(entry, kind, coalesce(nullif(entry ->> 'rarity', ''), 'Common'), coalesce(nullif(entry ->> 'level', '')::integer, 1)),
      -- AL-1 (0070): the drop receipt's source, from the payload's
      -- first two stamp fields — foundVia, or foundVia:foundContext
      -- when a context is stamped ('roam:dustwaste_frontier',
      -- 'boss:dune_tyrant', 'endless:25', …). The TS twin
      -- (gameplay/memory.ts storeChefItems) derives the identical
      -- string via sourceIdFromPayload. Unstamped payloads stay NULL.
      case
        when coalesce(entry ->> 'foundVia', '') <> '' then
          (entry ->> 'foundVia') || case
            when coalesce(entry ->> 'foundContext', '') <> '' then ':' || (entry ->> 'foundContext')
            else ''
          end
        else null
      end
    );
    stored := stored + 1;
    stored_items := stored_items || entry;
  end loop;

  return jsonb_build_object('source', p_source, 'stored', stored, 'items', stored_items);
end;
$function$;

-- ---------------------------------------------------------------------
-- 2. cc_draw_odds(text, numeric): the 0031 body verbatim, plus the
--    odds-table version stamp on the draw record.
-- ---------------------------------------------------------------------
create or replace function public.cc_draw_odds(table_name text, p_quality numeric)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  total numeric;
  pick numeric;
  running numeric := 0;
  candidate record;
  min_outcome text;
  q numeric := greatest(0::numeric, coalesce(p_quality, 0));
  -- AL-1 (0070): the version of the odds table this draw reads.
  v_version integer;
begin
  select version into v_version
    from public.odds_tables where id = table_name;
  select min(outcome) into min_outcome
    from public.odds_outcomes where table_id = table_name;
  select sum(case when outcome = min_outcome then weight::numeric
                  else weight::numeric * (1 + q) end)
    into total
    from public.odds_outcomes
   where table_id = table_name;
  if total is null or total <= 0 then
    raise exception 'No outcomes configured for %', table_name;
  end if;
  pick := floor(random() * total)::numeric + 1;
  for candidate in
    select outcome, weight, payload
      from public.odds_outcomes
     where table_id = table_name
     order by outcome
  loop
    running := running + case when candidate.outcome = min_outcome
                              then candidate.weight::numeric
                              else candidate.weight::numeric * (1 + q) end;
    if pick <= running then
      return jsonb_build_object('table_id', table_name, 'outcome', candidate.outcome,
        'roll', pick, 'total_weight', total, 'payload', candidate.payload,
        'cache_quality', q, 'odds_table_version', v_version);
    end if;
  end loop;
  raise exception 'Outcome resolution failed for %', table_name;
end;
$$;

-- Migration 0102 — Skill-routing fix: hunter gating for the SQL
-- service-term chain + the completion snapshot (owner-approved
-- program, 2026-11-17; audit: skill-routing-audit-2026-11-17).
--
-- The law (APPROVAL-BRIEF §2.2): a hunter's skill-tree effects are
-- live only while that hunter is fielded, applied at the ACTION
-- INSTANT (enqueue / sale / repair start / draw). Migration 0097
-- gated cc_recycle_item and cc_accept_listing and named this chain
-- as the follow-up in its own header; 0102 closes it:
--
--   * cc_enqueue_craft_job (from 0075): every Fixer term zeroes
--     unless Doc Sutter is fielded; Doc's base perk (Master's
--     Hands: craftSpeedBonus +0.025, craftQualityBonus +1 — the
--     terms the TS derivation has always carried) joins the SQL
--     derivation; the quality/temper completion terms are computed
--     here, gated, and snapshotted onto the job
--     (snapshot.skillQualityBonus / skillTemperBonus).
--   * cc_complete_craft_unit (from 0099): consumes the enqueue
--     snapshot for its quality/temper terms; pre-0102 jobs fall
--     back to the live derivation, now gated + perked identically.
--   * cc_enqueue_repair_job (from 0078) + cc_accept_repair_job
--     (from 0038): the Fixer repair terms gate at enqueue/accept.
--   * cc_vendor_sell (from 0038): Appraiser's Eye gates at the sale.
--   * cc_make_item (from 0082): the cacheQuality skill term gates
--     at the draw (Scavenger); the Cache Rank term is untouched.
--
-- Every restated body is its chain head verbatim outside the
-- marked 0102 blocks. The Demolition consumableEfficiency node
-- copy is corrected at the foot of this migration (F6): the shared
-- quantized formula delivers 2% steps up to −20%, not −2%/point.

-- ─── cc_enqueue_craft_job (chain head 0075 + the 0102 gate/perk/snapshot) ───

create or replace function public.cc_enqueue_craft_job(
  p_player_id uuid,
  nonce text,
  p_bench integer,
  p_recipe_id text,
  p_units integer,
  p_rarity text,
  p_use_catalyst boolean,
  p_use_rush_ticket boolean,
  p_efficiency_bonus numeric,
  p_use_core_catalyst boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  recipe jsonb;
  v_units integer := coalesce(p_units, 0);
  v_bench integer := coalesce(p_bench, 0);
  v_kind text;
  v_rarity text := nullif(coalesce(p_rarity, ''), '');
  v_catalyst text := null;
  v_escrow jsonb := '{}'::jsonb;
  v_escrow_catalyst jsonb := '{}'::jsonb;
  v_key text;
  v_per_unit numeric;
  v_available integer;
  v_relic_id uuid;
  v_relic_payload jsonb;
  v_aff jsonb;
  v_relic_min_bonus numeric := 0;
  v_scrap_cost bigint;
  v_tool_quality numeric := 1;
  v_tool_duration numeric := 1;
  v_tool_yield numeric := 0;
  v_tool_bonus numeric := 0;
  v_rush_quality numeric := null;
  v_rush_origin text := null;
  v_rush_reduction numeric := 0;
  v_ticket_count integer;
  v_core_catalyst boolean := coalesce(p_use_core_catalyst, false);
  v_escrow_cores integer := 0;
  v_consumed jsonb;
  v_skill_mult numeric;
  v_mod_payload jsonb;
  v_craft_speed_bonus numeric := 0;
  v_workshop_queue_bonus integer := 0;
  v_rush_cap_bonus numeric := 0;
  v_core_draw_bonus integer := 0;
  v_skill_quality_bonus numeric := 0;
  v_skill_temper_bonus numeric := 0;
  v_scalar numeric := least(2.0, greatest(0.5,
    public.cc_economy_config_number('craftTimeScalar', 1.0)));
  v_base_duration bigint;
  v_duration bigint;
  v_job public.craft_jobs%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  -- Settle first: gates and snapshots read post-settle state.
  perform public.cc_settle_craft_jobs(actor);
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  -- Guest access (0048): enqueueing is open to every authenticated
  -- account, guests included (Michael's ruling, 2026-11-01:
  -- "Verified account shouldn't be needed for crafting"). The
  -- player-market gate is a separate treatment and is NOT changed:
  -- can_use_player_economy still guards the market ops, standing
  -- ops, and every other economy surface that carries it.

  -- Fixer derivation (0029): every Fixer term reads the player's OWN
  -- records (skill_spends + the equipped class mod payload) through
  -- cc_skill_effective_points — the SQL mirror of computeSkillBonuses.
  -- No request parameter carries a Fixer value.
  select payload into v_mod_payload from public.item_instances
   where owner_user_id = actor and runtime_state = 'equipped' and payload ? 'treeBonus'
   limit 1;
  v_craft_speed_bonus := 0.025 * (
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_craft_time_1', 'Fixer', 5)
    + public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_craft_time_2', 'Fixer', 5));
  v_workshop_queue_bonus :=
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_keystone', 'Fixer', 1)::integer;
  v_rush_cap_bonus := 0.10 *
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_keystone', 'Fixer', 1);
  v_core_draw_bonus :=
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_keystone', 'Fixer', 1)::integer;
  -- Completion terms (0029's quality/temper derivations), computed
  -- HERE at enqueue since migration 0102: completion consumes them
  -- from the job snapshot, never from a live read (see
  -- cc_complete_craft_unit).
  v_skill_quality_bonus := 1.0 * (
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_quality_1', 'Fixer', 5)
    + public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_quality_2', 'Fixer', 5));
  v_skill_temper_bonus := 0.05 *
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_major_1', 'Fixer', 1);

  -- Skill-routing fix (0102): HUNTER GATING at the action instant
  -- (brief §2.2 — a hunter's tree effects are live only while that
  -- hunter is fielded). Every Fixer term above zeroes unless Doc
  -- Sutter is the fielded hunter — the gate cc_recycle_item (0097)
  -- and cc_accept_listing (0099) already apply to their families.
  if public.cc_profile_active_tree(p) <> 'Fixer' then
    v_craft_speed_bonus := 0;
    v_workshop_queue_bonus := 0;
    v_rush_cap_bonus := 0;
    v_core_draw_bonus := 0;
    v_skill_quality_bonus := 0;
    v_skill_temper_bonus := 0;
  end if;
  -- Doc Sutter's base perk (Master's Hands) joins the same terms
  -- while he is fielded — the SQL craft derivations gain the perk
  -- the TS derivation (computeHunterSkillBonuses) has always added.
  if public.cc_profile_active_hunter(p) = 'doc' then
    v_craft_speed_bonus := v_craft_speed_bonus + 0.025;
    v_skill_quality_bonus := v_skill_quality_bonus + 1;
  end if;

  recipe := public.cc_craft_recipe(p_recipe_id);
  if recipe is null then raise exception 'Unknown craft recipe'; end if;
  v_kind := recipe ->> 'kind';

  -- Cosmetics (0053): the tint craft is an item-target job and
  -- starts only through cc_enqueue_tint_job; per-recipe unit caps
  -- (prestige crafts) bind here.
  if coalesce((recipe ->> 'tintCraft')::boolean, false) then
    raise exception 'Tint crafts start from the Tinting action';
  end if;
  if recipe ->> 'maxUnits' is not null
     and v_units > (recipe ->> 'maxUnits')::integer then
    raise exception 'This craft runs at most % units at a time', recipe ->> 'maxUnits';
  end if;

  if v_units < 1 then raise exception 'units must be a positive integer'; end if;
  if v_units > 500 then raise exception 'units exceeds the per-job maximum of 500'; end if;
  if v_bench < 1 or v_bench > 3 then raise exception 'bench must be 1, 2 or 3'; end if;
  -- Bench collapse (slice 9): one bench. Requests naming a
  -- retired tier land on it; every profile owns it and every
  -- catalog requiresBench is 1.
  v_bench := 1;
  if v_bench > coalesce(p.workshop_benches, 1) then raise exception 'Bench not unlocked'; end if;
  if v_bench < (recipe ->> 'requiresBench')::integer then
    raise exception 'Recipe requires bench % or higher', recipe ->> 'requiresBench';
  end if;
  if p.player_level < (recipe ->> 'requiresLevel')::integer then
    raise exception 'Requires level %', recipe ->> 'requiresLevel';
  end if;
  if recipe ->> 'requiresResearch' is not null
     and not exists (
       select 1 from public.research_completions
        where user_id = actor and course_id = recipe ->> 'requiresResearch'
     ) then
    raise exception 'research_required';
  end if;

  -- Manufacturer Standing (0043): the rank gate, beside the research
  -- gate. Rank is a granted fact on manufacturer_standing; a missing
  -- row is rank 0.
  if recipe -> 'requiresStanding' is not null
     and coalesce((
       select rank from public.manufacturer_standing
        where player_id = actor
          and manufacturer = recipe -> 'requiresStanding' ->> 'manufacturer'
     ), 0) < (recipe -> 'requiresStanding' ->> 'rank')::integer then
    raise exception 'standing_required';
  end if;
  if recipe -> 'requiresMastery' is not null
     and public.cc_player_mastery_level(actor, recipe -> 'requiresMastery' ->> 'track')
         < (recipe -> 'requiresMastery' ->> 'level')::integer then
    raise exception 'Requires % mastery %',
      recipe -> 'requiresMastery' ->> 'track', recipe -> 'requiresMastery' ->> 'level';
  end if;

  -- Gear rarity: forced at enqueue, Epic-capped by law. The
  -- rarity bench gates retired with the collapse (slice 9) — Epic
  -- keeps its surviving carrier, the mastery gate. Named relics
  -- mint at the recipe's fixed rarity; the caller's rarity and
  -- the mastery gate do not apply to them.
  if v_kind = 'gear' then
    if recipe ->> 'namedRelic' is not null then
      v_rarity := recipe ->> 'fixedRarity';
    else
      if v_rarity is null or v_rarity not in ('Common', 'Uncommon', 'Rare', 'Epic') then
        if v_rarity = 'Legendary' then
          raise exception 'Legendary gear cannot be crafted';
        end if;
        raise exception 'A craftable rarity (Common–Epic) is required';
      end if;
      if v_rarity = 'Epic'
         and public.cc_player_mastery_level(actor, 'crafting.gear') < 10 then
        raise exception 'Epic frames require crafting.gear mastery 10';
      end if;
    end if;
  end if;

  -- Named relics take no catalyst (slice 9): their affixes are
  -- fixed, so a catalyst would burn for zero effect — the refusal
  -- is the remedy (the §9.1 defect class).
  if recipe ->> 'namedRelic' is not null
     and (coalesce(p_use_catalyst, false) or v_core_catalyst) then
    raise exception 'Named relic crafts take no catalyst — the relic is fixed';
  end if;

  -- Queue capacity — THE BENCH ENVELOPE (slice 9; widened by
  -- Econ 10, brief §8.3): baseline one running + five queued plus
  -- the Fixer keystone's workshop_queue_bonus (0029); while the
  -- bench-time bank is above zero the envelope is the pre-collapse
  -- shape — three running + fifteen queued, the bonus counting
  -- once per pre-collapse bench (x3). The rule's owner is
  -- content/crafting.ts benchEnvelope; the settle at this
  -- function's head has already drained the bank, so the figure
  -- read here is the envelope in force at enqueue time.
  if (select count(*) from public.craft_jobs
       where owner_user_id = actor and status = 'active' and bench = v_bench)
       >= (case when coalesce(p.bench_time_banked_seconds, 0) > 0
                then 18 + 3 * v_workshop_queue_bonus
                else 6 + v_workshop_queue_bonus end) then
    raise exception 'Bench queue is full';
  end if;

  -- Catalyst (§2.5b): first match in the TS CATALYSTS order wins.
  if coalesce(p_use_catalyst, false) then
    v_catalyst := case
      when recipe ->> 'consumableType' in ('BossScanner', 'DataSkimmer') then 'Siltglass'
      when recipe ->> 'consumableType' in ('OverchargeStim', 'IncendiaryAmmo', 'ShockAmmo', 'CorrosiveAmmo', 'CryoAmmo', 'VoidAmmo') then 'NitrocellGel'
      when recipe ->> 'consumableType' in ('ShieldCell', 'PatchKit', 'FieldPatchKit', 'MasterPatchKit') then 'HeartwoodResin'
      when recipe ->> 'consumableType' in ('OrdnanceCharge', 'EMPCharge', 'CorrosiveCharge') then 'ForgeheartIngots'
      when recipe ->> 'consumableType' = 'LuckBooster' then 'PrismShards'
      when recipe ->> 'consumableType' in ('SalvageContract', 'MagnetizedPayload') then 'MagnetiteCores'
      when recipe ->> 'consumableType' in ('NanoSwarm', 'AdrenalineShot') then 'MycoSteelFiber'
      when v_kind = 'gear' then 'ForgeheartIngots'
      else null
    end;
    if v_catalyst is null then raise exception 'Recipe takes no catalyst'; end if;
    -- (slice 9: catalysts run on the one bench — the Forge
    -- bench gate retired with the tiers.)
  end if;

  -- Legendary Core Catalyst (0026): gear frames only — one legendary
  -- core per unit escrowed at enqueue buys +2 generation draws per
  -- completed unit (the gear system's quality currency; consumables
  -- keep the material catalyst family). Mutually exclusive with the
  -- material catalyst, Forge-gated like it.
  if v_core_catalyst then
    if v_catalyst is not null then
      raise exception 'Choose one catalyst: material or legendary core';
    end if;
    if v_kind <> 'gear' then
      raise exception 'Legendary core catalyst applies to gear frames only';
    end if;
    v_escrow_cores := v_units;
  end if;

  -- Economy brief §4 (0072): the recipe's Scrap leg resolves through
  -- its per-recipe lever at enqueue — cc_economy_config_number reads
  -- recipeScrap.<recipeId>, clamped to the registry spec [0, 100000],
  -- falling back to the catalog literal when no row is set. The
  -- resolved figure replaces the leg in the local recipe copy, so
  -- the escrow loop below prices (and escrow_inputs snapshots) the
  -- resolved cost; a later lever move never reprices this job, and
  -- cancel refunds ride the snapshot unchanged. Only the Scrap leg
  -- is config-backed — every other input stays the catalog literal.
  if recipe -> 'inputs' ? 'Scrap' then
    v_scrap_cost := greatest(0, least(100000, coalesce(
      public.cc_economy_config_number('recipeScrap.' || p_recipe_id,
        (recipe -> 'inputs' ->> 'Scrap')::numeric),
      (recipe -> 'inputs' ->> 'Scrap')::numeric)))::bigint;
    recipe := jsonb_set(recipe, '{inputs,Scrap}', to_jsonb(v_scrap_cost));
  end if;

  -- Verify the full escrow before taking any of it (atomicity).
  for v_key, v_per_unit in
    select key, value::numeric from jsonb_each_text(recipe -> 'inputs')
  loop
    v_escrow := jsonb_set(v_escrow, array[v_key], to_jsonb((v_per_unit * v_units)::bigint));
    if public.cc_is_material_key(v_key) then
      v_available := coalesce((p.materials ->> v_key)::integer, 0);
      if v_available < v_per_unit * v_units then
        raise exception 'Insufficient material %', v_key;
      end if;
    else
      v_available := coalesce((p.essences ->> v_key)::integer, 0);
      if v_available < v_per_unit * v_units then
        raise exception 'Insufficient essence %', v_key;
      end if;
    end if;
  end loop;
  if v_catalyst is not null then
    v_escrow_catalyst := jsonb_build_object(v_catalyst, v_units);
    if coalesce((p.materials ->> v_catalyst)::integer, 0) < v_units then
      raise exception 'Insufficient material %', v_catalyst;
    end if;
  end if;
  if v_escrow_cores > 0 and coalesce(p.legendary_cores, 0) < v_escrow_cores then
    raise exception 'Insufficient legendary cores';
  end if;
  v_ticket_count := coalesce((p.consumables ->> 'WorkshopRushTicket')::integer, 0);
  if coalesce(p_use_rush_ticket, false) and v_ticket_count < 1 then
    raise exception 'No Workshop Rush Ticket available';
  end if;

  -- Equipped-relic snapshot (slice 9): the crafting effects of
  -- the relic the hunter carries, read from its affixes and
  -- composed under the relic ceilings — quality multipliers
  -- compose multiplicatively, clamped at x1.10 total; min-quality
  -- bonuses add, clamped at +5 total; durations compose; refine
  -- yield and bonus-unit chance add (chance clamped at 1). The TS
  -- twin is composeCraftRelicEffects (content/crafting.ts) — keep
  -- the clamps equal. The snapshot freezes the effects onto the
  -- job: swapping the relic mid-job never reprices a running job.
  select id, payload into v_relic_id, v_relic_payload
    from public.item_instances
   where owner_user_id = actor and runtime_state = 'equipped' and kind = 'relic'
   limit 1;
  if v_relic_payload is not null then
    for v_aff in
      select value from jsonb_array_elements(coalesce(v_relic_payload -> 'affixes', '[]'::jsonb))
    loop
      case v_aff ->> 'stat'
        when 'craftQualityMultiplier' then
          v_tool_quality := v_tool_quality * (v_aff ->> 'value')::numeric;
        when 'craftMinQualityBonus' then
          v_relic_min_bonus := v_relic_min_bonus + (v_aff ->> 'value')::numeric;
        when 'craftDurationMultiplier' then
          v_tool_duration := v_tool_duration * (v_aff ->> 'value')::numeric;
        when 'craftRefineYieldBonus' then
          v_tool_yield := v_tool_yield + (v_aff ->> 'value')::numeric;
        when 'craftBonusUnitChance' then
          v_tool_bonus := v_tool_bonus + (v_aff ->> 'value')::numeric;
        else null;
      end case;
    end loop;
    v_tool_quality := least(v_tool_quality, 1.10);
    v_relic_min_bonus := least(v_relic_min_bonus, 5);
    v_tool_bonus := least(v_tool_bonus, 1);
  end if;

  -- Rush ticket: escrowed at enqueue, burned at job start (FIFO,
  -- lowest quality first — the shipped burn order); its quality
  -- prices the reduction through the def's own scaling (0.2 base,
  -- capped at 0.45 — getConsumableRuntimeEffects' FULL_CHANCE mode).
  if coalesce(p_use_rush_ticket, false) then
    if not exists (select 1 from public.consumable_batches
                    where owner_user_id = actor
                      and consumable_type = 'WorkshopRushTicket' and quantity > 0) then
      perform public.cc_add_consumable_batch(actor, 'WorkshopRushTicket',
        v_ticket_count, 100, 'vendor', null, null, 'admin_adjust',
        'Backfilled legacy count into 100% batch before consumption', '{}'::jsonb);
    end if;
    select origin into v_rush_origin from public.consumable_batches
     where owner_user_id = actor and consumable_type = 'WorkshopRushTicket'
       and quantity > 0
     order by quality_percent asc, created_at asc
     limit 1;
    v_consumed := public.cc_consume_consumable_batch(actor, 'WorkshopRushTicket', 1,
      'crafting', 'Workshop Rush Ticket', '{}'::jsonb);
    v_rush_quality := (v_consumed -> 'consumed' -> 0 ->> 'quality_percent')::numeric;
    -- The Fixer keystone raises the reduction cap (rush_cap_bonus).
    v_rush_reduction := least(0.45 + v_rush_cap_bonus, 0.2 * coalesce(v_rush_quality, 100) / 100);
    update public.profiles
       set consumables = public.cc_jsonb_add_int(consumables, 'WorkshopRushTicket', -1),
           updated_at = now()
     where id = actor;
  end if;

  -- Take the escrow.
  for v_key, v_per_unit in select key, value::numeric from jsonb_each_text(v_escrow)
  loop
    if public.cc_is_material_key(v_key) then
      update public.profiles
         set materials = public.cc_jsonb_add_int(materials, v_key, -v_per_unit::integer),
             updated_at = now()
       where id = actor;
    else
      update public.profiles
         set essences = public.cc_jsonb_add_int(essences, v_key, -v_per_unit::integer),
             updated_at = now()
       where id = actor;
    end if;
  end loop;
  if v_catalyst is not null then
    update public.profiles
       set materials = public.cc_jsonb_add_int(materials, v_catalyst, -v_units),
           updated_at = now()
     where id = actor;
  end if;
  if v_escrow_cores > 0 then
    update public.profiles
       set legendary_cores = legendary_cores - v_escrow_cores,
           updated_at = now()
     where id = actor;
  end if;

  -- Snapshotted unit duration: base x skill x tool x scalar x rush.
  -- The Fixer craft-speed term composes MULTIPLICATIVELY after the
  -- Scavenger term, under a combined 0.60x floor (0029).
  v_skill_mult := 1 - least(0.20, 0.02 * round(greatest(0, coalesce(p_efficiency_bonus, 0)) * 10));
  v_skill_mult := greatest(0.60, v_skill_mult * (1 - least(0.25, greatest(0, v_craft_speed_bonus))));
  if v_kind = 'gear' and recipe ->> 'namedRelic' is null then
    v_base_duration := (recipe -> 'durationByRarityMs' ->> v_rarity)::bigint;
  else
    v_base_duration := (recipe ->> 'unitDurationMs')::bigint;
  end if;
  v_duration := greatest(1, round(
    v_base_duration * v_skill_mult * v_tool_duration * v_scalar * (1 - v_rush_reduction)
  ))::bigint;

  insert into public.craft_jobs(
    owner_user_id, bench, kind, recipe_id, units_total, unit_duration_ms,
    escrow_inputs, escrow_catalyst, escrow_cores, rush_ticket_quality, rush_ticket_origin,
    snapshot)
  values (
    actor, v_bench, v_kind, p_recipe_id, v_units, v_duration,
    v_escrow, v_escrow_catalyst, v_escrow_cores, v_rush_quality, v_rush_origin,
    jsonb_build_object(
      'toolId', v_relic_id,
      'relicMinQualityBonus', v_relic_min_bonus,
      'namedRelic', recipe ->> 'namedRelic',
      'toolQualityMultiplier', v_tool_quality,
      'toolDurationMultiplier', v_tool_duration,
      'toolRefineYieldBonus', v_tool_yield,
      'toolBonusUnitChance', v_tool_bonus,
      'skillDurationMultiplier', v_skill_mult,
      'rushReduction', v_rush_reduction,
      'craftTimeScalar', v_scalar,
      'catalystMaterialId', v_catalyst,
      'coreCatalyst', v_core_catalyst,
      'coreCatalystDrawBonus', v_core_draw_bonus,
      'skillQualityBonus', v_skill_quality_bonus,
      'skillTemperBonus', v_skill_temper_bonus,
      'gearRarity', case when v_kind = 'gear' then v_rarity else null end
    ))
  returning * into v_job;

  select * into p from public.profiles where id = actor;
  result := jsonb_build_object(
    'action_type', 'cc_enqueue_craft_job',
    'profile', public.cc_profile_snapshot(p),
    'job', public.cc_craft_job_json(v_job),
    'escrow_cores', v_escrow_cores
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_enqueue_craft_job', nonce, result);
  return result;
end;
$$;


-- ─── cc_complete_craft_unit (chain head 0099 + the 0102 snapshot-first read) ───

create or replace function public.cc_complete_craft_unit(
  p_job_id uuid,
  p_xp_rate numeric,
  p_quality_shift numeric,
  p_temper_base numeric,
  p_refine_base numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid;
  job public.craft_jobs%rowtype;
  p public.profiles%rowtype;
  recipe jsonb;
  v_xp bigint;
  v_output jsonb;
  v_next jsonb;
  v_mastery_track text;
  v_mastery_xp integer;
  -- consumable completion
  v_type text;
  v_ml integer;
  v_hi numeric;
  v_bool boolean;
  v_bounds jsonb;
  v_roll numeric;
  v_qty integer;
  v_bonus boolean;
  -- refine completion
  v_yield numeric;
  v_expect numeric;
  v_count integer;
  -- gear completion
  v_tempered boolean;
  -- repair completion (0025)
  v_item public.item_instances%rowtype;
  -- Fixer completion terms (0029)
  v_mod_payload jsonb;
  v_craft_quality_bonus numeric := 0;
  v_research_shift numeric := 0;
  v_research_temper numeric := 0;
  v_research_draws integer := 0;
  v_craft_temper_bonus numeric := 0;
  v_shift numeric;
  v_kit_base numeric;
  v_quality numeric;
  v_before numeric;
  v_restore numeric;
  v_restored numeric;
begin
  select * into job from public.craft_jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found'; end if;
  actor := job.owner_user_id;
  select * into p from public.profiles where id = actor for update;
  -- Research (0038): the owner's completion-derived terms, read once
  -- from research_completions (server records only).
  v_research_shift := public.cc_research_bonus_number(p.id, 'craftQualityShift');
  v_research_temper := public.cc_research_bonus_number(p.id, 'gearTemperBonus');
  v_research_draws := public.cc_research_bonus_number(p.id, 'gearDrawBonus')::integer;
  if not found then raise exception 'Profile not found'; end if;
  if job.kind = 'repair' then
    -- Self-repair unit (0025): apply the next escrowed patch kit.
    -- Restoration = kit base x kit quality% x the owner's repair
    -- efficiency snapshot, clamped at the vehicle's max; the kit is
    -- spent even when the clamp wastes part of it. No player XP
    -- (consumption); repair mastery trains by points restored.
    v_output := jsonb_build_object(
      'unit', job.units_completed + 1,
      'kind', 'repair',
      'xp', 0,
      'completedAtMs', (extract(epoch from now()) * 1000)::bigint
    );
    select * into v_item from public.item_instances
     where id = (job.snapshot -> 'repair' ->> 'itemId')::uuid
       and owner_user_id = actor;
    if not found or v_item.kind <> 'vehicle'
       or v_item.runtime_state in ('listed', 'consumed', 'salvaged', 'in_service')
       or coalesce(v_item.condition_current, v_item.condition_max, 100)
          >= coalesce(v_item.condition_max, 100) then
      -- The unit never starts: the settler ends the job here and
      -- refunds this and every later kit at its recorded quality.
      return v_output || jsonb_build_object('vehicleFull', true);
    end if;
    v_kit_base := case job.snapshot -> 'repair' ->> 'kitType'
      when 'PatchKit' then 30 when 'FieldPatchKit' then 45
      when 'MasterPatchKit' then 80 else 0 end;
    v_quality := coalesce(
      (job.snapshot -> 'repair' -> 'kitQualities' ->> job.units_completed)::numeric, 100);
    v_before := coalesce(v_item.condition_current, v_item.condition_max, 100);
    v_restore := round(v_kit_base * v_quality / 100
      * coalesce((job.snapshot -> 'repair' ->> 'efficiency')::numeric, 1), 2);
    update public.item_instances
       set condition_current = least(coalesce(condition_max, 100), v_before + v_restore),
           updated_at = now()
     where id = v_item.id
     returning condition_current into v_item.condition_current;
    v_restored := round(v_item.condition_current - v_before, 2);
    if v_restored > 0 then
      perform public.cc_add_stat(actor, 'services.points_restored', round(v_restored)::bigint);
      perform public.cc_add_mastery_xp(actor, 'services.repair', ceil(v_restored)::integer);
    end if;
    v_output := v_output || jsonb_build_object(
      'itemId', v_item.id,
      'quality', v_quality,
      'pointsRestored', v_restored,
      'conditionCurrent', v_item.condition_current
    );
    v_output := public.cc_jsonb_strip_nulls(v_output);
    update public.craft_jobs
       set units_completed = units_completed + 1,
           outputs = outputs || jsonb_build_array(v_output)
     where id = job.id;
    -- 0030: Overclock charge accrual — self-repair points restored
    -- charge a Fixer-selected owner's pool (per-point lever rate).
    if v_restored > 0 and coalesce(p.action_skill_selection, '') = 'Fixer' then
      select payload into v_mod_payload from public.item_instances
       where owner_user_id = actor and runtime_state = 'equipped' and payload ? 'treeBonus'
       limit 1;
      if public.cc_action_skill_qualified(p.skill_spends, v_mod_payload, 'Fixer') then
        update public.profiles
           set action_skill_charge = least(100, action_skill_charge
             + least(2, greatest(0, public.cc_economy_config_number('actionSkillChargePerRepairPoint', 0.2))) * v_restored)
         where id = actor;
      end if;
    end if;
    return v_output;
  end if;

  if job.kind = 'shieldtech' then
    -- Self-lane recalibration unit (0044): apply the next escrowed
    -- Calibration Core. Its capacity (base 2,500 x quality% x the
    -- owner's efficiency snapshot) accrues toward the target; the
    -- flip lands only when the accumulated points cover the target,
    -- and only if the shield is still exactly the shield that was
    -- enqueued (identity diff outside behavior/hp/rechargeRate —
    -- the finalize rule). No player XP (consumption, the self-repair
    -- rule); shield-tech mastery trains by points applied.
    v_output := jsonb_build_object(
      'unit', job.units_completed + 1,
      'kind', 'shieldtech',
      'xp', 0,
      'completedAtMs', (extract(epoch from now()) * 1000)::bigint
    );
    select * into v_item from public.item_instances
     where id = (job.snapshot -> 'shieldtech' ->> 'itemId')::uuid
       and owner_user_id = actor;
    if not found or v_item.kind <> 'shield'
       or v_item.runtime_state <> 'available' or v_item.is_locked
       or public.cc_shieldtech_behavior_of(v_item.payload)
          is distinct from (job.snapshot -> 'shieldtech' ->> 'fromBehavior') then
      -- The unit never starts: the settler ends the job here and
      -- refunds this and every later core at its recorded quality.
      return v_output || jsonb_build_object('shieldUnavailable', true);
    end if;
    v_quality := coalesce(
      (job.snapshot -> 'shieldtech' -> 'coreQualities' ->> job.units_completed)::numeric, 100);
    v_restore := round(2500 * v_quality / 100
      * coalesce((job.snapshot -> 'shieldtech' ->> 'efficiency')::numeric, 1), 2);
    v_restored := round(coalesce(
      (job.snapshot -> 'shieldtech' ->> 'pointsApplied')::numeric, 0) + v_restore, 4);
    update public.craft_jobs
       set snapshot = jsonb_set(snapshot, '{shieldtech,pointsApplied}',
             to_jsonb(v_restored), true)
     where id = job.id
     returning * into job;
    if v_restore > 0 then
      perform public.cc_add_mastery_xp(actor, 'services.shield_tech',
        ceil(v_restore / 10)::integer);
    end if;
    v_output := v_output || jsonb_build_object(
      'itemId', v_item.id,
      'quality', v_quality,
      'pointsApplied', v_restore,
      'totalPointsApplied', v_restored
    );
    if v_restored >= (job.snapshot -> 'shieldtech' ->> 'targetPoints')::numeric then
      if (v_item.payload - 'behavior' - 'hp' - 'rechargeRate')
         is distinct from ((job.snapshot -> 'shieldtech' -> 'payload')
           - 'behavior' - 'hp' - 'rechargeRate') then
        -- The shield changed under the job (e.g. a reforge landed
        -- first): the flip refuses; the settler ends the job and
        -- refunds the unstarted cores. This core is spent — the
        -- work happened.
        v_output := v_output || jsonb_build_object('shieldDrift', true);
      else
        update public.item_instances
           set payload = public.cc_shieldtech_rebased_payload(v_item.payload,
                 job.snapshot -> 'shieldtech' ->> 'fromBehavior',
                 job.snapshot -> 'shieldtech' ->> 'toBehavior'),
               updated_at = now()
         where id = v_item.id;
        v_output := v_output || jsonb_build_object(
          'flipped', true,
          'fromBehavior', job.snapshot -> 'shieldtech' ->> 'fromBehavior',
          'toBehavior', job.snapshot -> 'shieldtech' ->> 'toBehavior',
          'shieldtechComplete', true);
      end if;
    end if;
    v_output := public.cc_jsonb_strip_nulls(v_output);
    update public.craft_jobs
       set units_completed = units_completed + 1,
           outputs = outputs || jsonb_build_array(v_output)
     where id = job.id;
    return v_output;
  end if;

  -- Fixer completion terms (0029; SNAPSHOT LAW since 0102): the
  -- quality/temper terms were computed hunter-gated at enqueue and
  -- snapshotted onto the job — completion consumes the snapshot, so
  -- a hunter swap mid-job never re-prices a job's terms (gating
  -- applies at the action instant; the same law unit_duration_ms
  -- follows). Jobs enqueued before 0102 carry no snapshot keys and
  -- fall back to the live derivation below, now gated to the
  -- fielded hunter's tree with Doc Sutter's base perk — no ungated
  -- read survives on either path. The quality shift composes lever
  -- + skill under ONE clamp [-10, +20] (the Research shift joins
  -- the same sum); the temper term adds Master Artificer's flat
  -- bonus under the 0.30 cap.
  select payload into v_mod_payload from public.item_instances
   where owner_user_id = actor and runtime_state = 'equipped' and payload ? 'treeBonus'
   limit 1;
  if job.snapshot ? 'skillQualityBonus' then
    v_craft_quality_bonus := coalesce((job.snapshot ->> 'skillQualityBonus')::numeric, 0);
  else
    v_craft_quality_bonus := 1.0 * (
      public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_quality_1', 'Fixer', 5)
      + public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_quality_2', 'Fixer', 5));
    if public.cc_profile_active_tree(p) <> 'Fixer' then
      v_craft_quality_bonus := 0;
    elsif public.cc_profile_active_hunter(p) = 'doc' then
      v_craft_quality_bonus := v_craft_quality_bonus + 1;
    end if;
  end if;
  if job.snapshot ? 'skillTemperBonus' then
    v_craft_temper_bonus := coalesce((job.snapshot ->> 'skillTemperBonus')::numeric, 0);
  else
    v_craft_temper_bonus := 0.05 *
      public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_major_1', 'Fixer', 1);
    if public.cc_profile_active_tree(p) <> 'Fixer' then
      v_craft_temper_bonus := 0;
    end if;
  end if;
  v_shift := least(20, greatest(-10, p_quality_shift + v_craft_quality_bonus + v_research_shift));

  recipe := public.cc_craft_recipe(job.recipe_id);
  if recipe is null then raise exception 'Unknown craft recipe'; end if;

  v_xp := public.cc_craft_unit_xp(job.unit_duration_ms, p.player_level, p_xp_rate);
  -- Cache Rank Fast Learner (0031): craft XP carries the same XP
  -- bonus as every other source (applied after the peg rate,
  -- before cc_apply_xp — the shipped composition order).
  v_xp := round(v_xp * (1 + public.cc_cache_rank_bonus_fraction(p.cache_rank_spends, 'xp')))::bigint;
  v_output := jsonb_build_object(
    'unit', job.units_completed + 1,
    'kind', job.kind,
    'xp', v_xp,
    -- The settle instant is the production instant for metrics: the
    -- outputs (and their XP/materials) observably land at settlement.
    'completedAtMs', (extract(epoch from now()) * 1000)::bigint
  );

  if job.kind = 'consumable' then
    v_type := recipe ->> 'consumableType';
    v_ml := public.cc_player_mastery_level(actor, 'crafting_consumables');
    v_bounds := public.cc_craft_quality_bounds(
      v_type, v_ml, job.bench,
      (job.snapshot ->> 'catalystMaterialId') is not null,
      v_shift
    );
    -- The equipped relic's min-quality bonus (slice 9 — the old
    -- Lab +5, now the Prime Laboratory's snapshotted effect):
    -- raises the floor only, never past the max (the TS bounds
    -- function's composition).
    v_bounds := jsonb_set(v_bounds, '{min}', to_jsonb(least(
      (v_bounds ->> 'max')::numeric,
      (v_bounds ->> 'min')::numeric
        + coalesce((job.snapshot ->> 'relicMinQualityBonus')::numeric, 0))));
    v_roll := round((
      ((v_bounds ->> 'min')::numeric
        + random() * greatest(0, (v_bounds ->> 'max')::numeric - (v_bounds ->> 'min')::numeric))
      * coalesce((job.snapshot ->> 'toolQualityMultiplier')::numeric, 1)
    )::numeric, 2);
    v_roll := least((v_bounds ->> 'cap')::numeric, greatest(1, v_roll));
    v_qty := coalesce((recipe ->> 'outputQuantity')::integer, 1);
    v_bonus := false;
    if coalesce((job.snapshot ->> 'toolBonusUnitChance')::numeric, 0) > 0
       and random() < (job.snapshot ->> 'toolBonusUnitChance')::numeric then
      v_qty := v_qty + 1;
      v_bonus := true;
    end if;
    perform public.cc_add_consumable_batch(
      actor, v_type, v_qty, v_roll, 'crafted', actor, job.recipe_id,
      'crafted', 'Crafted at the Workshop', '{}'::jsonb);
    update public.profiles
       set consumables = public.cc_jsonb_add_int(consumables, v_type, v_qty),
           updated_at = now()
     where id = actor;
    perform public.cc_add_stat(actor, 'consumables_crafted', v_qty);
    v_output := v_output || jsonb_build_object(
      'consumableType', v_type,
      'quality', v_roll,
      'quantity', v_qty,
      'bonusUnit', v_bonus
    );
  elsif job.kind = 'refine' then
    v_ml := public.cc_player_mastery_level(actor, 'crafting.refining');
    v_yield := least(1, p_refine_base + 0.004 * v_ml
      + coalesce((job.snapshot ->> 'toolRefineYieldBonus')::numeric, 0));
    if coalesce((recipe ->> 'outputBase')::numeric, 0) <= 0 or p_refine_base <= 0 then
      v_count := coalesce((recipe ->> 'outputBase')::integer, 0);
    else
      -- Stochastic rounding (economy brief §9.3, 0067): floor(x)
      -- plus one extra unit with probability frac(x), keeping the
      -- expectation of the old floor formula while making mastery
      -- and the Reclaimer Head real on the outputBase-2 furnace
      -- recipes. random() is drawn only when frac(x) > 0, mirroring
      -- the TS twin (rollRefineOutputCount).
      v_expect := (recipe ->> 'outputBase')::numeric * v_yield / p_refine_base;
      v_count := floor(v_expect)::integer;
      if v_expect - floor(v_expect) > 0
         and random() < v_expect - floor(v_expect) then
        v_count := v_count + 1;
      end if;
    end if;
    update public.profiles
       set materials = public.cc_jsonb_add_int(materials, recipe ->> 'outputMaterial', v_count),
           updated_at = now()
     where id = actor;
    v_output := v_output || jsonb_build_object(
      'outputMaterial', recipe ->> 'outputMaterial',
      'outputQuantity', v_count
    );
  elsif job.kind = 'gear' then
    v_ml := public.cc_player_mastery_level(actor, 'crafting.gear');
    -- Named relics (slice 9) mint fixed: no temper roll —
    -- v_tempered stays false and draws stay 1 below.
    v_tempered := coalesce(recipe ->> 'namedRelic', '') = ''
      and random() < least(0.3, greatest(0, p_temper_base) + 0.01 * v_ml + v_craft_temper_bonus + v_research_temper);
    v_output := v_output || jsonb_build_object(
      'pending', true,
      'slot', recipe ->> 'gearSlot',
      'rarity', job.snapshot ->> 'gearRarity',
      'item_level', p.player_level,
      'draws', case when recipe ->> 'namedRelic' is not null then 1
        else (case when v_tempered then 3 else 1 end)
          + case when job.snapshot ->> 'coreCatalyst' = 'true'
              then 2 + coalesce((job.snapshot ->> 'coreCatalystDrawBonus')::integer, 0)
              else 0 end
          + v_research_draws end,
      'tempered', v_tempered,
      'namedRelic', recipe ->> 'namedRelic'
    );
    -- Material catalyst (economy brief §9.1, 0067): a gear unit that
    -- escrowed a material catalyst carries its bounds -- computed by
    -- the shared bounds function with the catalyst flag set (+10 min
    -- / +15 max over the frame bounds, the consumable branch's own
    -- shift) -- on the pending output. Generation stays TS-side
    -- (cc_pending_crafted_gear -> the finalizer): each candidate draw
    -- rolls inside these bounds and the best bounds roll is kept.
    if (job.snapshot ->> 'catalystMaterialId') is not null
       or recipe ->> 'namedRelic' is not null then
      v_bounds := public.cc_craft_quality_bounds(null, v_ml, job.bench,
        (job.snapshot ->> 'catalystMaterialId') is not null, v_shift);
      v_bounds := jsonb_set(v_bounds, '{min}', to_jsonb(least(
        (v_bounds ->> 'max')::numeric,
        (v_bounds ->> 'min')::numeric
          + coalesce((job.snapshot ->> 'relicMinQualityBonus')::numeric, 0))));
      v_output := v_output || jsonb_build_object('qualityBounds', v_bounds);
    end if;
  elsif job.kind = 'cosmetic' then
    if coalesce((recipe ->> 'tintCraft')::boolean, false) then
      -- Tint job (0053): the craft lands on the TARGET part item,
      -- re-read at completion. If the part left the workshop state
      -- (sold underneath would have been refused at listing; this
      -- covers salvage/transfer races), the tint simply does not
      -- apply and the output records it.
      v_ml := public.cc_player_mastery_level(actor, 'crafting.cosmetics');
      select * into v_item from public.item_instances
       where id = (job.snapshot -> 'tint' ->> 'itemId')::uuid
         and owner_user_id = actor for update;
      v_bool := found and v_item.kind = 'cosmetic'
        and v_item.runtime_state in ('available', 'locked');
      if v_bool then
        update public.item_instances
           set payload = jsonb_set(payload, '{tintPaletteId}',
                 to_jsonb(job.snapshot -> 'tint' ->> 'paletteId'), true),
               updated_at = now()
         where id = v_item.id;
      end if;
      v_output := v_output || jsonb_build_object(
        'cosmeticPartId', v_item.payload ->> 'partId',
        'itemId', job.snapshot -> 'tint' ->> 'itemId',
        'paletteId', job.snapshot -> 'tint' ->> 'paletteId',
        'tintApplied', v_bool
      );
    elsif recipe ? 'cosmeticSkinId' then
      -- Whole-skin craft (reshape slice (d), 0099): the same
      -- finish roll as a part craft — the quality is a
      -- collection finish, never a stat — and the output pends
      -- for the skin finalizer (cc_pending_crafted_skins).
      v_ml := public.cc_player_mastery_level(actor, 'crafting.cosmetics');
      v_hi := 95 + least(15, 0.3 * v_ml);
      v_roll := round((
        (35 + random() * greatest(0, v_hi - 35))
        * coalesce((job.snapshot ->> 'toolQualityMultiplier')::numeric, 1)
      )::numeric) + v_shift;
      v_roll := least(100, greatest(1, v_roll))::integer;
      v_output := v_output || jsonb_build_object(
        'pending', true,
        'cosmeticSkinId', recipe ->> 'cosmeticSkinId',
        'quality', v_roll
      );
    else
      -- Skin part craft (0053): the finish roll (content/skins.ts
      -- COSMETIC_QUALITY — the twin formula) prices the part's
      -- permanent quality; the output pends for the finalizer.
      v_ml := public.cc_player_mastery_level(actor, 'crafting.cosmetics');
      v_hi := 95 + least(15, 0.3 * v_ml);
      v_roll := round((
        (35 + random() * greatest(0, v_hi - 35))
        * coalesce((job.snapshot ->> 'toolQualityMultiplier')::numeric, 1)
      )::numeric) + v_shift;
      v_roll := least(100, greatest(1, v_roll))::integer;
      v_output := v_output || jsonb_build_object(
        'pending', true,
        'cosmeticPartId', recipe ->> 'cosmeticPartId',
        'quality', v_roll
      );
    end if;
  end if;

  -- Mastery + player XP land after the output is priced.
  if job.kind = 'refine' then
    v_mastery_track := 'crafting.refining'; v_mastery_xp := 10;
  elsif job.kind = 'cosmetic' then
    v_mastery_track := 'crafting.cosmetics'; v_mastery_xp := 15;
  elsif job.kind = 'gear' then
    v_mastery_track := 'crafting.gear'; v_mastery_xp := 25;
  else
    v_mastery_track := 'crafting_consumables'; v_mastery_xp := 10;
  end if;
  perform public.cc_add_mastery_xp(actor, v_mastery_track, v_mastery_xp);
  v_next := public.cc_apply_xp(p.player_level, p.player_xp, v_xp);
  update public.profiles
     set player_level = (v_next ->> 'player_level')::integer,
         player_xp = (v_next ->> 'player_xp')::bigint,
         updated_at = now()
   where id = actor;

  v_output := public.cc_jsonb_strip_nulls(v_output);
  update public.craft_jobs
     set units_completed = units_completed + 1,
         xp_awarded = xp_awarded + v_xp,
         outputs = outputs || jsonb_build_array(v_output)
   where id = job.id;
  -- 0030: Overclock charge accrual — a completed craft unit charges
  -- a Fixer-selected crafter's pool (per-unit lever rate).
  if coalesce(p.action_skill_selection, '') = 'Fixer'
     and public.cc_action_skill_qualified(p.skill_spends, v_mod_payload, 'Fixer') then
    update public.profiles
       set action_skill_charge = least(100, action_skill_charge
         + least(25, greatest(0, public.cc_economy_config_number('actionSkillChargePerCraftUnit', 3))))
     where id = actor;
  end if;
  return v_output;
end;$$;

-- ─── cc_enqueue_repair_job (chain head 0078 + the 0102 gate) ───

create or replace function public.cc_enqueue_repair_job(
  p_player_id uuid, nonce text, item_id uuid, p_kit_type text, p_units integer,
  p_use_rush_ticket boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  item public.item_instances%rowtype;
  v_job public.craft_jobs%rowtype;
  v_units integer := coalesce(p_units, 0);
  v_kit_base numeric;
  v_recipe text;
  v_count integer;
  v_burn jsonb;
  v_entry jsonb;
  v_batch record;
  v_i integer;
  v_qualities jsonb := '[]'::jsonb;
  v_origins jsonb := '[]'::jsonb;
  v_mastery integer;
  v_base numeric := least(200, greatest(1,
    public.cc_economy_config_number('repairWorkRateBase', 20)));
  v_speed numeric := least(0.1, greatest(0,
    public.cc_economy_config_number('repairMasterySpeedPerLevel', 0.02)));
  v_eff numeric := least(0.1, greatest(0,
    public.cc_economy_config_number('repairMasteryEfficiencyPerLevel', 0.02)));
  v_rate numeric;
  v_efficiency numeric;
  v_duration bigint;
  v_mod_payload jsonb;
  v_repair_speed_bonus numeric := 0;
  v_repair_efficiency_bonus numeric := 0;
  v_bonus_repair_jobs integer := 0;
  v_rush_quality numeric := null;
  v_rush_origin text := null;
  v_rush_reduction numeric := 0;
  v_rush_cap_bonus numeric := 0;
  v_ticket_count integer;
  v_consumed jsonb;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  perform public.cc_settle_craft_jobs(actor);
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  -- Fixer derivation (0029): the owner's OWN records.
  select payload into v_mod_payload from public.item_instances
   where owner_user_id = actor and runtime_state = 'equipped' and payload ? 'treeBonus'
   limit 1;
  v_repair_speed_bonus := 0.03 * (
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_repair_speed_1', 'Fixer', 5)
    + public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_repair_speed_2', 'Fixer', 5));
  v_repair_efficiency_bonus := 0.025 * (
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_repair_eff_1', 'Fixer', 5)
    + public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_repair_eff_2', 'Fixer', 5));
  v_bonus_repair_jobs :=
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_major_4', 'Fixer', 1)::integer;
  -- The Fixer keystone raises the rush reduction cap (0029 craft twin).
  v_rush_cap_bonus := 0.10 *
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_keystone', 'Fixer', 1);

  -- Skill-routing fix (0102): hunter gating at the action instant —
  -- the Fixer repair terms pay only while Doc Sutter is fielded.
  if public.cc_profile_active_tree(p) <> 'Fixer' then
    v_repair_speed_bonus := 0;
    v_repair_efficiency_bonus := 0;
    v_bonus_repair_jobs := 0;
    v_rush_cap_bonus := 0;
  end if;

  v_kit_base := case p_kit_type
    when 'PatchKit' then 30 when 'FieldPatchKit' then 45
    when 'MasterPatchKit' then 80 else null end;
  v_recipe := case p_kit_type
    when 'PatchKit' then 'repair_patch_kit'
    when 'FieldPatchKit' then 'repair_field_patch_kit'
    when 'MasterPatchKit' then 'repair_master_patch_kit' else null end;
  if v_kit_base is null then raise exception 'Unknown patch kit type'; end if;
  if v_units < 1 then raise exception 'units must be a positive integer'; end if;
  if v_units > 500 then raise exception 'units exceeds the per-job maximum of 500'; end if;

  select * into item from public.item_instances
   where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Vehicle not found'; end if;
  if item.kind <> 'vehicle' then raise exception 'Only vehicles can be repaired'; end if;
  if item.runtime_state in ('listed', 'consumed', 'salvaged', 'in_service') then
    raise exception 'Vehicle is not available for repair';
  end if;
  if coalesce(item.condition_current, item.condition_max, 100)
     >= coalesce(item.condition_max, 100) then
    raise exception 'Vehicle is already at full condition';
  end if;
  if exists (select 1 from public.craft_jobs
              where owner_user_id = actor and kind = 'repair' and status = 'active'
                and snapshot -> 'repair' ->> 'itemId' = item.id::text) then
    raise exception 'A repair job is already running for this vehicle';
  end if;
  select count(*) into v_count from public.craft_jobs
   where owner_user_id = actor and kind = 'repair' and status = 'active';
  -- Second Shift (fix_major_4): +1 concurrent self-repair job. This
  -- self-repair cap is the one repair-concurrency cap the shipped
  -- game enforces; board work is uncapped-but-sequential by design.
  if v_count >= 3 + v_bonus_repair_jobs then raise exception 'Too many repair jobs already running'; end if;
  if coalesce((p.consumables ->> p_kit_type)::integer, 0) < v_units then
    raise exception 'Not enough % in inventory', p_kit_type;
  end if;
  v_ticket_count := coalesce((p.consumables ->> 'WorkshopRushTicket')::integer, 0);
  if coalesce(p_use_rush_ticket, false) and v_ticket_count < 1 then
    raise exception 'No Workshop Rush Ticket available';
  end if;

  -- Escrow the kits: burn FIFO and record each unit's quality and
  -- origin, so completion prices the ACTUAL kit and refunds return
  -- the exact batches. Legacy counts backfill first (the
  -- cc_consume_consumable guard).
  if not exists (select 1 from public.consumable_batches
                  where owner_user_id = actor and consumable_type = p_kit_type
                    and quantity > 0) then
    perform public.cc_add_consumable_batch(actor, p_kit_type,
      (p.consumables ->> p_kit_type)::integer, 100, 'vendor', null, null,
      'admin_adjust', 'Backfilled legacy count into 100% batch before consumption',
      '{}'::jsonb);
  end if;
  v_burn := public.cc_consume_consumable_batch(
    actor, p_kit_type, v_units, 'workshop_service', 'repair_self', '{}'::jsonb);
  for v_entry in select * from jsonb_array_elements(v_burn -> 'consumed') loop
    select origin into v_batch from public.consumable_batches
     where id = (v_entry ->> 'batch_id')::uuid;
    for v_i in 1 .. (v_entry ->> 'quantity')::integer loop
      v_qualities := v_qualities || jsonb_build_array((v_entry ->> 'quality_percent')::numeric);
      v_origins := v_origins || jsonb_build_array(coalesce(v_batch.origin, 'vendor'));
    end loop;
  end loop;
  update public.profiles
     set consumables = public.cc_jsonb_add_int(consumables, p_kit_type, -v_units),
         updated_at = now()
   where id = actor returning * into p;

  -- Rush ticket (wiring package, 0078): the ticket def's repair
  -- scope, wired exactly as the craft enqueue wires its crafting
  -- scope (0029) — escrowed at enqueue, burned at job start (FIFO,
  -- lowest quality first, the shipped burn order); its quality
  -- prices the reduction through the def's own scaling (0.2 base,
  -- cap 0.45 + the Fixer keystone bonus).
  if coalesce(p_use_rush_ticket, false) then
    if not exists (select 1 from public.consumable_batches
                    where owner_user_id = actor
                      and consumable_type = 'WorkshopRushTicket' and quantity > 0) then
      perform public.cc_add_consumable_batch(actor, 'WorkshopRushTicket',
        v_ticket_count, 100, 'vendor', null, null, 'admin_adjust',
        'Backfilled legacy count into 100% batch before consumption', '{}'::jsonb);
    end if;
    select origin into v_rush_origin from public.consumable_batches
     where owner_user_id = actor and consumable_type = 'WorkshopRushTicket'
       and quantity > 0
     order by quality_percent asc, created_at asc
     limit 1;
    v_consumed := public.cc_consume_consumable_batch(actor, 'WorkshopRushTicket', 1,
      'workshop_service', 'repair_self', '{}'::jsonb);
    v_rush_quality := (v_consumed -> 'consumed' -> 0 ->> 'quality_percent')::numeric;
    v_rush_reduction := least(0.45 + v_rush_cap_bonus, 0.2 * coalesce(v_rush_quality, 100) / 100);
    update public.profiles
       set consumables = public.cc_jsonb_add_int(consumables, 'WorkshopRushTicket', -1),
           updated_at = now()
     where id = actor returning * into p;
  end if;

  v_mastery := public.cc_player_mastery_level(actor, 'services.repair');
  v_rate := v_base * least(2.0, 1 + v_speed * greatest(0, v_mastery - 1))
    * (1 + public.cc_research_bonus_number(actor, 'repairWorkRateBonus'));
  -- Fixer composition (0029): efficiency = min(1.80, mastery x
  -- (1 + repair_efficiency_bonus)); the snapshotted duration takes
  -- the repair_speed_bonus multiplier (1 - min(0.30, bonus)) and,
  -- now, the rush reduction — composed into the duration before the
  -- ceil, the SQL twin of the TS enqueue's rounding.
  v_efficiency := least(1.80, least(1.5, 1 + v_eff * greatest(0, v_mastery - 1))
    * (1 + greatest(0, v_repair_efficiency_bonus)));
  v_duration := greatest(1, ceil(v_kit_base
    * (1 - least(0.30, greatest(0, v_repair_speed_bonus))) / v_rate * 3600000
    * (1 - v_rush_reduction)))::bigint;

  insert into public.craft_jobs(
    owner_user_id, bench, kind, recipe_id, units_total, unit_duration_ms,
    escrow_inputs, escrow_catalyst, rush_ticket_quality, rush_ticket_origin,
    snapshot)
  values (actor, 0, 'repair', v_recipe, v_units, v_duration,
    '{}'::jsonb, '{}'::jsonb, v_rush_quality, v_rush_origin,
    jsonb_build_object(
      'toolId', null, 'toolQualityMultiplier', 1, 'toolDurationMultiplier', 1,
      'toolRefineYieldBonus', 0, 'toolBonusUnitChance', 0,
      'skillDurationMultiplier', 1, 'rushReduction', v_rush_reduction, 'craftTimeScalar', 1,
      'catalystMaterialId', null, 'gearRarity', null,
      'repair', jsonb_build_object(
        'itemId', item.id, 'kitType', p_kit_type, 'kitBase', v_kit_base,
        'kitQualities', v_qualities, 'kitOrigins', v_origins,
        'efficiency', v_efficiency, 'workRatePointsPerHour', v_rate,
        'masteryLevel', v_mastery)))
  returning * into v_job;

  result := jsonb_build_object('action_type', 'cc_enqueue_repair_job',
    'profile', public.cc_profile_snapshot(p),
    'job', public.cc_craft_job_json(v_job));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_enqueue_repair_job', nonce, result);
  return result;
end;
$$;


-- ─── cc_vendor_sell (chain head 0038 + the 0102 gate) ───

create or replace function public.cc_vendor_sell(
  p_player_id uuid,
  nonce text,
  p_kind text,
  p_item_id uuid default null,
  p_batch_id uuid default null,
  p_material_id text default null,
  p_quantity integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  result jsonb;
  rate numeric := least(0.9::numeric, greatest(0::numeric,
    public.cc_economy_config_number('vendorBuybackRate', 0.4)));
  qty integer := greatest(1, coalesce(p_quantity, 1));
  item public.item_instances%rowtype;
  batch public.consumable_batches%rowtype;
  v_pool text;
  base_price integer;
  vendor_value numeric := 0;
  payout bigint := 0;
  current_count integer;
  v_mod_payload jsonb;
  v_vendor_buyback_bonus numeric := 0;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  -- Appraiser's Eye (Fixer small, 0029): the seller's
  -- vendor_buyback_bonus adds onto the levered rate under the same
  -- 0.90 ceiling, derived from the seller's OWN records.
  select payload into v_mod_payload from public.item_instances
   where owner_user_id = actor and runtime_state = 'equipped' and payload ? 'treeBonus'
   limit 1;
  v_vendor_buyback_bonus := 0.01 *
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_vendor_1', 'Fixer', 5);
  -- Skill-routing fix (0102): hunter gating at the action instant —
  -- Appraiser's Eye pays only while Doc Sutter is fielded.
  if public.cc_profile_active_tree(p) <> 'Fixer' then
    v_vendor_buyback_bonus := 0;
  end if;
  -- Street Economics (0038): the seller's research buyback term
  -- joins under the same 0.90 ceiling, from their completions.
  rate := least(0.9::numeric, rate + greatest(0, v_vendor_buyback_bonus)
    + public.cc_research_bonus_number(actor, 'vendorBuybackBonus'));

  if p_kind = 'gear' then
    select * into item from public.item_instances where id = p_item_id and owner_user_id = actor for update;
    if not found then raise exception 'Item not found'; end if;
    if item.is_locked then raise exception 'Locked item'; end if;
    if item.runtime_state <> 'available' then raise exception 'Item state invalid'; end if;

    vendor_value := greatest(0, coalesce(item.estimated_value, 0));
    payout := floor(vendor_value * rate)::bigint;

    update public.item_instances
    set runtime_state = 'consumed', tradeable = false, equipped_slot = null
    where id = item.id
    returning * into item;

    update public.profiles set credits = credits + payout where id = actor returning * into p;

    result := jsonb_build_object(
      'action_type', 'cc_vendor_sell',
      'profile', public.cc_profile_snapshot(p),
      'kind', 'gear',
      'item', to_jsonb(item),
      'vendor_value', vendor_value,
      'buyback_rate', rate,
      'quantity', 1,
      'total_payout', payout,
      'loadout', public.cc_loadout_snapshot(actor)
    );
  elsif p_kind = 'consumable' then
    select * into batch from public.consumable_batches where id = p_batch_id and owner_user_id = actor for update;
    if not found then raise exception 'Batch not found'; end if;
    if batch.quantity < qty then raise exception 'Insufficient quantity'; end if;

    base_price := public.cc_vendor_base_price(batch.consumable_type);
    if base_price is null then raise exception 'Item has no vendor value'; end if;

    vendor_value := base_price * batch.quality_percent / 100 * qty;
    payout := floor(vendor_value * rate)::bigint;

    update public.consumable_batches
    set quantity = quantity - qty, updated_at = now()
    where id = batch.id;

    current_count := coalesce((coalesce(p.consumables, '{}'::jsonb) ->> batch.consumable_type)::integer, 0);
    update public.profiles
    set credits = credits + payout,
        consumables = jsonb_set(coalesce(consumables, '{}'::jsonb), array[batch.consumable_type],
          to_jsonb(greatest(current_count - qty, 0)), true)
    where id = actor
    returning * into p;

    result := jsonb_build_object(
      'action_type', 'cc_vendor_sell',
      'profile', public.cc_profile_snapshot(p),
      'kind', 'consumable',
      'item_key', batch.consumable_type,
      'batch_id', batch.id,
      'quality_percent', batch.quality_percent,
      'vendor_value', vendor_value,
      'buyback_rate', rate,
      'quantity', qty,
      'total_payout', payout
    );
  elsif p_kind = 'material' then
    select c.pool, c.base_price into v_pool, base_price
      from public.cc_vendor_catalog() c where c.item_key = p_material_id;
    if v_pool is null or v_pool not in ('material', 'essence') then
      raise exception 'Unknown material';
    end if;

    if v_pool = 'material' then
      current_count := coalesce((coalesce(p.materials, '{}'::jsonb) ->> p_material_id)::integer, 0);
    else
      current_count := coalesce((coalesce(p.essences, '{}'::jsonb) ->> p_material_id)::integer, 0);
    end if;
    if current_count < qty then raise exception 'Insufficient material %', p_material_id; end if;

    vendor_value := base_price * qty;
    payout := floor(vendor_value * rate)::bigint;

    update public.profiles
    set credits = credits + payout,
        materials = case when v_pool = 'material'
          then public.cc_jsonb_add_int(materials, p_material_id, -qty) else materials end,
        essences = case when v_pool = 'essence'
          then public.cc_jsonb_add_int(essences, p_material_id, -qty) else essences end
    where id = actor
    returning * into p;

    result := jsonb_build_object(
      'action_type', 'cc_vendor_sell',
      'profile', public.cc_profile_snapshot(p),
      'kind', 'material',
      'item_key', p_material_id,
      'vendor_value', vendor_value,
      'buyback_rate', rate,
      'quantity', qty,
      'total_payout', payout
    );
  else
    raise exception 'Unknown vendor sell kind';
  end if;

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_vendor_sell', nonce, result);

  return result;
end;
$function$;

-- ─── cc_accept_repair_job (chain head 0038 + the 0102 gate) ───

create or replace function public.cc_accept_repair_job(
  p_player_id uuid, nonce text, job_id uuid, p_kit_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  job public.service_jobs%rowtype;
  v_mastery integer;
  v_base numeric := least(200, greatest(1,
    public.cc_economy_config_number('repairWorkRateBase', 20)));
  v_speed numeric := least(0.1, greatest(0,
    public.cc_economy_config_number('repairMasterySpeedPerLevel', 0.02)));
  v_eff numeric := least(0.1, greatest(0,
    public.cc_economy_config_number('repairMasteryEfficiencyPerLevel', 0.02)));
  v_rate numeric;
  v_efficiency numeric;
  v_mod_payload jsonb;
  v_repair_speed_bonus numeric := 0;
  v_repair_efficiency_bonus numeric := 0;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into job from public.service_jobs where id = job_id for update;
  if not found or job.profession_id <> 'repair' then raise exception 'Repair job not found'; end if;
  if job.status = 'listed' and job.expires_at is not null and job.expires_at <= now() then
    perform public.cc_repair_finalize_job(job.id, 'expired');
    raise exception 'Listing has expired';
  end if;
  if job.status <> 'listed' then raise exception 'Service job not available'; end if;
  if job.owner_user_id = actor then raise exception 'Cannot accept own job'; end if;
  if p_kit_type not in ('PatchKit', 'FieldPatchKit', 'MasterPatchKit') then
    raise exception 'Unknown patch kit type';
  end if;
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  if coalesce((p.consumables ->> p_kit_type)::integer, 0) < 1 then
    raise exception 'No % available', p_kit_type;
  end if;

  -- Fixer derivation (0029): the MECHANIC's OWN records price the
  -- snapshot — the speed term raises the snapshotted work rate (the
  -- rate form of the duration multiplier; board work accrues points
  -- over time) and the efficiency term composes past the mastery cap.
  select payload into v_mod_payload from public.item_instances
   where owner_user_id = actor and runtime_state = 'equipped' and payload ? 'treeBonus'
   limit 1;
  v_repair_speed_bonus := 0.03 * (
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_repair_speed_1', 'Fixer', 5)
    + public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_repair_speed_2', 'Fixer', 5));
  v_repair_efficiency_bonus := 0.025 * (
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_repair_eff_1', 'Fixer', 5)
    + public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_repair_eff_2', 'Fixer', 5));

  -- Skill-routing fix (0102): hunter gating at the action instant —
  -- the mechanic's Fixer terms price the snapshot only while Doc
  -- Sutter is fielded.
  if public.cc_profile_active_tree(p) <> 'Fixer' then
    v_repair_speed_bonus := 0;
    v_repair_efficiency_bonus := 0;
  end if;

  v_mastery := public.cc_player_mastery_level(actor, 'services.repair');
  v_rate := v_base * least(2.0, 1 + v_speed * greatest(0, v_mastery - 1))
    / (1 - least(0.30, greatest(0, v_repair_speed_bonus)))
    * (1 + public.cc_research_bonus_number(actor, 'repairWorkRateBonus'));
  v_efficiency := least(1.80, least(1.5, 1 + v_eff * greatest(0, v_mastery - 1))
    * (1 + greatest(0, v_repair_efficiency_bonus)));
  update public.service_jobs
     set provider_user_id = actor, status = 'active', kit_type = p_kit_type,
         repair_snapshot = jsonb_build_object(
           'masteryLevel', v_mastery,
           'workRatePointsPerHour', v_rate,
           'efficiency', v_efficiency),
         accepted_at = now(), last_settled_at = now(), last_progress_at = now()
   where id = job.id returning * into job;
  update public.escrow_records set payee_user_id = actor
   where id = job.escrow_id;

  result := jsonb_build_object('action_type', 'cc_accept_repair_job',
    'profile', public.cc_profile_snapshot(p), 'job', to_jsonb(job));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_accept_repair_job', nonce, result);
  return result;
end;
$$;


-- ─── cc_make_item (chain head 0082 + the 0102 gate) ───

CREATE OR REPLACE FUNCTION public.cc_make_item(p_player_id uuid, nonce text, p_payment text DEFAULT 'key', p_ad_unit_id text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  item public.item_instances%rowtype;
  result jsonb;
  odds jsonb;
  v_open_day date := (now() at time zone 'utc')::date;
  v_resolved_payment text;
  v_clean_ad_unit_id text := nullif(trim(coalesce(p_ad_unit_id, '')), '');
  v_requested_payment text := lower(coalesce(nullif(trim(p_payment), ''), 'key'));
  cache_quality numeric := 0;
  skill_quality numeric := 0;
  rarity_value text;
  item_value bigint;
  item_level integer;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  -- Cache box lane (0037, rebuilt 0082): EVERY opening is paid —
  -- 1 cache key OR one rewarded-ad attestation, player's choice,
  -- uncapped. There is no daily budget, no free slot, no count:
  -- nothing about yesterday or earlier today can change how the
  -- next opening is paid (content owner: src/content/cacheLane.ts;
  -- resolveCacheBoxPayment is the TS statement of this logic). An
  -- ad opening is attested by this call itself (client-attested,
  -- no SSV — the ad unit id is the claim, recorded on the opening
  -- row); the abuse control is that every opening is paid, and the
  -- nonce ledger makes each opening exactly-once.
  if v_requested_payment = 'ad' then
    if v_clean_ad_unit_id is null then raise exception 'ad_unit_id is required'; end if;
    v_resolved_payment := 'ad';
  elsif v_requested_payment = 'key' then
    v_resolved_payment := 'key';
  else
    raise exception 'Unknown cache box payment';
  end if;
  if v_resolved_payment = 'key' and p.cache_tokens < 1 then
    raise exception 'Not enough tokens';
  end if;

  -- Cache quality (0031): the draw reads the TOTAL cache quality —
  -- the Scavenger node's cacheQuality effect (Encrypted Payloads,
  -- skill spends x node definitions; class-mod boosts do not feed
  -- the draw) PLUS the Cache Rank Cache Optimizer track. This is
  -- the first consumer of the cacheQuality effect (registry:
  -- src/lib/skills/skillConsumers.ts).
  select coalesce(sum((d.effects ->> 'cacheQuality')::numeric * s.points), 0)
    into skill_quality
    from (select key as node_id, (value)::numeric::integer as points
            from jsonb_each_text(coalesce(p.skill_spends, '{}'::jsonb))) s
    join public.skill_node_definitions d on d.id = s.node_id;
  -- Skill-routing fix (0102): hunter gating at the draw — the
  -- cacheQuality skill term is Josie Lode's and feeds the draw only
  -- while she is fielded. The Cache Rank Cache Optimizer term below
  -- is a separate system and stays ungated, as its TS twin does.
  if public.cc_profile_active_tree(p) <> 'Scavenger' then
    skill_quality := 0;
  end if;
  cache_quality := greatest(0::numeric, coalesce(skill_quality, 0))
    + public.cc_cache_rank_bonus_fraction(p.cache_rank_spends, 'cacheQuality');
  odds := public.cc_draw_odds('cache_primary_rarity', cache_quality);
  rarity_value := odds ->> 'outcome';

  if v_resolved_payment = 'key' then
    update public.profiles set cache_tokens = cache_tokens - 1 where id = actor returning * into p;
  end if;

  item_level := greatest(1, p.player_level);
  item_value := public.cc_compute_item_estimated_value(
    jsonb_build_object('odds', odds),
    'weapon',
    rarity_value,
    item_level
  );

  insert into public.item_instances (
    owner_user_id,
    kind,
    item_level,
    rarity,
    estimated_value,
    supply_mode,
    payload
  ) values (
    actor,
    'weapon',
    item_level,
    rarity_value,
    item_value,
    'verified_action',
    public.cc_generate_weapon_payload(item_level, rarity_value)
  ) returning * into item;

  -- Record the opening (0037): the lane's audit row, written
  -- inside this transaction and after the nonce-prior return at
  -- the top, so a replayed nonce records nothing and grants
  -- nothing. The day stamp is audit history only (0082) — nothing
  -- reads it back into a budget.
  insert into public.cache_box_openings (player_id, open_day, payment, ad_unit_id, item_id)
  values (actor, v_open_day, v_resolved_payment,
          case when v_resolved_payment = 'ad' then v_clean_ad_unit_id else null end,
          item.id);

  result := jsonb_build_object('action_type', 'cc_make_item', 'profile', public.cc_profile_snapshot(p), 'odds', odds, 'cache_quality', cache_quality, 'item', to_jsonb(item),
    'payment', v_resolved_payment,
    'cache_lane', jsonb_build_object(
      'keys', p.cache_tokens,
      'rule', 'Every cache box costs 1 cache key or one short ad — no daily limit. Keys are rare: roaming drops one now and then, and the login streak, contracts, and leaderboards pay them too.'));

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_make_item', nonce, result);

  return result;
end;
$function$;


-- ─── F6: Demolition consumableEfficiency copy ────────────────────
-- The five supply nodes promise what the shared quantized formula
-- (consumableEfficiencyDurationMultiplier; 0075's v_skill_mult)
-- delivers: unit time falls in 2% steps as points accumulate across
-- the family, reaching −20% only with all 25 points. The old
-- "−2% unit time per point" copy overpromised ~2.5x (one point
-- delivers 0%, one maxed node 4%). TS constants carry the same text
-- (src/constants/skillTrees.ts).
update public.skill_node_definitions
   set description = 'Workshop craft jobs run faster: unit time falls in 2% steps as you invest across the five supply nodes — up to −20% with all five maxed (server-side, snapshotted at enqueue).'
 where id in ('demo_cons_1', 'demo_cons_2', 'demo_cons_3', 'demo_cons_4', 'demo_cons_5');

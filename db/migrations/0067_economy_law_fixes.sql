-- 0067: Economy slice 4 -- production law-fixes (economy redesign
-- brief §9, four corrections against settled law). DRAFT -- the
-- parent applies this live before the slice's PR merges.
--
-- 1. GEAR MATERIAL CATALYST WIRED (brief §9.1). ForgeheartIngots
--    escrowed on a gear-frame job were destroyed unread by both
--    settlers: the consumable branch applied the catalyst bounds
--    shift (+CATALYST_MIN_BONUS 10 / +CATALYST_MAX_BONUS 15) and the
--    gear branch never did. cc_complete_craft_unit's gear branch now
--    stamps the unit's bounds -- from the shared, already
--    catalyst-aware cc_craft_quality_bounds with the catalyst flag
--    set -- onto the pending output as qualityBounds;
--    cc_pending_crafted_gear surfaces them (plus the job's bench and
--    snapshotted tool quality multiplier) to the TS finalizer, where
--    each candidate draw rolls inside the shifted bounds and the
--    draw selection keeps the best bounds roll (craftGear.ts,
--    mirroring craftEngine.ts's gear branch). cc_finalize_crafted_
--    gear gains a defaulted p_quality so the finalized output
--    records the winning roll and sheds the bounds blob.
--
-- 2. WORKSHOP TOOLS PERMANENT (brief §9.2). Tools are layer-2
--    permanent modifiers; the 25-charge expiry was rent on an owned
--    thing. cc_enqueue_craft_job no longer reads a fitted tool as
--    absent at 0 stored charges; cc_settle_craft_jobs and
--    cc_fire_overclock_workshop no longer burn a charge (or un-own /
--    unfit the tool) at a job's first unit -- they still mark the
--    job tool_charged for the record; cc_complete_craft_unit's tool
--    branch stamps ownership only. Stored charges values are inert
--    data after this migration; nothing drops them.
--
-- 3. FURNACE REFINE LEVER LIVE (brief §9.3). cc_complete_craft_
--    unit's refine branch used floor(outputBase x rate / base), so
--    the outputBase-2 furnace recipes could never pay more than 2 at
--    any reachable rate and mastery / the Reclaimer Head did
--    nothing on them. The branch now applies stochastic rounding --
--    floor(x) plus one extra unit with probability frac(x) --
--    keeping the formula's expected value. random() is drawn only
--    when frac(x) > 0, mirroring the TS twin
--    (rollRefineOutputCount in src/content/crafting.ts).
--
-- 4. (No SQL.) The batch-recipe comment correction is TS-only
--    (src/content/crafting.ts + research.ts in the same PR).
--
-- Restatements are verbatim from their latest bodies
-- (cc_enqueue_craft_job / cc_complete_craft_unit: 0053;
-- cc_settle_craft_jobs: 0044; cc_fire_overclock_workshop: 0030;
-- cc_pending_crafted_gear / cc_finalize_crafted_gear: 0024) with
-- only the deltas above. Parity is pinned by
-- src/test/econLawFixes.test.ts.


-- ── 1+2. cc_enqueue_craft_job (0053 body; fitted-tool rule) ──────

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
  v_rarity_bench integer := 1;
  v_catalyst text := null;
  v_escrow jsonb := '{}'::jsonb;
  v_escrow_catalyst jsonb := '{}'::jsonb;
  v_key text;
  v_per_unit numeric;
  v_available integer;
  v_tools jsonb;
  v_fitted text;
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

  -- Gear rarity: forced at enqueue, Epic-capped by law.
  if v_kind = 'gear' then
    if v_rarity is null or v_rarity not in ('Common', 'Uncommon', 'Rare', 'Epic') then
      if v_rarity = 'Legendary' then
        raise exception 'Legendary gear cannot be crafted';
      end if;
      raise exception 'A craftable rarity (Common–Epic) is required';
    end if;
    v_rarity_bench := case v_rarity when 'Epic' then 3 when 'Rare' then 2 else 1 end;
    if v_bench < v_rarity_bench then
      raise exception '% frames require bench %', v_rarity, v_rarity_bench;
    end if;
    if v_rarity = 'Epic'
       and public.cc_player_mastery_level(actor, 'crafting.gear') < 10 then
      raise exception 'Epic frames require crafting.gear mastery 10';
    end if;
  end if;

  -- Tools are unique workshop assets: no duplicates owned or queued.
  if v_kind = 'tool' then
    if coalesce(p.workshop_tools -> 'owned' ->> (recipe ->> 'toolId'), 'false') = 'true' then
      raise exception 'Tool already fitted in the workshop';
    end if;
    if exists (select 1 from public.craft_jobs
                where owner_user_id = actor and status = 'active'
                  and recipe_id = p_recipe_id) then
      raise exception 'A job for this tool is already queued';
    end if;
  end if;

  -- Queue capacity: one running + five queued per bench, plus the
  -- Fixer keystone's workshop_queue_bonus (0029).
  if (select count(*) from public.craft_jobs
       where owner_user_id = actor and status = 'active' and bench = v_bench) >= 6 + v_workshop_queue_bonus then
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
    if v_bench < 2 then raise exception 'Catalysts require the Forge (bench 2)'; end if;
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
    if v_bench < 2 then raise exception 'Catalysts require the Forge (bench 2)'; end if;
    v_escrow_cores := v_units;
  end if;

  -- Verify the full escrow before taking any of it (atomicity).
  for v_key, v_per_unit in
    select key, value::numeric from jsonb_each_text(recipe -> 'inputs')
  loop
    v_escrow := jsonb_set(v_escrow, array[v_key], to_jsonb((v_per_unit * v_units)::bigint));
    if v_key = 'Scrap' then
      -- 0053: the cosmetic recipes' lead input is the scrap COLUMN
      -- (the game's bulk currency), not a material/essence key.
      v_available := coalesce(p.scrap, 0);
      if v_available < v_per_unit * v_units then
        raise exception 'Insufficient scrap';
      end if;
    elsif public.cc_is_material_key(v_key) then
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

  -- Fitted tool snapshot for this bench.
  v_tools := coalesce(p.workshop_tools, '{}'::jsonb);
  v_fitted := v_tools -> 'fitted' ->> v_bench::text;
  -- Tools are permanent (economy brief §9.2, 0067): a fitted tool
  -- applies on every job. The pre-0067 rule that read a fitted tool
  -- as absent at 0 stored charges is gone; stored charges are inert.
  if v_fitted = 'tool_precision_calipers' then
    v_tool_quality := 1.08;
  elsif v_fitted = 'tool_servo_bench_rig' then
    v_tool_duration := 0.85;
  elsif v_fitted = 'tool_reclaimer_head' then
    v_tool_yield := 0.05;
    v_tool_bonus := 0.10;
  elsif v_fitted is not null then
    v_fitted := null;
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
    if v_key = 'Scrap' then
      update public.profiles
         set scrap = scrap - v_per_unit::integer,
             updated_at = now()
       where id = actor;
    elsif public.cc_is_material_key(v_key) then
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
  if v_kind = 'gear' then
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
      'toolId', v_fitted,
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

-- ── 1+2+3. cc_complete_craft_unit (0053 body) ───────────────────

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

  -- Fixer derivation (0029): the completing crafter's OWN records.
  -- The quality shift composes lever + skill under ONE clamp
  -- [-10, +20] (a future Research shift joins the same sum); the
  -- temper term adds Master Artificer's flat bonus under the 0.30 cap.
  select payload into v_mod_payload from public.item_instances
   where owner_user_id = actor and runtime_state = 'equipped' and payload ? 'treeBonus'
   limit 1;
  v_craft_quality_bonus := 1.0 * (
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_quality_1', 'Fixer', 5)
    + public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_quality_2', 'Fixer', 5));
  v_craft_temper_bonus := 0.05 *
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_major_1', 'Fixer', 1);
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
    v_roll := round((
      ((v_bounds ->> 'min')::numeric
        + random() * greatest(0, (v_bounds ->> 'max')::numeric - (v_bounds ->> 'min')::numeric))
      * case job.bench when 2 then 1.05 when 3 then 1.10 else 1.0 end
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
    v_tempered := random() < least(0.3, greatest(0, p_temper_base) + 0.01 * v_ml + v_craft_temper_bonus + v_research_temper);
    v_output := v_output || jsonb_build_object(
      'pending', true,
      'slot', recipe ->> 'gearSlot',
      'rarity', job.snapshot ->> 'gearRarity',
      'item_level', p.player_level,
      'draws', (case when v_tempered then 3 else 1 end)
        + case when job.snapshot ->> 'coreCatalyst' = 'true'
            then 2 + coalesce((job.snapshot ->> 'coreCatalystDrawBonus')::integer, 0)
            else 0 end
        + v_research_draws,
      'tempered', v_tempered
    );
    -- Material catalyst (economy brief §9.1, 0067): a gear unit that
    -- escrowed a material catalyst carries its bounds -- computed by
    -- the shared bounds function with the catalyst flag set (+10 min
    -- / +15 max over the frame bounds, the consumable branch's own
    -- shift) -- on the pending output. Generation stays TS-side
    -- (cc_pending_crafted_gear -> the finalizer): each candidate draw
    -- rolls inside these bounds and the best bounds roll is kept.
    if (job.snapshot ->> 'catalystMaterialId') is not null then
      v_output := v_output || jsonb_build_object(
        'qualityBounds',
        public.cc_craft_quality_bounds(null, v_ml, job.bench, true, v_shift)
      );
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
    else
      -- Skin part craft (0053): the finish roll (content/skins.ts
      -- COSMETIC_QUALITY — the twin formula) prices the part's
      -- permanent quality; the output pends for the finalizer.
      v_ml := public.cc_player_mastery_level(actor, 'crafting.cosmetics');
      v_hi := 95 + least(15, 0.3 * v_ml);
      v_roll := round((
        (35 + random() * greatest(0, v_hi - 35))
        * case job.bench when 2 then 1.05 when 3 then 1.10 else 1.0 end
        * coalesce((job.snapshot ->> 'toolQualityMultiplier')::numeric, 1)
      )::numeric) + v_shift;
      v_roll := least(100, greatest(1, v_roll))::integer;
      v_output := v_output || jsonb_build_object(
        'pending', true,
        'cosmeticPartId', recipe ->> 'cosmeticPartId',
        'quality', v_roll
      );
    end if;
  elsif job.kind = 'tool' then
    -- Tools are permanent (economy brief §9.2, 0067): completion
    -- grants ownership only -- no charge count is stamped.
    update public.profiles
       set workshop_tools = jsonb_set(
             coalesce(workshop_tools, '{}'::jsonb),
             array['owned', recipe ->> 'toolId'], 'true'::jsonb, true),
           updated_at = now()
     where id = actor;
    v_output := v_output || jsonb_build_object('toolId', recipe ->> 'toolId');
  end if;

  -- Mastery + player XP land after the output is priced.
  if job.kind = 'refine' then
    v_mastery_track := 'crafting.refining'; v_mastery_xp := 10;
  elsif job.kind = 'cosmetic' then
    v_mastery_track := 'crafting.cosmetics'; v_mastery_xp := 15;
  elsif job.kind in ('gear', 'tool') then
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

-- ── 2. cc_settle_craft_jobs (0044 body; charge burn removed) ────

create or replace function public.cc_settle_craft_jobs(
  p_player_id uuid,
  p_max_advance_ms bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_player_id;
  p public.profiles%rowtype;
  v_now timestamptz := now();
  v_now_ms bigint := (extract(epoch from v_now) * 1000)::bigint;
  v_action text;
  v_heartbeat_ms bigint;
  v_away_cap_ms bigint;
  v_xp_rate numeric := least(0.85, greatest(0.70,
    public.cc_economy_config_number('craftXpRate', 0.775)));
  v_shift numeric := least(10, greatest(-10,
    public.cc_economy_config_number('craftQualityShift', 0)));
  v_temper numeric := least(0.30, greatest(0,
    public.cc_economy_config_number('gearTemperBaseChance', 0.05)));
  v_yield_base numeric := least(1.0, greatest(0.5,
    public.cc_economy_config_number('refineBaseYield', 0.8)));
  v_ids uuid[] := '{}';
  v_benches integer[] := '{}';
  v_advances bigint[] := '{}';
  v_job record;
  v_start_ms bigint;
  v_raw bigint;
  v_attended bigint;
  v_advance bigint;
  v_bench integer;
  v_budget bigint;
  v_need bigint;
  v_output jsonb;
  v_total_xp bigint := 0;
  v_jobs_completed integer := 0;
  v_max_advance bigint := 0;
  v_completions jsonb := '[]'::jsonb;
  v_i integer;
  v_force_complete boolean := false;
  v_refund_from integer := 0;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  select * into p from public.profiles where id = actor for update;
  if not found then
    return jsonb_build_object('settled', false, 'reason', 'no_profile',
      'advanced_ms', 0, 'xp_awarded', 0, 'jobs_completed', 0,
      'completions', '[]'::jsonb);
  end if;

  select active_action, (extract(epoch from last_heartbeat_at) * 1000)::bigint
    into v_action, v_heartbeat_ms
    from public.active_actions where user_id = actor;

  -- Internal away cap: min(earned tier, limiter when set), [1h, 24h].
  v_away_cap_ms := (greatest(1, least(
      public.cc_earned_offline_cap_hours(p.player_level)
        + public.cc_research_offline_cap_bonus(p.id),
      coalesce(nullif(p.offline_cap_hours, 0)::numeric,
               public.cc_earned_offline_cap_hours(p.player_level)
        + public.cc_research_offline_cap_bonus(p.id))
    )) * 3600000)::bigint;

  -- Pass 1: rebase every active job and price its advance.
  for v_job in
    select * from public.craft_jobs
     where owner_user_id = actor and status = 'active'
     order by created_at asc, id asc
     for update
  loop
    v_start_ms := (extract(epoch from v_job.last_settled_at) * 1000)::bigint;
    v_raw := greatest(0, v_now_ms - v_start_ms);
    update public.craft_jobs set last_settled_at = v_now where id = v_job.id;
    if v_action is distinct from (case when v_job.kind in ('repair', 'shieldtech')
          then 'workshop_service' else 'crafting' end) or v_raw <= 0 then
      v_advance := 0;
    elsif p_max_advance_ms is not null then
      v_advance := least(v_raw, greatest(0, p_max_advance_ms));
    else
      v_attended := least(v_raw, greatest(0,
        coalesce(v_heartbeat_ms, v_start_ms) + 300000 - v_start_ms));
      v_advance := v_attended + least(v_raw - v_attended, v_away_cap_ms);
    end if;
    v_ids := v_ids || v_job.id;
    v_benches := v_benches || v_job.bench;
    v_advances := v_advances || v_advance;
    v_max_advance := greatest(v_max_advance, v_advance);
  end loop;

  if v_action is distinct from 'crafting' and v_action is distinct from 'workshop_service' then
    return jsonb_build_object('settled', true, 'advanced_ms', v_max_advance,
      'xp_awarded', 0, 'jobs_completed', 0, 'completions', '[]'::jsonb);
  end if;

  -- Pass 2: each bench's queue consumes its window in order; leftover
  -- flows to the next job on the bench.
  for v_bench in
    select distinct bench from public.craft_jobs
     where owner_user_id = actor and status = 'active'
     order by bench asc
  loop
    select coalesce(max(adv), 0) into v_budget
      from unnest(v_ids, v_benches, v_advances) as t(jid, b, adv)
     where b = v_bench;
    for v_job in
      select * from public.craft_jobs
       where owner_user_id = actor and status = 'active' and bench = v_bench
       order by created_at asc, id asc
       for update
    loop
      exit when v_budget <= 0;
      -- Tools are permanent (economy brief §9.2, 0067): the job is
      -- still marked tool_charged at its first unit for the record,
      -- but no charge is spent -- a fitted tool is never consumed,
      -- un-owned, or unfitted by use. Pre-0067 charges values stored
      -- in profiles.workshop_tools are inert.
      if not v_job.tool_charged and (v_job.snapshot ->> 'toolId') is not null then
        update public.craft_jobs set tool_charged = true where id = v_job.id;
      end if;
      v_force_complete := false;
      while v_budget > 0 and v_job.units_completed < v_job.units_total loop
        v_need := v_job.unit_duration_ms - v_job.accrued_ms;
        if v_budget < v_need then
          update public.craft_jobs
             set accrued_ms = accrued_ms + v_budget where id = v_job.id;
          v_budget := 0;
        else
          v_budget := v_budget - v_need;
          update public.craft_jobs set accrued_ms = 0 where id = v_job.id;
          v_output := public.cc_complete_craft_unit(
            v_job.id, v_xp_rate, v_shift, v_temper, v_yield_base);
          if coalesce((v_output ->> 'shieldUnavailable')::boolean, false) then
            -- Shield-tech self-lane (0044): the shield is gone, busy,
            -- or no longer carries the enqueued behavior — this unit
            -- never started. End the job and refund this and every
            -- later core at its escrowed quality/origin.
            for v_i in v_job.units_completed .. v_job.units_total - 1 loop
              perform public.cc_add_consumable_batch(actor,
                'CalibrationCore', 1,
                (v_job.snapshot -> 'shieldtech' -> 'coreQualities' ->> v_i)::numeric,
                coalesce(v_job.snapshot -> 'shieldtech' -> 'coreOrigins' ->> v_i, 'crafted'),
                actor, null, 'shieldtech_refund',
                'Calibration Core refunded (shield no longer recalibratable)',
                '{}'::jsonb);
            end loop;
            if v_job.units_total - v_job.units_completed > 0 then
              update public.profiles
                 set consumables = public.cc_jsonb_add_int(consumables,
                       'CalibrationCore',
                       v_job.units_total - v_job.units_completed),
                     updated_at = now()
               where id = actor;
            end if;
            v_force_complete := true;
            exit;
          end if;
          if coalesce((v_output ->> 'shieldtechComplete')::boolean, false)
             or coalesce((v_output ->> 'shieldDrift')::boolean, false) then
            -- The job's work is done (flip landed, or the flip was
            -- refused on drift): this unit's core is spent; refund
            -- only the unstarted cores and end the job. Completion
            -- accounting below still records the unit.
            v_refund_from := v_job.units_completed + 1;
            for v_i in v_refund_from .. v_job.units_total - 1 loop
              perform public.cc_add_consumable_batch(actor,
                'CalibrationCore', 1,
                (v_job.snapshot -> 'shieldtech' -> 'coreQualities' ->> v_i)::numeric,
                coalesce(v_job.snapshot -> 'shieldtech' -> 'coreOrigins' ->> v_i, 'crafted'),
                actor, null, 'shieldtech_refund',
                'Calibration Core refunded (recalibration job ended)',
                '{}'::jsonb);
            end loop;
            if v_job.units_total - v_refund_from > 0 then
              update public.profiles
                 set consumables = public.cc_jsonb_add_int(consumables,
                       'CalibrationCore',
                       v_job.units_total - v_refund_from),
                     updated_at = now()
               where id = actor;
            end if;
            v_force_complete := true;
          end if;
          if coalesce((v_output ->> 'vehicleFull')::boolean, false) then
            -- Repair job whose vehicle is already whole (or gone):
            -- end it and refund every unstarted kit at its escrowed
            -- quality/origin (0025).
            for v_i in v_job.units_completed .. v_job.units_total - 1 loop
              perform public.cc_add_consumable_batch(actor,
                v_job.snapshot -> 'repair' ->> 'kitType', 1,
                (v_job.snapshot -> 'repair' -> 'kitQualities' ->> v_i)::numeric,
                coalesce(v_job.snapshot -> 'repair' -> 'kitOrigins' ->> v_i, 'crafted'),
                actor, null, 'repair_refund',
                'Patch kit refunded (vehicle already at full condition)',
                '{}'::jsonb);
            end loop;
            if v_job.units_total - v_job.units_completed > 0 then
              update public.profiles
                 set consumables = public.cc_jsonb_add_int(consumables,
                       v_job.snapshot -> 'repair' ->> 'kitType',
                       v_job.units_total - v_job.units_completed),
                     updated_at = now()
               where id = actor;
            end if;
            v_force_complete := true;
            exit;
          end if;
          v_total_xp := v_total_xp + (v_output ->> 'xp')::bigint;
          v_completions := v_completions || jsonb_build_array(
            v_output || jsonb_build_object('jobId', v_job.id, 'recipeId', v_job.recipe_id));
          v_job.units_completed := v_job.units_completed + 1;
        end if;
      end loop;
      if v_force_complete or v_job.units_completed >= v_job.units_total then
        update public.craft_jobs
           set status = 'complete', completed_at = v_now where id = v_job.id;
        v_jobs_completed := v_jobs_completed + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('settled', true, 'advanced_ms', v_max_advance,
    'xp_awarded', v_total_xp, 'jobs_completed', v_jobs_completed,
    'completions', v_completions);
end;
$$;

-- ── 2. cc_fire_overclock_workshop (0030 body; charge burn removed)

create or replace function public.cc_fire_overclock_workshop(
  _player_id uuid,
  _nonce text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  prior jsonb;
  result jsonb;
  v_mod_payload jsonb;
  v_xp_rate numeric := least(0.85, greatest(0.70,
    public.cc_economy_config_number('craftXpRate', 0.775)));
  v_shift numeric := least(10, greatest(-10,
    public.cc_economy_config_number('craftQualityShift', 0)));
  v_temper numeric := least(0.30, greatest(0,
    public.cc_economy_config_number('gearTemperBaseChance', 0.05)));
  v_yield_base numeric := least(1.0, greatest(0.5,
    public.cc_economy_config_number('refineBaseYield', 0.8)));
  v_job public.craft_jobs%rowtype;
  v_bench integer;
  v_output jsonb;
  v_completions jsonb := '[]'::jsonb;
  v_jobs_completed integer := 0;
  v_total_xp bigint := 0;
  v_i integer;
begin
  if _player_id is null then raise exception 'Authentication required'; end if;
  if _nonce is null or length(trim(_nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior
    from public.verified_action_ledger
   where user_id = _player_id and idempotency_key = _nonce;
  if prior is not null then return prior || jsonb_build_object('idempotent_replay', true); end if;

  select * into p from public.profiles where id = _player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  if coalesce(p.action_skill_selection, '') <> 'Fixer' then
    raise exception 'Overclock requires the Fixer signature selected';
  end if;
  select payload into v_mod_payload from public.item_instances
   where owner_user_id = _player_id and runtime_state = 'equipped' and payload ? 'treeBonus'
   limit 1;
  if not public.cc_action_skill_qualified(p.skill_spends, v_mod_payload, 'Fixer') then
    raise exception 'Action skill not qualified for the selected tree';
  end if;
  if coalesce(p.action_skill_charge, 0) < 100 then
    raise exception 'Action skill is not charged';
  end if;
  if not exists (
    select 1 from public.craft_jobs
     where owner_user_id = _player_id and status = 'active'
       and units_completed < units_total
  ) then
    raise exception 'No craft unit in progress';
  end if;

  -- Spend the pool.
  update public.profiles
     set action_skill_charge = 0, updated_at = now()
   where id = _player_id
   returning * into p;

  -- Complete the in-progress unit on every bench: the head job of
  -- each bench (earliest created), exactly one unit per bench.
  for v_bench in
    select distinct bench from public.craft_jobs
     where owner_user_id = _player_id and status = 'active'
       and units_completed < units_total
     order by bench
  loop
    select * into v_job from public.craft_jobs
     where owner_user_id = _player_id and status = 'active' and bench = v_bench
       and units_completed < units_total
     order by created_at asc, id asc
     limit 1
     for update;
    if not found then continue; end if;

    -- Tools are permanent (economy brief §9.2, 0067): the fire marks
    -- the job tool_charged like the settler does, and spends nothing.
    if not v_job.tool_charged and v_job.snapshot ->> 'toolId' is not null then
      update public.craft_jobs set tool_charged = true where id = v_job.id;
    end if;

    update public.craft_jobs set accrued_ms = 0 where id = v_job.id;
    v_output := public.cc_complete_craft_unit(
      v_job.id, v_xp_rate, v_shift, v_temper, v_yield_base);

    if coalesce((v_output ->> 'vehicleFull')::boolean, false) then
      -- Repair job whose vehicle is already whole (or gone): end it
      -- and refund every unstarted kit at its escrowed quality — the
      -- settler's 0025 block verbatim, including the count bump
      -- (cc_add_consumable_batch does not move profiles.consumables).
      select * into v_job from public.craft_jobs where id = v_job.id;
      for v_i in v_job.units_completed .. v_job.units_total - 1 loop
        perform public.cc_add_consumable_batch(_player_id,
          v_job.snapshot -> 'repair' ->> 'kitType', 1,
          (v_job.snapshot -> 'repair' -> 'kitQualities' ->> v_i)::numeric,
          coalesce(v_job.snapshot -> 'repair' -> 'kitOrigins' ->> v_i, 'crafted'),
          _player_id, null, 'repair_refund',
          'Patch kit refunded (vehicle already at full condition)',
          '{}'::jsonb);
      end loop;
      if v_job.units_total - v_job.units_completed > 0 then
        update public.profiles
           set consumables = public.cc_jsonb_add_int(consumables,
                 v_job.snapshot -> 'repair' ->> 'kitType',
                 v_job.units_total - v_job.units_completed),
               updated_at = now()
         where id = _player_id;
      end if;
      update public.craft_jobs
         set status = 'complete', completed_at = now()
       where id = v_job.id;
      v_jobs_completed := v_jobs_completed + 1;
      continue;
    end if;

    v_total_xp := v_total_xp + coalesce((v_output ->> 'xp')::bigint, 0);
    v_completions := v_completions || jsonb_build_array(
      v_output || jsonb_build_object('jobId', v_job.id, 'recipeId', v_job.recipe_id));
    select * into v_job from public.craft_jobs where id = v_job.id;
    if v_job.units_completed >= v_job.units_total then
      update public.craft_jobs
         set status = 'complete', completed_at = now()
       where id = v_job.id;
      v_jobs_completed := v_jobs_completed + 1;
    end if;
  end loop;

  select * into p from public.profiles where id = _player_id;

  result := jsonb_build_object(
    'action_type', 'cc_fire_overclock_workshop',
    'fired', true,
    'completions', v_completions,
    'jobs_completed', v_jobs_completed,
    'xp_awarded', v_total_xp,
    'profile', public.cc_profile_snapshot(p)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (_player_id, 'cc_fire_overclock_workshop', _nonce, result);

  return result;
end;
$$;

-- ── 1. cc_pending_crafted_gear (0024 body; catalyst surface) ────

drop function if exists public.cc_pending_crafted_gear(uuid);

create or replace function public.cc_pending_crafted_gear(p_player_id uuid)
returns table(job_id uuid, unit integer, slot text, rarity text, item_level integer, draws integer, bench integer, tool_quality_multiplier numeric, quality_bounds jsonb)
language sql
stable
set search_path = public
as $$
  select j.id,
         (o ->> 'unit')::integer,
         o ->> 'slot',
         o ->> 'rarity',
         (o ->> 'item_level')::integer,
         (o ->> 'draws')::integer,
         j.bench,
         coalesce((j.snapshot ->> 'toolQualityMultiplier')::numeric, 1),
         o -> 'qualityBounds'
    from public.craft_jobs j,
         jsonb_array_elements(j.outputs) as o
   where j.owner_user_id = p_player_id
     and o ->> 'pending' = 'true'
$$;

-- ── 1. cc_finalize_crafted_gear (0024 body; records the roll) ───

drop function if exists public.cc_finalize_crafted_gear(uuid, uuid, integer, uuid);

create or replace function public.cc_finalize_crafted_gear(
  p_player_id uuid,
  p_job_id uuid,
  p_unit integer,
  p_item_id uuid,
  p_quality numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.craft_jobs%rowtype;
  v_outputs jsonb;
begin
  select * into job from public.craft_jobs
   where id = p_job_id and owner_user_id = p_player_id for update;
  if not found then raise exception 'Job not found'; end if;

  select coalesce(jsonb_agg(
    case
      when (elem ->> 'unit')::integer = p_unit and elem ->> 'pending' = 'true'
        then (elem - 'pending' - 'slot' - 'draws' - 'item_level' - 'qualityBounds')
             || jsonb_build_object('itemId', p_item_id)
             || case when p_quality is not null
                  then jsonb_build_object('quality', p_quality)
                  else '{}'::jsonb end
      else elem
    end order by ord), '[]'::jsonb)
    into v_outputs
    from jsonb_array_elements(job.outputs) with ordinality as t(elem, ord);

  update public.craft_jobs set outputs = v_outputs where id = job.id;
  return jsonb_build_object('job_id', p_job_id, 'unit', p_unit, 'item_id', p_item_id);
end;
$$;

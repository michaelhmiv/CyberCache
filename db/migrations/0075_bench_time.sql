-- 0075: Bench time — banked hours that widen the one bench
-- (economy redesign brief §8.2, §8.3, §8.7; owner ruling 7,
-- 2026-11-03: the three benches collapsed to one baseline bench in
-- slice 9, and the parallelism the collapse removed is restored by
-- banked bench-time hours, not by tools).
--
-- What lands here:
--   1. Bank state on the profile: bench_time_banked_seconds (the
--      bank; grants are whole hours, the cap is 24 h = 86,400 s)
--      plus bench_time_remainder_ms, the settlers' sub-second drain
--      remainder, carried so drain accounting is exact to the
--      millisecond while the bank itself stays whole seconds.
--   2. cc_bank_bench_time(p_player_id, p_nonce, p_ad_unit_id) —
--      the verified op behind one completed rewarded ad: +1 hour
--      banked (the benchTimeGrantSeconds lever), cap-enforced at
--      benchTimeBankCapSeconds, nonce-idempotent via the verified
--      action ledger. Attestation mirrors the cache lane exactly
--      (§8.2): client-side by design, NO SSV — the server's
--      controls are the nonce and the bank cap. Guests may bank
--      (§8.7: banking is not transacting; no economy gate).
--   3. cc_enqueue_craft_job — restated VERBATIM from 0073 (its
--      chain head) with ONE block changed: the queue-capacity gate
--      now reads the bank — while banked seconds remain, the
--      envelope is the pre-collapse shape (3 running + 15 queued,
--      the Fixer bonus counting x3); at zero it is the shipped
--      baseline (1 + 5, bonus x1). The rule's owner is
--      content/crafting.ts benchEnvelope.
--   4. cc_enqueue_tint_job — restated VERBATIM from 0073 with ONE
--      block changed: its own capacity gate (which has never
--      carried the Fixer bonus) widens the same way (18 vs 6).
--   5. cc_settle_craft_jobs — restated VERBATIM from 0073 with the
--      pass-2 lane machinery added: while at least one whole second
--      is banked, bench 1 spends its window across THREE lanes
--      (each lane holds the bench's full window; a finished lane's
--      leftover flows to the next queued job on that lane). Lanes
--      past the first are extra lanes: their busy time is the
--      bank's drain, deducted after the pass with the per-job
--      allowance clamped by the undrained bank — an emptied bank
--      stops the extra lanes accruing mid-settle and nothing else
--      happens: no job is killed, paused out of existence, or
--      repriced (§8.3's edges, resolved toward baseline-never-
--      starves). One running job is baseline and never drains.
--      Bench 0 (repair/shieldtech) keeps its single lane.
--
-- Provenance (grep-verified against every master migration):
--   cc_enqueue_craft_job  <- 0073 (0072's recipeScrap blocks and
--     0069's unified-Scrap escrow ride along byte-identical)
--   cc_enqueue_tint_job   <- 0073 (0072's tint Scrap lever kept)
--   cc_settle_craft_jobs  <- 0073 (0067's tool-permanence and
--     0063's offline-cap composition ride along byte-identical)
--   cc_bank_bench_time    <- NEW (0068's reroll op is its shape)
-- NOT restated: cc_cancel_craft_job (0069 — cancels read job
-- snapshots and never consult the envelope), cc_complete_craft_unit
-- (0073), cc_fire_overclock_workshop (0030/0067 — it completes the
-- head unit per bench; bench time does not widen it).
--
-- The TS twins land in the same change: src/content/crafting.ts
-- (benchEnvelope + the BENCH_TIME_* constants), src/server/writes/
-- craftEngine.ts (settle lanes + drain, enqueue/tint gates, the
-- workshop view's benchTime block), src/server/writes/memory.ts
-- (bank op mirror + view sync), src/server/writes/store.ts (the Pg
-- op + state read), src/lib/ads/rewardedBenchTimeAd.ts (the earn
-- module, sibling of rewardedCacheAd.ts), and the Workshop bench
-- strip's bench-time chip/earn control. Pinned by
-- src/test/benchTime.test.ts and the scratch-Postgres probes in
-- cybercache-prep/econ10-verification/.

-- ---------------------------------------------------------------------
-- 1. Bank state.
-- ---------------------------------------------------------------------

alter table public.profiles
  add column if not exists bench_time_banked_seconds integer not null default 0,
  add column if not exists bench_time_remainder_ms integer not null default 0;

-- ---------------------------------------------------------------------
-- 2. cc_bank_bench_time — one completed rewarded ad, +1 hour banked.
-- ---------------------------------------------------------------------

create or replace function public.cc_bank_bench_time(
  p_player_id uuid,
  p_nonce text,
  p_ad_unit_id text default null
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
  v_grant bigint;
  v_cap bigint;
  v_bank bigint;
  v_new_bank bigint;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if p_nonce is null or length(trim(p_nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = p_nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  -- Guests bank too (brief §8.7): crafting requires no verified
  -- account and banking is not transacting — no
  -- can_use_player_economy gate here, exactly as the cache lane
  -- attests ad value to guest accounts.

  -- The grant and the cap are economy-config levers, read live and
  -- clamped to the registry specs (src/server/economy/config.ts):
  -- benchTimeGrantSeconds [0, 86400] default 3600 (one hour per
  -- completed rewarded ad, §8.2); benchTimeBankCapSeconds
  -- [0, 604800] default 86400 (the 24 h bank cap, §8.2).
  v_grant := greatest(0, least(86400, coalesce(
    public.cc_economy_config_number('benchTimeGrantSeconds', 3600), 3600)))::bigint;
  v_cap := greatest(0, least(604800, coalesce(
    public.cc_economy_config_number('benchTimeBankCapSeconds', 86400), 86400)))::bigint;
  v_bank := coalesce(p.bench_time_banked_seconds, 0);
  if v_bank >= v_cap then
    raise exception 'Bench time bank full — 24 h';
  end if;
  v_new_bank := least(v_cap, v_bank + v_grant);

  update public.profiles
     set bench_time_banked_seconds = v_new_bank::integer,
         updated_at = now()
   where id = actor
   returning * into p;

  result := jsonb_build_object(
    'action_type', 'cc_bank_bench_time',
    'granted_seconds', v_new_bank - v_bank,
    'banked_seconds', v_new_bank,
    'bank_cap_seconds', v_cap,
    'grant_seconds', v_grant,
    'ad_unit_id', p_ad_unit_id,
    'profile', public.cc_profile_snapshot(p)
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_bank_bench_time', p_nonce, result);
  return result;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. cc_enqueue_craft_job — 0073 body verbatim; the bench-time
--    envelope gate is the only changed block.
-- ---------------------------------------------------------------------

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
       >= case when coalesce(p.bench_time_banked_seconds, 0) > 0
               then 18 + 3 * v_workshop_queue_bonus
               else 6 + v_workshop_queue_bonus end then
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

-- ---------------------------------------------------------------------
-- 4. cc_enqueue_tint_job — 0073 body verbatim; its capacity gate
--    widens with the bank, the only changed block.
-- ---------------------------------------------------------------------

create or replace function public.cc_enqueue_tint_job(
  p_player_id uuid, nonce text, item_id uuid, p_palette_id text
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
  recipe jsonb;
  v_palette jsonb;
  v_chroma integer := 0;
  v_scrap integer := 0;
  v_bench integer := 0;
  v_i integer;
  v_escrow jsonb := '{}'::jsonb;
  v_job public.craft_jobs%rowtype;
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

  recipe := public.cc_craft_recipe('tint_craft');
  if recipe is null then raise exception 'Unknown craft recipe'; end if;
  select elem into v_palette
    from jsonb_array_elements(recipe -> 'tintPalettes') as elem
   where elem ->> 'id' = p_palette_id
   limit 1;
  if v_palette is null then raise exception 'Unknown tint palette'; end if;
  v_chroma := coalesce((v_palette ->> 'chromaweave')::integer, 0);
  -- Economy brief §4 (0072): the tint craft's flat Scrap leg resolves
  -- through its lever (recipeScrap.tint_craft) exactly like the
  -- generic enqueue — clamped [0, 100000], catalog literal fallback.
  v_scrap := greatest(0, least(100000, coalesce(
    public.cc_economy_config_number('recipeScrap.tint_craft',
      coalesce((recipe -> 'inputs' ->> 'Scrap')::numeric, 0)),
    coalesce((recipe -> 'inputs' ->> 'Scrap')::numeric, 0))))::integer;

  select * into item from public.item_instances
   where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.kind <> 'cosmetic' then raise exception 'Item is not a cosmetic part'; end if;
  if item.runtime_state <> 'available' or item.is_locked then
    raise exception 'Part is not available for tinting';
  end if;
  if coalesce(item.payload ->> 'tintPaletteId', '') = p_palette_id then
    raise exception 'Part already carries that tint';
  end if;
  if exists (select 1 from public.craft_jobs
              where owner_user_id = actor and kind = 'cosmetic' and status = 'active'
                and snapshot -> 'tint' ->> 'itemId' = item.id::text) then
    raise exception 'A tint job is already running for this part';
  end if;

  -- Verify the full escrow before taking any of it (atomicity):
  -- the recipe's flat Scrap leg plus the palette's Chromaweave.
  if coalesce((p.materials ->> 'Scrap')::bigint, 0) < v_scrap then raise exception 'Insufficient scrap'; end if;
  if v_chroma > 0
     and coalesce((p.materials ->> 'Chromaweave')::integer, 0) < v_chroma then
    raise exception 'Insufficient material Chromaweave';
  end if;

  -- The one bench (slice 9), under the same capacity rule as
  -- the generic enqueue: one running + five queued — widened by
  -- banked bench time exactly like the generic gate (Econ 10,
  -- brief §8.3: three running + fifteen queued while the bank is
  -- above zero), except that this gate has never carried the
  -- Fixer queue bonus and still does not. The settle above has
  -- already drained the bank, so the figure read here is current.
  v_bench := 1;
  if (select count(*) from public.craft_jobs
       where owner_user_id = actor and status = 'active' and bench = v_bench)
       >= case when coalesce(p.bench_time_banked_seconds, 0) > 0 then 18 else 6 end then
    raise exception 'Bench queue is full';
  end if;

  if v_scrap > 0 then
    v_escrow := jsonb_set(v_escrow, array['Scrap'], to_jsonb(v_scrap), true);
    update public.profiles
       set materials = public.cc_jsonb_add_int(materials, 'Scrap', -v_scrap), updated_at = now()
     where id = actor;
  end if;
  if v_chroma > 0 then
    v_escrow := jsonb_set(v_escrow, array['Chromaweave'], to_jsonb(v_chroma), true);
    update public.profiles
       set materials = public.cc_jsonb_add_int(materials, 'Chromaweave', -v_chroma),
           updated_at = now()
     where id = actor;
  end if;

  insert into public.craft_jobs(
    owner_user_id, bench, kind, recipe_id, units_total, unit_duration_ms,
    escrow_inputs, escrow_catalyst, rush_ticket_quality, rush_ticket_origin,
    snapshot)
  values (actor, v_bench, 'cosmetic', 'tint_craft', 1,
    (recipe ->> 'unitDurationMs')::bigint,
    v_escrow, '{}'::jsonb, null, null,
    jsonb_build_object(
      'toolId', null, 'toolQualityMultiplier', 1, 'toolDurationMultiplier', 1,
      'toolRefineYieldBonus', 0, 'toolBonusUnitChance', 0,
      'skillDurationMultiplier', 1, 'rushReduction', 0, 'craftTimeScalar', 1,
      'catalystMaterialId', null, 'gearRarity', null,
      'tint', jsonb_build_object(
        'itemId', item.id, 'paletteId', p_palette_id,
        'fromPaletteId', item.payload ->> 'tintPaletteId')))
  returning * into v_job;

  select * into p from public.profiles where id = actor;
  result := jsonb_build_object('action_type', 'cc_enqueue_tint_job',
    'profile', public.cc_profile_snapshot(p),
    'job', public.cc_craft_job_json(v_job));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_enqueue_tint_job', nonce, result);
  return result;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. cc_settle_craft_jobs — 0073 body; pass 2 gains the bench-time
--    lanes and the drain deduction. Everything else verbatim.
-- ---------------------------------------------------------------------

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
  -- Bench time (Econ 10, brief §8.3): the bank at settle start in
  -- milliseconds (whole banked seconds + the carried sub-second
  -- remainder). Extra-lane busy time this settle is accumulated in
  -- v_extra_ms, clamped by the bank, and deducted after pass 2;
  -- the baseline lane never touches it.
  v_bank_ms bigint := 0;
  v_extra_ms bigint := 0;
  v_lanes integer := 1;
  v_lane_budgets bigint[] := '{}';
  v_lane integer := 0;
  v_li integer := 0;
  v_avail bigint := 0;
  v_init_avail bigint := 0;
  v_new_bank_ms bigint := 0;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  select * into p from public.profiles where id = actor for update;
  if not found then
    return jsonb_build_object('settled', false, 'reason', 'no_profile',
      'advanced_ms', 0, 'xp_awarded', 0, 'jobs_completed', 0,
      'completions', '[]'::jsonb);
  end if;
  v_bank_ms := coalesce(p.bench_time_banked_seconds, 0)::bigint * 1000
             + coalesce(p.bench_time_remainder_ms, 0);

  select active_action, (extract(epoch from last_heartbeat_at) * 1000)::bigint
    into v_action, v_heartbeat_ms
    from public.active_actions where user_id = actor;

  -- Internal away cap: min(earned cap, limiter when set), [1h, 24h].
  v_away_cap_ms := (greatest(1, least(
      public.cc_earned_offline_cap_hours_for(p.id),
      coalesce(nullif(p.offline_cap_hours, 0)::numeric,
               public.cc_earned_offline_cap_hours_for(p.id))
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
  -- flows to the next job on the bench. Bench time (Econ 10, brief
  -- §8.3): while at least one whole second is banked, bench 1 runs
  -- THREE lanes — the window is spendable by up to three jobs
  -- concurrently, each lane holding the bench's full window, a
  -- finished lane's leftover flowing to the next queued job on that
  -- lane. Lanes past the first are the extra lanes: the time they
  -- spend is the bank's drain (accumulated as v_extra_ms and
  -- deducted after the pass), and their per-job allowance is
  -- clamped by the undrained bank, so the moment the bank empties
  -- the extra lanes stop accruing — mid-job, without killing,
  -- pausing out of existence, or repricing anything: the job
  -- simply waits for baseline capacity like any queued job. Every
  -- other bench (the bench-0 repair/shieldtech lane) keeps the
  -- single lane it has always had.
  for v_bench in
    select distinct bench from public.craft_jobs
     where owner_user_id = actor and status = 'active'
     order by bench asc
  loop
    select coalesce(max(adv), 0) into v_budget
      from unnest(v_ids, v_benches, v_advances) as t(jid, b, adv)
     where b = v_bench;
    v_lanes := case when v_bench = 1 and v_bank_ms >= 1000 then 3 else 1 end;
    v_lane_budgets := array_fill(v_budget, array[v_lanes]);
    for v_job in
      select * from public.craft_jobs
       where owner_user_id = actor and status = 'active' and bench = v_bench
       order by created_at asc, id asc
       for update
    loop
      -- Take the usable lane holding the most window (ties go to
      -- the lowest lane, so a lone job always lands on the baseline
      -- lane and never drains). A lane past the first is usable
      -- only while undrained bank remains.
      v_lane := 0;
      v_avail := 0;
      for v_li in 1 .. v_lanes loop
        if v_lane_budgets[v_li] > v_avail
           and (v_li = 1 or v_extra_ms < v_bank_ms) then
          v_lane := v_li;
          v_avail := v_lane_budgets[v_li];
        end if;
      end loop;
      exit when v_lane = 0;
      if v_lane > 1 then
        v_avail := least(v_avail, v_bank_ms - v_extra_ms);
      end if;
      v_init_avail := v_avail;
      -- Tools are permanent (economy brief §9.2, 0067): the job is
      -- still marked tool_charged at its first unit for the record,
      -- but no charge is spent -- a fitted tool is never consumed,
      -- un-owned, or unfitted by use. Pre-0067 charges values stored
      -- in profiles.workshop_tools are inert.
      if not v_job.tool_charged and (v_job.snapshot ->> 'toolId') is not null then
        update public.craft_jobs set tool_charged = true where id = v_job.id;
      end if;
      v_force_complete := false;
      while v_avail > 0 and v_job.units_completed < v_job.units_total loop
        v_need := v_job.unit_duration_ms - v_job.accrued_ms;
        if v_avail < v_need then
          update public.craft_jobs
             set accrued_ms = accrued_ms + v_avail where id = v_job.id;
          v_avail := 0;
        else
          v_avail := v_avail - v_need;
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
      -- Lane bookkeeping: what this job drew from its lane leaves
      -- the lane; on an extra lane it is also the bank's drain.
      v_lane_budgets[v_lane] := v_lane_budgets[v_lane] - (v_init_avail - v_avail);
      if v_lane > 1 then
        v_extra_ms := v_extra_ms + (v_init_avail - v_avail);
      end if;
      if v_force_complete or v_job.units_completed >= v_job.units_total then
        update public.craft_jobs
           set status = 'complete', completed_at = v_now where id = v_job.id;
        v_jobs_completed := v_jobs_completed + 1;
      end if;
    end loop;
  end loop;

  -- Bench-time drain (Econ 10, brief §8.3): deduct this settle's
  -- extra-lane busy time from the bank — whole seconds into the
  -- bank column, the sub-second remainder carried on the profile
  -- so no fraction of a banked hour is ever lost to rounding.
  if v_extra_ms > 0 then
    v_new_bank_ms := greatest(0, v_bank_ms - v_extra_ms);
    update public.profiles
       set bench_time_banked_seconds = (v_new_bank_ms / 1000)::integer,
           bench_time_remainder_ms = (v_new_bank_ms % 1000)::integer,
           updated_at = now()
     where id = actor;
  end if;

  return jsonb_build_object('settled', true, 'advanced_ms', v_max_advance,
    'xp_awarded', v_total_xp, 'jobs_completed', v_jobs_completed,
    'completions', v_completions);
end;
$$;

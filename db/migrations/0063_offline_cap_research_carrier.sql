-- 0063_offline_cap_research_carrier.sql
--
-- Gate-removal step 6 — the LAST step of the no-level-gates program
-- (audit G6): the offline earnings cap stops growing by PLAYER
-- LEVEL. The level tiers (0015: L20/40/60/80 -> 4/6/8/12h over a 2h
-- base, twinned in SQL by 0024's cc_earned_offline_cap_hours) are
-- retired; the carrier that replaces them is the Research Shop
-- track (Logistics & Markets), whose faculty text always promised
-- it "pays in buyback, offline hours, and thinner fees":
--
--   Street Economics (T1)   offlineCapBonus +2   -> earned cap 4h
--   Supply Chains (T2)      offlineCapBonus +4   -> earned cap 8h
--   Syndicate Ledger (T3)   offlineCapBonus +4   -> earned cap 12h
--
-- The reachable earned range is preserved exactly (2h floor -> 12h
-- ceiling, monotonic across the chain); the AFK law is untouched
-- (effective = min(earned + Scavenger keystone bonus, the player's
-- limiter, the 24h absolute ceiling) — the keystone is a skill
-- bonus, not a level gate, and stays). The TS source of truth is
-- src/content/offlineCap.ts (OFFLINE_CAP_MILESTONES derives from
-- the same catalog); this migration restates the SQL twins:
--
--   1. cc_research_course / cc_research_catalog (from 0059) with
--      the three Logistics grants above — the only catalog change.
--   2. cc_research_offline_cap_bonus: was a hardcoded
--      supply_chains-only case worth 1; now the catalog sum over
--      the player's completions (cc_research_bonus_number), so the
--      composition points read the catalog like every other key.
--   3. cc_earned_offline_cap_hours_for(uuid): the earned cap for a
--      player = 2 + the research bonus. Player level is not read.
--   4. The four internal away-cap compositions (cc_settle_craft_
--      jobs from 0044, cc_settle_repair_job + cc_settle_extraction_
--      time from 0038, cc_settle_shieldtech_job from 0044) restated
--      with ONLY the earned term swapped: tier(level) [+ research]
--      becomes cc_earned_offline_cap_hours_for(player). The
--      shieldtech settler previously read the tier alone; it now
--      reads the same earned value as the rest of the family —
--      the earned definition changed, not the composition shape.
--   5. cc_earned_offline_cap_hours(integer) is dropped: no live
--      caller remains.
--
-- RIDER (economy audit section E, Q7): cc_set_active_action (from
-- 0053, the latest restatement) still enforced a leftover area
-- level gate on the EXTRACTION start path — 'Area locked for this
-- hunter level' when roaming_areas.unlock_level exceeded the
-- player's level — even though roaming itself was ungated in step
-- #316 and the TS twin (extractionEngine.assertExtractionStart-
-- Allowed) never carried the check. The gate is removed below;
-- every other start gate (verified account, no standing death
-- record, a real area, Deep Delve mastery 5) is byte-identical.
-- roaming_areas.unlock_level itself stays: it is area design data
-- (monster tier mapping, XP scaling, resurrection pricing), never
-- a player gate after this migration.
--
-- Behavior pins: a brand-new account's earned cap is 2h at any
-- level; a level-100 account with no Logistics completions still
-- earns 2h; a level-1 account with the Logistics chain complete
-- earns the full 12h; extraction starts in any area at any level.

-- ─── 1. Research catalog: the Logistics offline-cap grants ───

create or replace function public.cc_research_course(p_course_id text)
returns jsonb
language sql
stable
as $func$
  select c.course
    from jsonb_array_elements($catalog$[
  {
    "id": "shop_fundamentals",
    "faculty": "fabrication",
    "tier": 1,
    "name": "Shop Fundamentals",
    "durationHours": 6,
    "costCredits": 2500,
    "effects": {
      "craftQualityShift": 2
    }
  },
  {
    "id": "production_systems",
    "faculty": "fabrication",
    "tier": 2,
    "name": "Production Systems",
    "durationHours": 48,
    "costCredits": 15000,
    "prerequisite": "shop_fundamentals",
    "requiresBench": 2,
    "effects": {}
  },
  {
    "id": "master_fabricator",
    "faculty": "fabrication",
    "tier": 3,
    "name": "Master Fabricator Certification",
    "durationHours": 168,
    "costCredits": 60000,
    "prerequisite": "production_systems",
    "requiresBench": 3,
    "effects": {
      "gearTemperBonus": 0.03,
      "gearDrawBonus": 1
    }
  },
  {
    "id": "wrench_basics",
    "faculty": "field_mechanics",
    "tier": 1,
    "name": "Wrench Basics",
    "durationHours": 6,
    "costCredits": 2500,
    "effects": {
      "repairWorkRateBonus": 0.05
    }
  },
  {
    "id": "powertrain_systems",
    "faculty": "field_mechanics",
    "tier": 2,
    "name": "Powertrain Systems",
    "durationHours": 48,
    "costCredits": 15000,
    "prerequisite": "wrench_basics",
    "effects": {
      "vehicleDecayReduction": 0.1
    }
  },
  {
    "id": "master_mechanic",
    "faculty": "field_mechanics",
    "tier": 3,
    "name": "Master Mechanic Certification",
    "durationHours": 168,
    "costCredits": 60000,
    "prerequisite": "powertrain_systems",
    "effects": {
      "repairServiceXpBonus": 1
    }
  },
  {
    "id": "street_economics",
    "faculty": "logistics_markets",
    "tier": 1,
    "name": "Street Economics",
    "durationHours": 6,
    "costCredits": 2500,
    "effects": {
      "vendorBuybackBonus": 0.02,
      "offlineCapBonus": 2
    }
  },
  {
    "id": "supply_chains",
    "faculty": "logistics_markets",
    "tier": 2,
    "name": "Supply Chains",
    "durationHours": 48,
    "costCredits": 15000,
    "prerequisite": "street_economics",
    "effects": {
      "offlineCapBonus": 4
    }
  },
  {
    "id": "syndicate_ledger",
    "faculty": "logistics_markets",
    "tier": 3,
    "name": "Syndicate Ledger",
    "durationHours": 168,
    "costCredits": 60000,
    "prerequisite": "supply_chains",
    "effects": {
      "marketFeeReduction": 0.05,
      "offlineCapBonus": 4
    }
  },
  {
    "id": "ballistics_theory",
    "faculty": "xenotech",
    "tier": 1,
    "name": "Ballistics Theory",
    "durationHours": 6,
    "costCredits": 2500,
    "effects": {
      "weaponDamage": 0.01
    }
  },
  {
    "id": "shield_dynamics",
    "faculty": "xenotech",
    "tier": 2,
    "name": "Shield Dynamics",
    "durationHours": 48,
    "costCredits": 15000,
    "prerequisite": "ballistics_theory",
    "effects": {
      "shieldCapacity": 0.02
    }
  },
  {
    "id": "void_theory",
    "faculty": "xenotech",
    "tier": 3,
    "name": "Void Theory Certification",
    "durationHours": 168,
    "costCredits": 60000,
    "prerequisite": "shield_dynamics",
    "effects": {
      "bossDedicatedChanceBonus": 0.01
    }
  }
]$catalog$::jsonb) as c(course)
   where c.course ->> 'id' = p_course_id
   limit 1;
$func$;

create or replace function public.cc_research_catalog()
returns jsonb
language sql
stable
as $func$
  select $catalog$[
  {
    "id": "shop_fundamentals",
    "faculty": "fabrication",
    "tier": 1,
    "name": "Shop Fundamentals",
    "durationHours": 6,
    "costCredits": 2500,
    "effects": {
      "craftQualityShift": 2
    }
  },
  {
    "id": "production_systems",
    "faculty": "fabrication",
    "tier": 2,
    "name": "Production Systems",
    "durationHours": 48,
    "costCredits": 15000,
    "prerequisite": "shop_fundamentals",
    "requiresBench": 2,
    "effects": {}
  },
  {
    "id": "master_fabricator",
    "faculty": "fabrication",
    "tier": 3,
    "name": "Master Fabricator Certification",
    "durationHours": 168,
    "costCredits": 60000,
    "prerequisite": "production_systems",
    "requiresBench": 3,
    "effects": {
      "gearTemperBonus": 0.03,
      "gearDrawBonus": 1
    }
  },
  {
    "id": "wrench_basics",
    "faculty": "field_mechanics",
    "tier": 1,
    "name": "Wrench Basics",
    "durationHours": 6,
    "costCredits": 2500,
    "effects": {
      "repairWorkRateBonus": 0.05
    }
  },
  {
    "id": "powertrain_systems",
    "faculty": "field_mechanics",
    "tier": 2,
    "name": "Powertrain Systems",
    "durationHours": 48,
    "costCredits": 15000,
    "prerequisite": "wrench_basics",
    "effects": {
      "vehicleDecayReduction": 0.1
    }
  },
  {
    "id": "master_mechanic",
    "faculty": "field_mechanics",
    "tier": 3,
    "name": "Master Mechanic Certification",
    "durationHours": 168,
    "costCredits": 60000,
    "prerequisite": "powertrain_systems",
    "effects": {
      "repairServiceXpBonus": 1
    }
  },
  {
    "id": "street_economics",
    "faculty": "logistics_markets",
    "tier": 1,
    "name": "Street Economics",
    "durationHours": 6,
    "costCredits": 2500,
    "effects": {
      "vendorBuybackBonus": 0.02,
      "offlineCapBonus": 2
    }
  },
  {
    "id": "supply_chains",
    "faculty": "logistics_markets",
    "tier": 2,
    "name": "Supply Chains",
    "durationHours": 48,
    "costCredits": 15000,
    "prerequisite": "street_economics",
    "effects": {
      "offlineCapBonus": 4
    }
  },
  {
    "id": "syndicate_ledger",
    "faculty": "logistics_markets",
    "tier": 3,
    "name": "Syndicate Ledger",
    "durationHours": 168,
    "costCredits": 60000,
    "prerequisite": "supply_chains",
    "effects": {
      "marketFeeReduction": 0.05,
      "offlineCapBonus": 4
    }
  },
  {
    "id": "ballistics_theory",
    "faculty": "xenotech",
    "tier": 1,
    "name": "Ballistics Theory",
    "durationHours": 6,
    "costCredits": 2500,
    "effects": {
      "weaponDamage": 0.01
    }
  },
  {
    "id": "shield_dynamics",
    "faculty": "xenotech",
    "tier": 2,
    "name": "Shield Dynamics",
    "durationHours": 48,
    "costCredits": 15000,
    "prerequisite": "ballistics_theory",
    "effects": {
      "shieldCapacity": 0.02
    }
  },
  {
    "id": "void_theory",
    "faculty": "xenotech",
    "tier": 3,
    "name": "Void Theory Certification",
    "durationHours": 168,
    "costCredits": 60000,
    "prerequisite": "shield_dynamics",
    "effects": {
      "bossDedicatedChanceBonus": 0.01
    }
  }
]$catalog$::jsonb;
$func$;

-- ─── 2. The research offline-cap bonus reads the catalog ─────

-- Was (0038): a hardcoded CASE on supply_chains worth 1 hour.
-- Now: the catalog sum for the offlineCapBonus key over the
-- player's completions — the ONLY way a research term enters any
-- engine composition in SQL (the cc_research_bonus_number rule).

create or replace function public.cc_research_offline_cap_bonus(p_player_id uuid)
returns integer
language sql
stable
as $func$
  select coalesce(
           public.cc_research_bonus_number(p_player_id, 'offlineCapBonus'), 0)::integer;
$func$;

-- ─── 3. The earned offline cap, Research-carried ─────────────

-- (src/content/offlineCap.ts twin after gate-removal step 6): the
-- 2h base plus the Research Logistics track's offline-cap grants
-- from the player's own completion rows. Player level is not read.
create or replace function public.cc_earned_offline_cap_hours_for(p_player_id uuid)
returns numeric
language sql
stable
set search_path = public
as $$
  select 2::numeric + public.cc_research_offline_cap_bonus(p_player_id);
$$;

-- ─── 4. Internal away-cap compositions ───────────────────────

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
  v_tools jsonb;
  v_tool_id text;
  v_charges integer;
  v_fitted_key text;
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
      -- A fitted tool's charge is spent when the job actually starts.
      if not v_job.tool_charged and (v_job.snapshot ->> 'toolId') is not null then
        v_tool_id := v_job.snapshot ->> 'toolId';
        update public.craft_jobs set tool_charged = true where id = v_job.id;
        select * into p from public.profiles where id = actor;
        v_tools := coalesce(p.workshop_tools, '{}'::jsonb);
        v_charges := coalesce((v_tools -> 'charges' ->> v_tool_id)::integer, 0) - 1;
        v_tools := jsonb_set(v_tools, array['charges', v_tool_id],
          to_jsonb(greatest(0, v_charges)), true);
        if v_charges <= 0 then
          v_tools := jsonb_set(v_tools, array['owned', v_tool_id], 'false'::jsonb, true);
          for v_fitted_key in
            select key from jsonb_each(coalesce(v_tools -> 'fitted', '{}'::jsonb))
          loop
            if v_tools -> 'fitted' ->> v_fitted_key = v_tool_id then
              v_tools := jsonb_set(v_tools, array['fitted', v_fitted_key], 'null'::jsonb, true);
            end if;
          end loop;
        end if;
        update public.profiles set workshop_tools = v_tools, updated_at = now()
         where id = actor;
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

create or replace function public.cc_settle_repair_job(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.service_jobs%rowtype;
  provider public.profiles%rowtype;
  item public.item_instances%rowtype;
  v_now timestamptz := now();
  v_now_ms bigint := (extract(epoch from v_now) * 1000)::bigint;
  v_last_ms bigint;
  v_raw bigint;
  v_action text;
  v_target_id text;
  v_heartbeat_ms bigint;
  v_attended bigint;
  v_away_cap_ms bigint;
  v_advance bigint;
  v_work numeric;
  v_applied numeric;
  v_capacity numeric;
  v_burn jsonb;
  v_entry jsonb;
  v_quality numeric;
  v_kit_base numeric;
  v_restored numeric;
  v_idx integer;
begin
  select * into job from public.service_jobs where id = p_job_id for update;
  if not found then return jsonb_build_object('settled', false, 'reason', 'not_found'); end if;
  if job.status <> 'active' or job.provider_user_id is null then
    return jsonb_build_object('settled', false, 'reason', 'not_active');
  end if;

  v_last_ms := (extract(epoch from coalesce(job.last_settled_at, job.accepted_at, v_now)) * 1000)::bigint;
  update public.service_jobs set last_settled_at = v_now where id = job.id;
  v_raw := greatest(0, v_now_ms - v_last_ms);
  if v_raw <= 0 then return jsonb_build_object('settled', true, 'advanced_ms', 0); end if;

  select * into provider from public.profiles where id = job.provider_user_id;
  if not found then return jsonb_build_object('settled', false, 'reason', 'no_provider'); end if;
  select active_action, target_id, (extract(epoch from last_heartbeat_at) * 1000)::bigint
    into v_action, v_target_id, v_heartbeat_ms
    from public.active_actions where user_id = provider.id;
  if v_action is distinct from 'workshop_service' or v_target_id is distinct from job.id::text then
    return jsonb_build_object('settled', true, 'advanced_ms', 0);
  end if;

  v_attended := least(v_raw, greatest(0,
    coalesce(v_heartbeat_ms, v_last_ms) + 300000 - v_last_ms));
  v_away_cap_ms := (greatest(1, least(
      public.cc_earned_offline_cap_hours_for(provider.id),
      coalesce(nullif(provider.offline_cap_hours, 0)::numeric,
               public.cc_earned_offline_cap_hours_for(provider.id))
    )) * 3600000)::bigint;
  v_advance := v_attended + least(v_raw - v_attended, v_away_cap_ms);
  if v_advance <= 0 then return jsonb_build_object('settled', true, 'advanced_ms', 0); end if;

  select * into item from public.item_instances where id = job.target_item_instance_id for update;
  v_kit_base := case job.kit_type
    when 'PatchKit' then 30 when 'FieldPatchKit' then 45
    when 'MasterPatchKit' then 80 else 0 end;
  v_work := coalesce(job.work_points_banked, 0)
    + (v_advance::numeric / 3600000)
      * coalesce((job.repair_snapshot ->> 'workRatePointsPerHour')::numeric, 20);
  v_restored := coalesce(job.points_restored, 0);
  v_capacity := coalesce(job.open_kit_capacity, 0);

  while v_work > 0.000001 and v_restored < coalesce(job.target_points, 0) - 0.0001 loop
    if v_capacity <= 0.000001 then
      -- Open the mechanic's next kit: FIFO, worst quality first.
      -- Legacy counts without batch rows backfill first, the
      -- cc_consume_consumable guard.
      if not exists (select 1 from public.consumable_batches
                      where owner_user_id = provider.id
                        and consumable_type = job.kit_type and quantity > 0) then
        if coalesce((provider.consumables ->> job.kit_type)::integer, 0) > 0 then
          perform public.cc_add_consumable_batch(provider.id, job.kit_type,
            (provider.consumables ->> job.kit_type)::integer, 100, 'vendor',
            null, null, 'admin_adjust',
            'Backfilled legacy count into 100% batch before consumption',
            '{}'::jsonb);
        else
          exit; -- Out of kits: work stalls, banked points are kept.
        end if;
      end if;
      v_burn := public.cc_consume_consumable_batch(
        provider.id, job.kit_type, 1, 'workshop_service', 'repair_job', '{}'::jsonb);
      update public.profiles
         set consumables = public.cc_jsonb_add_int(consumables, job.kit_type, -1),
             updated_at = now()
       where id = provider.id
       returning * into provider;
      v_entry := v_burn -> 'consumed' -> 0;
      v_quality := coalesce((v_entry ->> 'quality_percent')::numeric, 100);
      v_capacity := round(v_kit_base * v_quality / 100
        * coalesce((job.repair_snapshot ->> 'efficiency')::numeric, 1), 2);
      job.open_kit_total := v_capacity;
      job.open_kit_quality := v_quality;
      job.kits_consumed := coalesce(job.kits_consumed, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object('kitType', job.kit_type, 'quality', v_quality,
          'pointsApplied', 0));
    end if;
    v_applied := least(v_work, v_capacity,
      coalesce(job.target_points, 0) - v_restored,
      greatest(0, coalesce(item.condition_max, 100)
        - coalesce(item.condition_current, item.condition_max, 100)));
    exit when v_applied <= 0.000001;
    v_work := v_work - v_applied;
    v_capacity := v_capacity - v_applied;
    v_restored := round(v_restored + v_applied, 4);
    update public.item_instances
       set condition_current = least(coalesce(condition_max, 100),
             coalesce(condition_current, condition_max, 100) + v_applied),
           updated_at = now()
     where id = item.id
     returning * into item;
    v_idx := jsonb_array_length(job.kits_consumed) - 1;
    job.kits_consumed := jsonb_set(job.kits_consumed,
      array[v_idx::text, 'pointsApplied'],
      to_jsonb(round(coalesce(
        (job.kits_consumed -> v_idx ->> 'pointsApplied')::numeric, 0) + v_applied, 4)), true);
    job.last_progress_at := v_now;
  end loop;

  update public.service_jobs
     set accrued_work_ms = coalesce(accrued_work_ms, 0) + v_advance,
         work_points_banked = v_work,
         points_restored = v_restored,
         open_kit_capacity = v_capacity,
         open_kit_total = job.open_kit_total,
         open_kit_quality = job.open_kit_quality,
         kits_consumed = job.kits_consumed,
         last_progress_at = job.last_progress_at
   where id = job.id;

  if v_restored >= coalesce(job.target_points, 0) - 0.0001
     or coalesce(item.condition_current, 0) >= coalesce(item.condition_max, 100) - 0.0001 then
    perform public.cc_repair_finalize_job(job.id, 'completed');
  end if;
  return jsonb_build_object('settled', true, 'advanced_ms', v_advance,
    'points_restored', v_restored);
end;
$$;

create or replace function public.cc_settle_extraction_time(
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
  s public.extraction_state%rowtype;
  v_start_ms bigint;
  v_raw bigint;
  v_attended bigint;
  v_advance bigint := 0;
  v_total bigint;
  v_new_passes integer := 0;
  v_pass_index integer;
  v_pending jsonb;
  v_area text;
  v_method text;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  select * into p from public.profiles where id = actor for update;
  if not found then
    return jsonb_build_object('settled', false, 'reason', 'no_profile',
      'advanced_ms', 0, 'new_passes', 0,
      'pending_passes', '[]'::jsonb, 'accrued_ms', 0);
  end if;

  select * into s from public.extraction_state where user_id = actor for update;
  if not found then
    return jsonb_build_object('settled', false, 'reason', 'no_extraction_state',
      'advanced_ms', 0, 'new_passes', 0,
      'pending_passes', '[]'::jsonb, 'accrued_ms', 0);
  end if;

  select active_action, (extract(epoch from last_heartbeat_at) * 1000)::bigint
    into v_action, v_heartbeat_ms
    from public.active_actions where user_id = actor;

  -- Internal away cap: min(earned cap, limiter when set), [1h, 24h].
  v_away_cap_ms := (greatest(1, least(
      public.cc_earned_offline_cap_hours_for(p.id),
      coalesce(nullif(p.offline_cap_hours, 0)::numeric,
               public.cc_earned_offline_cap_hours_for(p.id))
    )) * 3600000)::bigint;

  v_start_ms := (extract(epoch from s.last_settled_at) * 1000)::bigint;
  v_raw := greatest(0, v_now_ms - v_start_ms);
  if v_action is distinct from 'extraction' or v_raw <= 0 then
    v_advance := 0;
  elsif p_max_advance_ms is not null then
    v_advance := least(v_raw, greatest(0, p_max_advance_ms));
  else
    v_attended := least(v_raw, greatest(0,
      coalesce(v_heartbeat_ms, v_start_ms) + 300000 - v_start_ms));
    v_advance := v_attended + least(v_raw - v_attended, v_away_cap_ms);
  end if;

  v_total := s.accrued_ms + v_advance;
  v_pending := s.pending_passes;
  v_area := coalesce(s.pass_area_id, s.area_id);
  v_method := coalesce(s.pass_method, s.method);
  v_pass_index := s.finalized_passes + jsonb_array_length(v_pending);
  while v_total >= 600000 loop
    v_total := v_total - 600000;
    v_pass_index := v_pass_index + 1;
    v_pending := v_pending || jsonb_build_array(jsonb_build_object(
      'index', v_pass_index, 'areaId', v_area, 'method', v_method));
    v_new_passes := v_new_passes + 1;
    v_area := s.area_id;
    v_method := s.method;
  end loop;

  update public.extraction_state
     set accrued_ms = v_total,
         pending_passes = v_pending,
         pass_area_id = v_area,
         pass_method = v_method,
         last_settled_at = v_now,
         updated_at = v_now
   where user_id = actor;

  return jsonb_build_object('settled', true, 'advanced_ms', v_advance,
    'new_passes', v_new_passes, 'pending_passes', v_pending,
    'accrued_ms', v_total);
end;
$$;

create or replace function public.cc_settle_shieldtech_job(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.service_jobs%rowtype;
  provider public.profiles%rowtype;
  v_now timestamptz := now();
  v_now_ms bigint := (extract(epoch from v_now) * 1000)::bigint;
  v_last_ms bigint;
  v_raw bigint;
  v_action text;
  v_target_id text;
  v_heartbeat_ms bigint;
  v_attended bigint;
  v_away_cap_ms bigint;
  v_advance bigint;
  v_work numeric;
  v_applied numeric;
  v_capacity numeric;
  v_burn jsonb;
  v_entry jsonb;
  v_quality numeric;
  v_done numeric;
  v_idx integer;
begin
  select * into job from public.service_jobs where id = p_job_id for update;
  if not found then return jsonb_build_object('settled', false, 'reason', 'not_found'); end if;
  if job.status <> 'active' or job.provider_user_id is null then
    return jsonb_build_object('settled', false, 'reason', 'not_active');
  end if;

  v_last_ms := (extract(epoch from coalesce(job.last_settled_at, job.accepted_at, v_now)) * 1000)::bigint;
  update public.service_jobs set last_settled_at = v_now where id = job.id;
  v_raw := greatest(0, v_now_ms - v_last_ms);
  if v_raw <= 0 then return jsonb_build_object('settled', true, 'advanced_ms', 0); end if;

  select * into provider from public.profiles where id = job.provider_user_id;
  if not found then return jsonb_build_object('settled', false, 'reason', 'no_provider'); end if;
  select active_action, target_id, (extract(epoch from last_heartbeat_at) * 1000)::bigint
    into v_action, v_target_id, v_heartbeat_ms
    from public.active_actions where user_id = provider.id;
  if v_action is distinct from 'workshop_service' or v_target_id is distinct from job.id::text then
    return jsonb_build_object('settled', true, 'advanced_ms', 0);
  end if;

  v_attended := least(v_raw, greatest(0,
    coalesce(v_heartbeat_ms, v_last_ms) + 300000 - v_last_ms));
  v_away_cap_ms := (greatest(1, least(
      public.cc_earned_offline_cap_hours_for(provider.id),
      coalesce(nullif(provider.offline_cap_hours, 0)::numeric,
               public.cc_earned_offline_cap_hours_for(provider.id))
    )) * 3600000)::bigint;
  v_advance := v_attended + least(v_raw - v_attended, v_away_cap_ms);
  if v_advance <= 0 then return jsonb_build_object('settled', true, 'advanced_ms', 0); end if;

  v_work := coalesce(job.work_points_banked, 0)
    + (v_advance::numeric / 3600000)
      * coalesce((job.shieldtech_snapshot ->> 'workRatePointsPerHour')::numeric, 500);
  v_done := coalesce(job.points_restored, 0);
  v_capacity := coalesce(job.open_kit_capacity, 0);

  while v_work > 0.000001 and v_done < coalesce(job.target_points, 0) - 0.0001 loop
    if v_capacity <= 0.000001 then
      -- Open the tech's next Calibration Core: worst quality first.
      -- Legacy counts without batch rows backfill first, the
      -- cc_consume_consumable guard.
      if not exists (select 1 from public.consumable_batches
                      where owner_user_id = provider.id
                        and consumable_type = 'CalibrationCore' and quantity > 0) then
        if coalesce((provider.consumables ->> 'CalibrationCore')::integer, 0) > 0 then
          perform public.cc_add_consumable_batch(provider.id, 'CalibrationCore',
            (provider.consumables ->> 'CalibrationCore')::integer, 100, 'vendor',
            null, null, 'admin_adjust',
            'Backfilled legacy count into 100% batch before consumption',
            '{}'::jsonb);
        else
          exit; -- Out of cores: work stalls, banked points are kept.
        end if;
      end if;
      v_burn := public.cc_consume_consumable_batch(
        provider.id, 'CalibrationCore', 1, 'workshop_service', 'shieldtech_job', '{}'::jsonb);
      update public.profiles
         set consumables = public.cc_jsonb_add_int(consumables, 'CalibrationCore', -1),
             updated_at = now()
       where id = provider.id
       returning * into provider;
      v_entry := v_burn -> 'consumed' -> 0;
      v_quality := coalesce((v_entry ->> 'quality_percent')::numeric, 100);
      v_capacity := round(2500 * v_quality / 100
        * coalesce((job.shieldtech_snapshot ->> 'efficiency')::numeric, 1), 2);
      job.open_kit_total := v_capacity;
      job.open_kit_quality := v_quality;
      job.kits_consumed := coalesce(job.kits_consumed, '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object('kitType', 'CalibrationCore', 'quality', v_quality,
          'pointsApplied', 0));
    end if;
    v_applied := least(v_work, v_capacity,
      coalesce(job.target_points, 0) - v_done);
    exit when v_applied <= 0.000001;
    v_work := v_work - v_applied;
    v_capacity := v_capacity - v_applied;
    v_done := round(v_done + v_applied, 4);
    v_idx := jsonb_array_length(job.kits_consumed) - 1;
    job.kits_consumed := jsonb_set(job.kits_consumed,
      array[v_idx::text, 'pointsApplied'],
      to_jsonb(round(coalesce(
        (job.kits_consumed -> v_idx ->> 'pointsApplied')::numeric, 0) + v_applied, 4)), true);
    job.last_progress_at := v_now;
  end loop;

  update public.service_jobs
     set accrued_work_ms = coalesce(accrued_work_ms, 0) + v_advance,
         work_points_banked = v_work,
         points_restored = v_done,
         open_kit_capacity = v_capacity,
         open_kit_total = job.open_kit_total,
         open_kit_quality = job.open_kit_quality,
         kits_consumed = job.kits_consumed,
         last_progress_at = job.last_progress_at
   where id = job.id;

  if v_done >= coalesce(job.target_points, 0) - 0.0001 then
    perform public.cc_shieldtech_finalize_job(job.id, 'completed');
  end if;
  return jsonb_build_object('settled', true, 'advanced_ms', v_advance,
    'points_completed', v_done);
end;
$$;

-- ─── 5. Rider: the extraction start gate loses its level check ─

-- cc_set_active_action restated from 0053 with ONLY the leftover
-- roaming_areas.unlock_level check removed from the extraction
-- block (and its header comment updated). Everything else —
-- settler hooks, gates, selection sync, the activity write, the
-- ledger row — is the 0053 body verbatim.

CREATE OR REPLACE FUNCTION public.cc_set_active_action(p_player_id uuid, nonce text, action_kind text, target_type text DEFAULT NULL::text, target_id text DEFAULT NULL::text, target_label text DEFAULT NULL::text, scene_key text DEFAULT NULL::text, expected_finish_at timestamp with time zone DEFAULT NULL::timestamp with time zone, notes text DEFAULT NULL::text, activity_payload jsonb DEFAULT '{}'::jsonb, public_payload jsonb DEFAULT '{}'::jsonb, public_visible boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  result_row public.active_actions%rowtype;
  normalized_kind text := coalesce(nullif(trim(action_kind), ''), 'idle_standby');
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  if normalized_kind not in (
    'none',
    'idle_standby',
    'roaming_loot',
    'boss_prep',
    'boss_fight',
    'crafting',
    'salvaging',
    'workshop_service',
    'market_listing',
    'endless_run',
    'extraction'
  ) then
    raise exception 'Unsupported active action: %', normalized_kind;
  end if;

  select result_payload into prior
  from public.verified_action_ledger vl
  where vl.user_id = actor and vl.idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  -- Crafting settler hook (0024): the outgoing action settles its
  -- craft jobs before the switch, at their exact accrued values.
  perform public.cc_settle_craft_jobs(actor);

  -- Repair settler hook (0025): board jobs settle on transitions too.
  perform public.cc_settle_repair_jobs_for(actor);

  -- Extraction settler hook (0033): the outgoing action accrues
  -- its extraction time before the switch. Rolls finalize later,
  -- when the passes are settled at a read/claim (cc_apply_extraction
  -- via the Chef) — time accounting is all that happens here.
  perform public.cc_settle_extraction_time(actor);

  -- Extraction start gates + selection sync (0033): an incoming
  -- 'extraction' set claims the site. Every gate reads server
  -- records only (verified account, no standing death record,
  -- a real area, Deep Delve mastery) — client claims
  -- about any of them are never consulted. The standing selection
  -- syncs here so the row the settler reads always names the site
  -- the player chose; the in-progress pass keeps its own terms.
  if normalized_kind = 'extraction' then
    if not public.can_use_player_economy(actor) then
      raise exception 'Verified account required';
    end if;
    if exists (
      select 1 from public.profiles p
      where p.id = actor and coalesce(p.death_state, '{}'::jsonb) <> '{}'::jsonb
    ) then
      raise exception 'Character is dead — resurrect before extracting';
    end if;
    if nullif(target_id, '') is null or not exists (
      select 1 from public.roaming_areas ra where ra.id = target_id
    ) then
      raise exception 'Unknown extraction area';
    end if;
    -- No area level gate (owner ruling 2026-11-02; gate-removal
    -- step 6 retires the leftover unlock_level check the 0033 text
    -- carried through every restatement since): extraction may
    -- start in any real area at any hunter level, exactly like
    -- roaming. roaming_areas.unlock_level survives as area design
    -- data (monster tiers, XP scaling, resurrection pricing) — it
    -- is never read against the player's level here.
    if coalesce(nullif(activity_payload ->> 'method', ''), 'surface') not in ('surface', 'deep') then
      raise exception 'Unsupported extraction method';
    end if;
    if coalesce(nullif(activity_payload ->> 'method', ''), 'surface') = 'deep'
       and public.cc_player_mastery_level(actor, 'gathering.extraction') < 5 then
      raise exception 'Deep Delve requires Extraction mastery 5';
    end if;
    insert into public.extraction_state (user_id, area_id, method, last_settled_at)
    values (actor, target_id, coalesce(nullif(activity_payload ->> 'method', ''), 'surface'), now())
    on conflict (user_id) do update set
      area_id = excluded.area_id,
      method = excluded.method,
      updated_at = now();
  end if;

  insert into public.active_actions as aa (
    user_id,
    active_action,
    started_at,
    completes_at,
    target_type,
    target_id,
    target_label,
    scene_key,
    notes,
    activity_payload,
    public_payload,
    last_heartbeat_at,
    public_visible,
    schema_version,
    updated_at
  ) values (
    actor,
    normalized_kind,
    now(),
    expected_finish_at,
    nullif(target_type, ''),
    nullif(target_id, ''),
    nullif(target_label, ''),
    nullif(scene_key, ''),
    nullif(notes, ''),
    coalesce(activity_payload, '{}'::jsonb),
    coalesce(public_payload, '{}'::jsonb),
    now(),
    coalesce(public_visible, true),
    1,
    now()
  )
  on conflict (user_id) do update set
    active_action = excluded.active_action,
    started_at = excluded.started_at,
    completes_at = excluded.completes_at,
    target_type = excluded.target_type,
    target_id = excluded.target_id,
    target_label = excluded.target_label,
    scene_key = excluded.scene_key,
    notes = excluded.notes,
    activity_payload = excluded.activity_payload,
    public_payload = excluded.public_payload,
    last_heartbeat_at = excluded.last_heartbeat_at,
    public_visible = excluded.public_visible,
    schema_version = excluded.schema_version,
    updated_at = excluded.updated_at
  returning * into result_row;

  prior := jsonb_build_object(
    'action_type', 'cc_set_active_action',
    'activity', public.cc_active_action_snapshot(result_row)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_set_active_action', nonce, prior);

  return prior;
end;
$function$;

-- ─── 6. The level-tier twin has no remaining callers ─────────

drop function if exists public.cc_earned_offline_cap_hours(integer);

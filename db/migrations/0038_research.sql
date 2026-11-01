-- 0038_research.sql
-- Research — the parallel education track (design brief:
-- cybercache-prep/design-briefs/expansion-pack/research-occupation.md;
-- rulings in DECISIONS.md, §12 settled at the recommended defaults).
--
-- WHAT THIS ADDS
--   * research_enrollments — ONE active enrollment per player
--     (user_id is the PK: one enrollment at a time is structural).
--     enrolled_at / completes_at are the whole progress model:
--     progress is PURE WALL-CLOCK (no accrual windows, no away cap,
--     no heartbeat) — the deliberate divergence from crafting.
--   * research_completions — permanent completion facts (0026-style
--     rows). Every research bonus derives from THESE rows, never
--     from a client-supplied list (the #207 adversarial pattern).
--   * cc_research_course(course_id) — the catalog twin of
--     src/content/research.ts RESEARCH_COURSES (the cc_craft_recipe
--     precedent): 4 faculties x 3 tiers, 12 courses, 37 days and
--     310,000 cr across the catalog. TS == SQL parity is pinned by
--     tests that read this file.
--   * cc_settle_research(actor) — lazy settlement: at completes_at
--     the enrollment becomes a completion row, the enrollment row
--     is deleted, and research.scholarship mastery XP is granted
--     once (10 XP per catalog course hour, via cc_add_mastery_xp).
--     Runs at the head of every research read AND every
--     research-bonus derivation. NO cron duty — the heartbeat is
--     unreliable by design here.
--   * cc_enroll_research(nonce, course_id) — settle-first; catalog /
--     level / prerequisite / bench / not-enrolled / not-completed
--     validation; the fee (lever-scaled, snapshotted) is CHARGED
--     AND DESTROYED at enroll; terms snapshot into the enrollment
--     row so later lever moves never move a running course.
--   * cc_cancel_research(nonce) — Torn's rule: deleting the
--     enrollment forfeits progress AND the fee (no refund, ever);
--     re-enrolling restarts from zero at the full price.
--   * R1 — RESEARCH IS A COMMITMENT, NOT AN ACTION. Nothing here
--     touches profiles.active_action, cc_set_active_action, or any
--     action settler: enrollment runs CONCURRENTLY with roaming,
--     crafting, extraction, boss attempts, endless, death, and
--     dispatch. The one recorded exception to ONE ACTION AT A TIME,
--     for education only.
--   * NO PLAYER XP anywhere in this slice (Q2): completion pays
--     mastery XP to the new research.scholarship track only.
--
-- CONSUMER RESTATEMENTS (each restates its latest shipped body with
-- the research term added at the ONE composition point):
--   * cc_craft_recipe_catalog — + the 3 Production Systems batch
--     recipes (requiresResearch gate data).
--   * cc_enqueue_craft_job — the requiresResearch gate, beside
--     requiresMastery.
--   * cc_complete_craft_unit — Shop Fundamentals' shift joins the
--     ONE composed quality clamp; Master Fabricator's temper term
--     joins the temper roll and its +1 draw joins the draw count;
--     consumable units honor a recipe's outputQuantity (batch
--     recipes make 3; every existing recipe is bit-identical).
--   * cc_vendor_sell — Street Economics +0.02 joins the buyback
--     rate under the shared 0.90 ceiling.
--   * cc_accept_listing — Syndicate Ledger +0.05 joins BOTH
--     fee_reduction compositions under the <= 1 clamp (seller's
--     records; origin terms stay disjoint, DECISIONS R5).
--   * cc_repair_finalize_job — Master Mechanic +1 XP per condition
--     point on the provider's own service XP read.
--   * cc_accept_repair_job / cc_enqueue_repair_job — Wrench Basics
--     x1.05 multiplies the work-rate snapshot composition.
--   * cc_settle_craft_jobs / cc_settle_repair_job /
--     cc_settle_extraction_time — Supply Chains +1h joins the
--     earned offline-cap composition at every point it is composed
--     (cc_earned_offline_cap_hours itself stays the pure level
--     table — it is `immutable` and level-keyed by design; the
--     per-player term composes beside it, and the 24 h absolute
--     ceiling in the callers still binds).
--   * cc_compute_economy_metrics — three research meters
--     (research_enrollments_started, research_courses_completed,
--     research_credits_destroyed); the destroyed fees fold into
--     credits_destroyed_total.
--   * mastery_definitions — the research.scholarship track seed.
--
-- LEVERS (registered in src/server/economy/config.ts; read below
-- via cc_economy_config_number with the identical clamps):
--   researchDurationScalar  default 1  clamp [0.5, 2]
--   researchCostScalar      default 1  clamp [0.5, 3]
-- Both apply AT ENROLL ONLY (snapshotted). No lever touches an
-- unlock magnitude — those are content, like skill node values.
--
-- METER DICTIONARY (docs/ECONOMY.md):
--   research_enrollments_started  count of cc_enroll_research rows
--   research_courses_completed    count of cc_research_complete rows
--   research_credits_destroyed    sum of enroll cost_credits
--                                 (folds into credits_destroyed_total)

-- ─── 1. Tables ─────────────────────────────────────────────────────

create table if not exists public.research_enrollments (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  course_id text not null,
  enrolled_at timestamptz not null default now(),
  completes_at timestamptz not null,
  -- Snapshot of the terms as charged: {costCredits, durationMs}.
  -- Lever moves never rewrite a running course.
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.research_completions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id text not null,
  -- The enrollment's completes_at (the fact time), not settle time.
  completed_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (user_id, course_id)
);

create index if not exists research_completions_user_idx
  on public.research_completions (user_id);

-- ─── 2. The scholarship mastery track ──────────────────────────────

insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at)
values ('research.scholarship', 'research', 'Scholarship', 'Coursework completed on the Research education track (10 XP per course hour, granted once at completion).', 'XP', 1, true, true, now(), now())
on conflict (id) do nothing;

-- ─── 3. The course catalog (twin of src/content/research.ts) ──────
-- Key order mirrors the TS objects; optional gates are ABSENT keys
-- (never nulls), exactly like the craft catalog's optional fields.

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
    "requiresLevel": 5,
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
    "requiresLevel": 5,
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
    "requiresLevel": 20,
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
    "requiresLevel": 40,
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
    "requiresLevel": 5,
    "effects": {
      "vendorBuybackBonus": 0.02
    }
  },
  {
    "id": "supply_chains",
    "faculty": "logistics_markets",
    "tier": 2,
    "name": "Supply Chains",
    "durationHours": 48,
    "costCredits": 15000,
    "requiresLevel": 20,
    "prerequisite": "street_economics",
    "effects": {
      "offlineCapBonus": 1
    }
  },
  {
    "id": "syndicate_ledger",
    "faculty": "logistics_markets",
    "tier": 3,
    "name": "Syndicate Ledger",
    "durationHours": 168,
    "costCredits": 60000,
    "requiresLevel": 40,
    "prerequisite": "supply_chains",
    "effects": {
      "marketFeeReduction": 0.05
    }
  },
  {
    "id": "ballistics_theory",
    "faculty": "xenotech",
    "tier": 1,
    "name": "Ballistics Theory",
    "durationHours": 6,
    "costCredits": 2500,
    "requiresLevel": 5,
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
    "requiresLevel": 20,
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
    "requiresLevel": 40,
    "prerequisite": "shield_dynamics",
    "effects": {
      "bossDedicatedChanceBonus": 0.01
    }
  }
]$catalog$::jsonb) as c(course)
   where c.course ->> 'id' = p_course_id
   limit 1;
$func$;

-- Every catalog course (the panel's catalog read goes through the
-- TS content module; this exists for parity checks + admin reads).
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
    "requiresLevel": 5,
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
    "requiresLevel": 5,
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
    "requiresLevel": 20,
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
    "requiresLevel": 40,
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
    "requiresLevel": 5,
    "effects": {
      "vendorBuybackBonus": 0.02
    }
  },
  {
    "id": "supply_chains",
    "faculty": "logistics_markets",
    "tier": 2,
    "name": "Supply Chains",
    "durationHours": 48,
    "costCredits": 15000,
    "requiresLevel": 20,
    "prerequisite": "street_economics",
    "effects": {
      "offlineCapBonus": 1
    }
  },
  {
    "id": "syndicate_ledger",
    "faculty": "logistics_markets",
    "tier": 3,
    "name": "Syndicate Ledger",
    "durationHours": 168,
    "costCredits": 60000,
    "requiresLevel": 40,
    "prerequisite": "supply_chains",
    "effects": {
      "marketFeeReduction": 0.05
    }
  },
  {
    "id": "ballistics_theory",
    "faculty": "xenotech",
    "tier": 1,
    "name": "Ballistics Theory",
    "durationHours": 6,
    "costCredits": 2500,
    "requiresLevel": 5,
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
    "requiresLevel": 20,
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
    "requiresLevel": 40,
    "prerequisite": "shield_dynamics",
    "effects": {
      "bossDedicatedChanceBonus": 0.01
    }
  }
]$catalog$::jsonb;
$func$;

-- ─── 4. Bonus derivation helpers (server records only) ────────────

-- The per-key research bonus total for a player, summed over their
-- research_completions rows against the catalog. Returns 0 when the
-- player holds no relevant completion — the ONLY way a research
-- term enters any engine composition in SQL.
create or replace function public.cc_research_bonus_number(p_player_id uuid, p_key text)
returns numeric
language sql
stable
as $func$
  select coalesce(sum(coalesce(
           (public.cc_research_course(rc.course_id) -> 'effects' ->> p_key)::numeric, 0)), 0)
    from public.research_completions rc
   where rc.user_id = p_player_id;
$func$;

-- Supply Chains' +1 hour, as its own fact so the offline-cap
-- composition points read plainly.
create or replace function public.cc_research_offline_cap_bonus(p_player_id uuid)
returns integer
language sql
stable
as $func$
  select case when exists (
           select 1 from public.research_completions
            where user_id = p_player_id and course_id = 'supply_chains')
         then 1 else 0 end;
$func$;

-- ─── 5. Lazy settlement ────────────────────────────────────────────
-- Idempotent and exactly-once: the enrollment row is deleted in the
-- same transaction that writes the completion row (its PK is the
-- enrollment's existence), the completion insert is conflict-safe,
-- and the mastery grant + ledger row ride along once. A settle at
-- completes_at - 1s completes nothing; at completes_at it completes.

create or replace function public.cc_settle_research(p_player_id uuid)
returns jsonb
language plpgsql
as $func$
declare
  enr public.research_enrollments%rowtype;
  v_xp bigint;
begin
  select * into enr from public.research_enrollments
   where user_id = p_player_id for update;
  if not found or enr.completes_at > now() then
    return jsonb_build_object('completed_now', '[]'::jsonb);
  end if;

  insert into public.research_completions (user_id, course_id, completed_at)
  values (p_player_id, enr.course_id, enr.completes_at)
  on conflict (user_id, course_id) do nothing;
  delete from public.research_enrollments where user_id = p_player_id;

  v_xp := (10 * (public.cc_research_course(enr.course_id) ->> 'durationHours')::numeric)::bigint;
  if v_xp > 0 then
    perform public.cc_add_mastery_xp(p_player_id, 'research.scholarship', v_xp);
  end if;

  insert into public.verified_action_ledger
    (user_id, action_type, idempotency_key, result_payload)
  values (p_player_id, 'cc_research_complete',
          'research-complete:' || p_player_id::text || ':' || enr.course_id,
          jsonb_build_object('course_id', enr.course_id,
                             'completed_at', enr.completes_at,
                             'mastery_xp', v_xp))
  on conflict (user_id, idempotency_key) do nothing;

  return jsonb_build_object('completed_now', jsonb_build_array(
    jsonb_build_object('course_id', enr.course_id,
                       'completed_at', enr.completes_at,
                       'mastery_xp', v_xp)));
end;
$func$;

-- ─── 6. Enroll ─────────────────────────────────────────────────────
-- Settle-first, then validate against the catalog + the player's
-- records. The fee is charged (destroyed) HERE — completion pays
-- nothing and cancel refunds nothing, so the sink lands exactly
-- once, at the decision. Terms snapshot: cost + duration are
-- computed from the levers NOW and stored; a later lever move
-- cannot shorten, lengthen, cheapen, or surcharge a running course.

create or replace function public.cc_enroll_research(p_player_id uuid, p_nonce text, p_course_id text)
returns jsonb
language plpgsql
as $func$
declare
  actor uuid := p_player_id;
  p public.profiles%rowtype;
  v_key text := 'cc_enroll_research:' || coalesce(p_nonce, '');
  prior jsonb;
  course jsonb;
  v_cost bigint;
  v_duration_ms bigint;
  v_now timestamptz := now();
  v_completes timestamptz;
  result jsonb;
begin
  if actor is null then raise exception 'not_authenticated'; end if;
  if p_nonce is null or length(p_nonce) = 0 then
    raise exception 'cc_enroll_research requires a nonce';
  end if;
  select result_payload into prior from public.verified_action_ledger
   where idempotency_key = v_key;
  if prior is not null then
    return prior || jsonb_build_object('idempotent_replay', true);
  end if;

  perform public.cc_settle_research(actor);

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'profile_not_found'; end if;

  course := public.cc_research_course(p_course_id);
  if course is null then raise exception 'unknown_course'; end if;
  if exists (select 1 from public.research_completions
              where user_id = actor and course_id = p_course_id) then
    raise exception 'course_already_completed';
  end if;
  if exists (select 1 from public.research_enrollments where user_id = actor) then
    raise exception 'research_already_enrolled';
  end if;
  if (course ? 'requiresLevel')
     and p.player_level < (course ->> 'requiresLevel')::int then
    raise exception 'level_too_low';
  end if;
  if (course ? 'prerequisite')
     and not exists (select 1 from public.research_completions
                      where user_id = actor
                        and course_id = course ->> 'prerequisite') then
    raise exception 'prerequisite_not_met';
  end if;
  if (course ? 'requiresBench')
     and coalesce(p.workshop_benches, 1) < (course ->> 'requiresBench')::int then
    raise exception 'bench_too_low';
  end if;

  v_cost := floor((course ->> 'costCredits')::numeric
    * least(3::numeric, greatest(0.5::numeric,
        public.cc_economy_config_number('researchCostScalar', 1))))::bigint;
  v_duration_ms := round((course ->> 'durationHours')::numeric * 3600000
    * least(2::numeric, greatest(0.5::numeric,
        public.cc_economy_config_number('researchDurationScalar', 1))))::bigint;
  if p.credits < v_cost then raise exception 'insufficient_credits'; end if;

  update public.profiles set credits = credits - v_cost
   where id = actor returning * into p;
  v_completes := v_now + (v_duration_ms::text || ' milliseconds')::interval;
  insert into public.research_enrollments
    (user_id, course_id, enrolled_at, completes_at, snapshot)
  values (actor, p_course_id, v_now, v_completes,
          jsonb_build_object('costCredits', v_cost, 'durationMs', v_duration_ms));

  result := jsonb_build_object(
    'course_id', p_course_id,
    'cost_credits', v_cost,
    'duration_ms', v_duration_ms,
    'enrolled_at', v_now,
    'completes_at', v_completes,
    'profile', public.cc_profile_snapshot(p));
  insert into public.verified_action_ledger
    (user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_enroll_research', v_key, result);
  return result;
end;
$func$;

-- ─── 7. Cancel (Torn's rule: progress lost, fee kept) ─────────────

create or replace function public.cc_cancel_research(p_player_id uuid, p_nonce text)
returns jsonb
language plpgsql
as $func$
declare
  actor uuid := p_player_id;
  v_key text := 'cc_cancel_research:' || coalesce(p_nonce, '');
  prior jsonb;
  enr public.research_enrollments%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'not_authenticated'; end if;
  if p_nonce is null or length(p_nonce) = 0 then
    raise exception 'cc_cancel_research requires a nonce';
  end if;
  select result_payload into prior from public.verified_action_ledger
   where idempotency_key = v_key;
  if prior is not null then
    return prior || jsonb_build_object('idempotent_replay', true);
  end if;

  -- Settle first: a course past its completes_at is a completion,
  -- not a cancellation.
  perform public.cc_settle_research(actor);

  select * into enr from public.research_enrollments
   where user_id = actor for update;
  if not found then
    result := jsonb_build_object('cancelled', false);
  else
    delete from public.research_enrollments where user_id = actor;
    result := jsonb_build_object(
      'cancelled', true,
      'course_id', enr.course_id,
      'fee_forfeited', (enr.snapshot ->> 'costCredits')::bigint);
  end if;
  insert into public.verified_action_ledger
    (user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_cancel_research', v_key, result);
  return result;
end;
$func$;


-- ─── 8. cc_craft_recipe_catalog (0024 body + batch recipes) ─────
-- The three Production Systems batch recipes join the ONE
-- catalog literal. Bit-identical for the shipped 49.

create or replace function public.cc_craft_recipe_catalog()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select $catalog$
[
  {
    "id": "recipe_medkit",
    "kind": "consumable",
    "name": "Med Kit",
    "category": "survival",
    "inputs": {
      "ScrapAlloy": 15,
      "ReactiveComponents": 8
    },
    "unitDurationMs": 720000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "MedKit"
  },
  {
    "id": "recipe_medkit_refined",
    "kind": "consumable",
    "name": "Med Kit (Refined)",
    "category": "survival",
    "inputs": {
      "ScrapAlloy": 25,
      "ReactiveComponents": 15,
      "VoidDust": 1
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 10,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "MedKitRefined"
  },
  {
    "id": "recipe_shieldcell",
    "kind": "consumable",
    "name": "Shield Cell",
    "category": "survival",
    "inputs": {
      "ScrapAlloy": 20,
      "ReactiveComponents": 12
    },
    "unitDurationMs": 900000,
    "requiresLevel": 3,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "ShieldCell"
  },
  {
    "id": "recipe_nanoswarm",
    "kind": "consumable",
    "name": "Nano-Swarm",
    "category": "survival",
    "inputs": {
      "ScrapAlloy": 30,
      "ReactiveComponents": 20,
      "VoidDust": 2
    },
    "unitDurationMs": 2400000,
    "requiresLevel": 15,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "NanoSwarm"
  },
  {
    "id": "recipe_adrenaline",
    "kind": "consumable",
    "name": "Adrenaline Shot",
    "category": "survival",
    "inputs": {
      "ScrapAlloy": 40,
      "ReactiveComponents": 25,
      "VoidDust": 3
    },
    "unitDurationMs": 3600000,
    "requiresLevel": 20,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "AdrenalineShot"
  },
  {
    "id": "recipe_ammo_pack",
    "kind": "consumable",
    "name": "Ammo Pack",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 10,
      "BallisticParts": 6
    },
    "unitDurationMs": 600000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "AmmoPack"
  },
  {
    "id": "recipe_high_capacity_ammo_pack",
    "kind": "consumable",
    "name": "High-Capacity Ammo Pack",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 18,
      "BallisticParts": 12,
      "TechFragments": 2
    },
    "unitDurationMs": 1080000,
    "requiresLevel": 6,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "HighCapacityAmmoPack"
  },
  {
    "id": "recipe_ap_ammo",
    "kind": "consumable",
    "name": "Armor-Piercing Ammo",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 15,
      "BallisticParts": 10
    },
    "unitDurationMs": 900000,
    "requiresLevel": 5,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "ArmorPiercingAmmo"
  },
  {
    "id": "recipe_fire_ammo",
    "kind": "consumable",
    "name": "Incendiary Ammo",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 15,
      "BallisticParts": 8,
      "IgnitionFluid": 3
    },
    "unitDurationMs": 1080000,
    "requiresLevel": 8,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "IncendiaryAmmo"
  },
  {
    "id": "recipe_shock_ammo",
    "kind": "consumable",
    "name": "Shock Ammo",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 15,
      "BallisticParts": 8,
      "ConduitWire": 3
    },
    "unitDurationMs": 1080000,
    "requiresLevel": 8,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "ShockAmmo"
  },
  {
    "id": "recipe_corrosive_ammo",
    "kind": "consumable",
    "name": "Corrosive Ammo",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 15,
      "BallisticParts": 8,
      "AcidCompound": 3
    },
    "unitDurationMs": 1080000,
    "requiresLevel": 8,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "CorrosiveAmmo"
  },
  {
    "id": "recipe_cryo_ammo",
    "kind": "consumable",
    "name": "Cryo Ammo",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 15,
      "BallisticParts": 8,
      "CryoGel": 3
    },
    "unitDurationMs": 1080000,
    "requiresLevel": 8,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "CryoAmmo"
  },
  {
    "id": "recipe_void_ammo",
    "kind": "consumable",
    "name": "Void Ammo",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 20,
      "BallisticParts": 10,
      "VoidEssence": 5
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 15,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "VoidAmmo"
  },
  {
    "id": "recipe_ordnance",
    "kind": "consumable",
    "name": "Ordnance Charge",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 12,
      "BallisticParts": 10
    },
    "unitDurationMs": 720000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "OrdnanceCharge"
  },
  {
    "id": "recipe_emp_charge",
    "kind": "consumable",
    "name": "EMP Charge",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 18,
      "BallisticParts": 8,
      "ConduitWire": 4,
      "TechFragments": 2
    },
    "unitDurationMs": 1320000,
    "requiresLevel": 9,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "EMPCharge"
  },
  {
    "id": "recipe_corrosive_charge",
    "kind": "consumable",
    "name": "Corrosive Charge",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 18,
      "BallisticParts": 8,
      "AcidCompound": 4,
      "TechFragments": 2
    },
    "unitDurationMs": 1320000,
    "requiresLevel": 9,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "CorrosiveCharge"
  },
  {
    "id": "recipe_overcharge",
    "kind": "consumable",
    "name": "Overcharge Stim",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 25,
      "BallisticParts": 15,
      "VoidDust": 2
    },
    "unitDurationMs": 1800000,
    "requiresLevel": 12,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "OverchargeStim"
  },
  {
    "id": "recipe_targetpainter",
    "kind": "consumable",
    "name": "Target Painter",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 20,
      "BallisticParts": 10,
      "TechFragments": 2
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 8,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "TargetPainter"
  },
  {
    "id": "recipe_phaseshift",
    "kind": "consumable",
    "name": "Phase Shift Grenade",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 30,
      "BallisticParts": 15,
      "VoidDust": 5
    },
    "unitDurationMs": 2100000,
    "requiresLevel": 18,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "PhaseShiftGrenade"
  },
  {
    "id": "recipe_luck",
    "kind": "consumable",
    "name": "Luck Booster",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 15,
      "TechFragments": 8
    },
    "unitDurationMs": 900000,
    "requiresLevel": 5,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "LuckBooster"
  },
  {
    "id": "recipe_scanner",
    "kind": "consumable",
    "name": "Boss Scanner",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 20,
      "TechFragments": 12
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 10,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "BossScanner"
  },
  {
    "id": "recipe_insurance",
    "kind": "consumable",
    "name": "Insurance Token",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 30,
      "TechFragments": 15,
      "VoidDust": 2
    },
    "unitDurationMs": 2100000,
    "requiresLevel": 15,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "InsuranceToken"
  },
  {
    "id": "recipe_dataskimmer",
    "kind": "consumable",
    "name": "Data Skimmer",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 25,
      "TechFragments": 15,
      "VoidDust": 3
    },
    "unitDurationMs": 2400000,
    "requiresLevel": 18,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "DataSkimmer"
  },
  {
    "id": "recipe_jammer",
    "kind": "consumable",
    "name": "Jammer",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 20,
      "TechFragments": 10,
      "ConduitWire": 2
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 12,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "Jammer"
  },
  {
    "id": "recipe_magnetized",
    "kind": "consumable",
    "name": "Magnetized Payload",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 15,
      "BallisticParts": 10,
      "TechFragments": 5
    },
    "unitDurationMs": 1320000,
    "requiresLevel": 10,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "MagnetizedPayload"
  },
  {
    "id": "recipe_signal_scrambler",
    "kind": "consumable",
    "name": "Signal Scrambler",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 15,
      "TechFragments": 10,
      "ConduitWire": 2
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 7,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "SignalScrambler"
  },
  {
    "id": "recipe_loot_beacon",
    "kind": "consumable",
    "name": "Loot Beacon",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 20,
      "TechFragments": 14,
      "VoidDust": 2
    },
    "unitDurationMs": 1800000,
    "requiresLevel": 12,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "LootBeacon"
  },
  {
    "id": "recipe_salvage_contract",
    "kind": "consumable",
    "name": "Salvage Contract",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 12,
      "TechFragments": 8
    },
    "unitDurationMs": 960000,
    "requiresLevel": 5,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "SalvageContract"
  },
  {
    "id": "recipe_workshop_rush_ticket",
    "kind": "consumable",
    "name": "Workshop Rush Ticket",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 18,
      "TechFragments": 12,
      "VoidDust": 1
    },
    "unitDurationMs": 1440000,
    "requiresLevel": 10,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "WorkshopRushTicket"
  },
  {
    "id": "recipe_patch_kit",
    "kind": "consumable",
    "name": "Patch Kit",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 4,
      "ReactiveComponents": 1
    },
    "unitDurationMs": 720000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "PatchKit"
  },
  {
    "id": "recipe_field_patch_kit",
    "kind": "consumable",
    "name": "Field Patch Kit",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 6,
      "ReactiveComponents": 3,
      "TechFragments": 1,
      "HeartwoodResin": 1
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 12,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "FieldPatchKit"
  },
  {
    "id": "recipe_master_patch_kit",
    "kind": "consumable",
    "name": "Master Patch Kit",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 8,
      "ReactiveComponents": 5,
      "TechFragments": 3,
      "VoidDust": 1
    },
    "unitDurationMs": 2700000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "requiresMastery": {
      "track": "crafting_consumables",
      "level": 15
    },
    "consumableType": "MasterPatchKit"
  },
  {
    "id": "recipe_fuel_cell",
    "kind": "consumable",
    "name": "Fuel Cell",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 6,
      "NitrocellGel": 1
    },
    "unitDurationMs": 900000,
    "requiresLevel": 8,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "FuelCell"
  },
  {
    "id": "refine_refined_alloy",
    "kind": "refine",
    "name": "Refined Alloy",
    "category": "refining",
    "inputs": {
      "ScrapAlloy": 10
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "crusher",
    "outputMaterial": "RefinedAlloy",
    "outputBase": 8
  },
  {
    "id": "refine_tempered_parts",
    "kind": "refine",
    "name": "Tempered Parts",
    "category": "refining",
    "inputs": {
      "BallisticParts": 10
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "crusher",
    "outputMaterial": "TemperedParts",
    "outputBase": 8
  },
  {
    "id": "refine_stabilized_cells",
    "kind": "refine",
    "name": "Stabilized Cells",
    "category": "refining",
    "inputs": {
      "ReactiveComponents": 10
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "crusher",
    "outputMaterial": "StabilizedCells",
    "outputBase": 8
  },
  {
    "id": "refine_woven_circuits",
    "kind": "refine",
    "name": "Woven Circuits",
    "category": "refining",
    "inputs": {
      "TechFragments": 10
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "crusher",
    "outputMaterial": "WovenCircuits",
    "outputBase": 8
  },
  {
    "id": "refine_condensed_void",
    "kind": "refine",
    "name": "Condensed Void",
    "category": "refining",
    "inputs": {
      "VoidDust": 10
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "crusher",
    "outputMaterial": "CondensedVoid",
    "outputBase": 8
  },
  {
    "id": "refine_composite_plating",
    "kind": "refine",
    "name": "Composite Plating",
    "category": "refining",
    "inputs": {
      "RefinedAlloy": 4,
      "StabilizedCells": 2
    },
    "unitDurationMs": 2700000,
    "requiresLevel": 1,
    "requiresBench": 3,
    "station": "furnace",
    "outputMaterial": "CompositePlating",
    "outputBase": 2
  },
  {
    "id": "refine_circuit_lattice",
    "kind": "refine",
    "name": "Circuit Lattice",
    "category": "refining",
    "inputs": {
      "WovenCircuits": 4,
      "TemperedParts": 2
    },
    "unitDurationMs": 2700000,
    "requiresLevel": 1,
    "requiresBench": 3,
    "station": "furnace",
    "outputMaterial": "CircuitLattice",
    "outputBase": 2
  },
  {
    "id": "refine_voidweave",
    "kind": "refine",
    "name": "Voidweave",
    "category": "refining",
    "inputs": {
      "CondensedVoid": 2,
      "WovenCircuits": 2
    },
    "unitDurationMs": 2700000,
    "requiresLevel": 1,
    "requiresBench": 3,
    "station": "furnace",
    "outputMaterial": "Voidweave",
    "outputBase": 2
  },
  {
    "id": "frame_weapon",
    "kind": "gear",
    "name": "Weapon Frame",
    "category": "gear",
    "inputs": {
      "RefinedAlloy": 6,
      "TemperedParts": 4,
      "ForgeheartIngots": 2
    },
    "unitDurationMs": 0,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "gearSlot": "weapon",
    "durationByRarityMs": {
      "Common": 5400000,
      "Uncommon": 5400000,
      "Rare": 9000000,
      "Epic": 14400000
    }
  },
  {
    "id": "frame_shield",
    "kind": "gear",
    "name": "Shield Frame",
    "category": "gear",
    "inputs": {
      "StabilizedCells": 6,
      "RefinedAlloy": 4,
      "HeartwoodResin": 2
    },
    "unitDurationMs": 0,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "gearSlot": "shield",
    "durationByRarityMs": {
      "Common": 5400000,
      "Uncommon": 5400000,
      "Rare": 9000000,
      "Epic": 14400000
    }
  },
  {
    "id": "frame_class_mod",
    "kind": "gear",
    "name": "Class Mod Frame",
    "category": "gear",
    "inputs": {
      "WovenCircuits": 5,
      "CircuitLattice": 2,
      "PrismShards": 2
    },
    "unitDurationMs": 0,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "gearSlot": "classMod",
    "durationByRarityMs": {
      "Common": 5400000,
      "Uncommon": 5400000,
      "Rare": 9000000,
      "Epic": 14400000
    }
  },
  {
    "id": "frame_relic",
    "kind": "gear",
    "name": "Relic Frame",
    "category": "gear",
    "inputs": {
      "CondensedVoid": 4,
      "Voidweave": 2,
      "MycoSteelFiber": 2
    },
    "unitDurationMs": 0,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "gearSlot": "relic",
    "durationByRarityMs": {
      "Common": 5400000,
      "Uncommon": 5400000,
      "Rare": 9000000,
      "Epic": 14400000
    }
  },
  {
    "id": "frame_ordnance",
    "kind": "gear",
    "name": "Ordnance Frame",
    "category": "gear",
    "inputs": {
      "TemperedParts": 6,
      "StabilizedCells": 3,
      "ForgeheartIngots": 2
    },
    "unitDurationMs": 0,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "gearSlot": "ordnance",
    "durationByRarityMs": {
      "Common": 5400000,
      "Uncommon": 5400000,
      "Rare": 9000000,
      "Epic": 14400000
    }
  },
  {
    "id": "tool_precision_calipers",
    "kind": "tool",
    "name": "Precision Calipers",
    "category": "tools",
    "inputs": {
      "CircuitLattice": 2,
      "PrismShards": 2
    },
    "unitDurationMs": 3600000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "toolId": "tool_precision_calipers"
  },
  {
    "id": "tool_servo_bench_rig",
    "kind": "tool",
    "name": "Servo Bench Rig",
    "category": "tools",
    "inputs": {
      "CompositePlating": 2,
      "MagnetiteCores": 2
    },
    "unitDurationMs": 3600000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "toolId": "tool_servo_bench_rig"
  },
  {
    "id": "tool_reclaimer_head",
    "kind": "tool",
    "name": "Reclaimer Head",
    "category": "tools",
    "inputs": {
      "CompositePlating": 1,
      "CircuitLattice": 1,
      "Voidweave": 1
    },
    "unitDurationMs": 3600000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "toolId": "tool_reclaimer_head"
  },
  {
    "id": "recipe_shield_cell_batch",
    "kind": "consumable",
    "name": "Shield Cell ×3 (Batch)",
    "category": "survival",
    "inputs": {
      "ScrapAlloy": 50,
      "ReactiveComponents": 30
    },
    "unitDurationMs": 1980000,
    "requiresLevel": 3,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "ShieldCell",
    "requiresResearch": "production_systems",
    "outputQuantity": 3
  },
  {
    "id": "recipe_patch_kit_batch",
    "kind": "consumable",
    "name": "Patch Kit ×3 (Batch)",
    "category": "utility",
    "inputs": {
      "ScrapAlloy": 10,
      "ReactiveComponents": 3
    },
    "unitDurationMs": 1584000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "PatchKit",
    "requiresResearch": "production_systems",
    "outputQuantity": 3
  },
  {
    "id": "recipe_ordnance_batch",
    "kind": "consumable",
    "name": "Ordnance Charge ×3 (Batch)",
    "category": "offense",
    "inputs": {
      "ScrapAlloy": 30,
      "BallisticParts": 25
    },
    "unitDurationMs": 1584000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "OrdnanceCharge",
    "requiresResearch": "production_systems",
    "outputQuantity": 3
  }
]
$catalog$::jsonb
$$;

-- ─── 9. cc_enqueue_craft_job (0029 body + research gate) ───────

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
  -- Guest gate (§2.1): enqueueing is a verified-account action, the
  -- player-market lock treatment; vendor staples stay the guest path.
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

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

  -- Fitted tool snapshot for this bench.
  v_tools := coalesce(p.workshop_tools, '{}'::jsonb);
  v_fitted := v_tools -> 'fitted' ->> v_bench::text;
  if v_fitted is not null
     and coalesce((v_tools -> 'charges' ->> v_fitted)::integer, 0) <= 0 then
    v_fitted := null;
  end if;
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

-- ─── 10. cc_complete_craft_unit (0031 body + research terms) ───
-- Quality shift joins the ONE composed clamp; Master
-- Fabricator joins the temper roll + draw count; batch
-- recipes produce outputQuantity units per unit.

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
  v_bounds jsonb;
  v_roll numeric;
  v_qty integer;
  v_bonus boolean;
  -- refine completion
  v_yield numeric;
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
      v_count := floor((recipe ->> 'outputBase')::numeric * v_yield / p_refine_base)::integer;
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
  elsif job.kind = 'tool' then
    -- All three fitted tools carry 25 jobs of durability (§2.5e).
    update public.profiles
       set workshop_tools = jsonb_set(
             jsonb_set(coalesce(workshop_tools, '{}'::jsonb),
               array['owned', recipe ->> 'toolId'], 'true'::jsonb, true),
             array['charges', recipe ->> 'toolId'], '25'::jsonb, true),
           updated_at = now()
     where id = actor;
    v_output := v_output || jsonb_build_object('toolId', recipe ->> 'toolId');
  end if;

  -- Mastery + player XP land after the output is priced.
  if job.kind = 'refine' then
    v_mastery_track := 'crafting.refining'; v_mastery_xp := 10;
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

-- ─── 11. cc_vendor_sell (0029 body + Street Economics) ─────────

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

-- ─── 12. cc_accept_listing (0031 body + Syndicate Ledger) ──────
-- The research fee term is origin-independent (it is the
-- seller's credential, not the item's provenance), so it
-- composes additively in both branches under the <= 1
-- clamp; the Darknet / Manipulator / House Brand origin
-- terms stay disjoint per DECISIONS R5.

CREATE OR REPLACE FUNCTION public.cc_accept_listing(p_player_id uuid, nonce text, listing_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  listing public.market_listings%rowtype;
  item public.item_instances%rowtype;
  seller public.profiles%rowtype;
  mod_payload jsonb;
  darknet_pts numeric := 0;
  manip_pts numeric := 0;
  house_pts numeric := 0;
  crafted_item boolean := false;
  fee_reduction numeric := 0;
  fee_credits bigint := 0;
  proceeds_bonus bigint := 0;
  fee_rate numeric := 0.05;
  found_item boolean := false;
  delivered_batch_id uuid;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  select * into listing from public.market_listings where id = listing_id for update;
  if not found or listing.status <> 'active' then raise exception 'Active listing not found'; end if;
  if listing.seller_user_id = actor then raise exception 'Cannot accept own listing'; end if;
  if p.credits < listing.price_credits then raise exception 'Insufficient credits'; end if;

  select * into seller from public.profiles where id = listing.seller_user_id;

  if listing.listing_kind in ('gear', 'vehicle') then
    -- Market fee (0017; rate levered in 0018): derived from the
    -- seller's OWN database records inside this transaction. NPC
    -- listings (supply_mode 'npc_market') are exempt.
    select * into item from public.item_instances where id = listing.item_instance_id;
    if seller.id is not null and item.id is not null and coalesce(item.supply_mode, '') <> 'npc_market' then
      fee_rate := least(1::numeric, greatest(0::numeric,
        public.cc_economy_config_number('marketFeeRate', 0.05)));
      select payload into mod_payload from public.item_instances
       where owner_user_id = seller.id and runtime_state = 'equipped' and payload ? 'treeBonus'
       limit 1;
      darknet_pts := coalesce((seller.skill_spends ->> 'scav_fee_1')::numeric, 0)
                   + coalesce((mod_payload -> 'nodeBoosts' ->> 'scav_fee_1')::numeric, 0);
      manip_pts := coalesce((seller.skill_spends ->> 'scav_major_3')::numeric, 0)
                 + coalesce((mod_payload -> 'nodeBoosts' ->> 'scav_major_3')::numeric, 0);
      if mod_payload ->> 'treeBonus' = 'Scavenger' then
        darknet_pts := least(5::numeric, darknet_pts + 1);
        manip_pts := least(1::numeric, manip_pts + 1);
      end if;
      found_item := coalesce(item.payload ->> 'sourceTag', '') in ('World Drop', 'Boss Drop', 'Cache-Forged', 'Event')
        and not exists (
          select 1 from public.verified_action_ledger l
           where l.user_id = seller.id
             and l.action_type = 'cc_accept_listing'
             and l.result_payload -> 'item' ->> 'id' = item.id::text
        );
      -- House Brand (fix_major_3, 0029): the crafted gate is the
      -- economy metrics' crafted-sale rule — payload origin 'crafted'.
      -- Found and crafted are disjoint by the drop-source taxonomy,
      -- so this term never stacks with the Manipulator term.
      house_pts := public.cc_skill_effective_points(
        seller.skill_spends, mod_payload, 'fix_major_3', 'Fixer', 1);
      crafted_item := coalesce(item.payload ->> 'origin', '') = 'crafted';
      fee_reduction := least(1::numeric, greatest(0::numeric,
        0.05 * darknet_pts + case when found_item then 0.15 * manip_pts else 0 end
        + case when crafted_item then 0.15 * house_pts else 0 end
        + public.cc_research_bonus_number(seller.id, 'marketFeeReduction')));
      fee_credits := floor(listing.price_credits * fee_rate * (1 - fee_reduction))::bigint;
    end if;
  else
    -- Consumable / material sale: same fee, Darknet Broker reduction
    -- only — stacks carry no find provenance, so the Market
    -- Manipulator term never applies. Player listings only (these
    -- kinds have no NPC source; seller_type pins it regardless).
    if seller.id is not null and coalesce(listing.seller_type, 'player') <> 'npc' then
      fee_rate := least(1::numeric, greatest(0::numeric,
        public.cc_economy_config_number('marketFeeRate', 0.05)));
      select payload into mod_payload from public.item_instances
       where owner_user_id = seller.id and runtime_state = 'equipped' and payload ? 'treeBonus'
       limit 1;
      darknet_pts := coalesce((seller.skill_spends ->> 'scav_fee_1')::numeric, 0)
                   + coalesce((mod_payload -> 'nodeBoosts' ->> 'scav_fee_1')::numeric, 0);
      if mod_payload ->> 'treeBonus' = 'Scavenger' then
        darknet_pts := least(5::numeric, darknet_pts + 1);
      end if;
      -- House Brand (fix_major_3, 0029) applies to crafted consumable
      -- batches: batch_origin 'crafted' is the metrics crafted-sale
      -- rule. Materials carry no origin and are never crafted.
      house_pts := public.cc_skill_effective_points(
        seller.skill_spends, mod_payload, 'fix_major_3', 'Fixer', 1);
      crafted_item := coalesce(listing.batch_origin, '') = 'crafted';
      fee_reduction := least(1::numeric, greatest(0::numeric,
        0.05 * darknet_pts + case when crafted_item then 0.15 * house_pts else 0 end
        + public.cc_research_bonus_number(seller.id, 'marketFeeReduction')));
      fee_credits := floor(listing.price_credits * fee_rate * (1 - fee_reduction))::bigint;
    end if;
  end if;

  -- Cache Rank Silver Tongue (0031): the proceeds uplift applies
  -- AFTER the fee, on the post-fee proceeds, and only where a fee
  -- branch ran (real player seller; NPC listings exempt). The
  -- uplift is MINTED to the seller and metered as such
  -- (market_fee.cache_rank_proceeds_bonus folds into
  -- credits_minted_other in cc_compute_economy_metrics).
  -- Composition order: fee rate (lever) x (1 - Darknet/Manipulator/
  -- House Brand reductions) first, then the uplift.
  if (listing.listing_kind in ('gear', 'vehicle') and seller.id is not null
        and item.id is not null and coalesce(item.supply_mode, '') <> 'npc_market')
     or (listing.listing_kind not in ('gear', 'vehicle') and seller.id is not null
        and coalesce(listing.seller_type, 'player') <> 'npc') then
    proceeds_bonus := floor((listing.price_credits - fee_credits)
      * public.cc_cache_rank_bonus_fraction(seller.cache_rank_spends, 'marketProceeds'))::bigint;
  end if;

  update public.profiles set credits = credits - listing.price_credits where id = actor returning * into p;
  update public.profiles set credits = credits + (listing.price_credits - fee_credits + proceeds_bonus) where id = listing.seller_user_id;
  update public.market_listings set status = 'sold', sold_at = now() where id = listing.id returning * into listing;

  if listing.listing_kind in ('gear', 'vehicle') then
    update public.item_instances set owner_user_id = actor, runtime_state = 'available', is_locked = false, equipped_slot = null where id = listing.item_instance_id returning * into item;
  elsif listing.listing_kind = 'consumable' then
    delivered_batch_id := public.cc_add_consumable_batch(
      actor,
      listing.consumable_type,
      listing.quantity,
      listing.quality_percent,
      coalesce(listing.batch_origin, 'market'),
      listing.batch_creator_user_id,
      listing.batch_source_recipe_id,
      'market_buy',
      'Player market purchase',
      jsonb_build_object('listing_id', listing.id, 'seller_user_id', listing.seller_user_id)
    );
    update public.profiles
       set consumables = public.cc_jsonb_add_int(consumables, listing.consumable_type, listing.quantity)
     where id = actor;
  elsif listing.listing_kind = 'material' then
    update public.profiles
       set materials = public.cc_jsonb_add_int(materials, listing.material_id, listing.quantity)
     where id = actor;
  end if;

  -- Re-read the buyer so the result snapshot carries the delivery.
  select * into p from public.profiles where id = actor;

  result := jsonb_build_object('action_type', 'cc_accept_listing', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', to_jsonb(item), 'delivery', jsonb_build_object('kind', listing.listing_kind, 'quantity', listing.quantity, 'quality_percent', listing.quality_percent, 'consumable_type', listing.consumable_type, 'material_id', listing.material_id, 'batch_id', delivered_batch_id), 'market_fee', jsonb_build_object('fee_credits', fee_credits, 'seller_proceeds', listing.price_credits - fee_credits + proceeds_bonus, 'cache_rank_proceeds_bonus', proceeds_bonus, 'fee_rate', fee_rate, 'fee_reduction', fee_reduction, 'found_item', found_item, 'crafted_item', crafted_item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_accept_listing', nonce, result);
  return result;
end;
$function$;


-- ─── 13. cc_repair_finalize_job (0031 body + Master Mechanic) ──
-- The certification's +1/point adds AFTER the lever
-- clamp: it is a credential, not a tuning value.

create or replace function public.cc_repair_finalize_job(p_job_id uuid, p_outcome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.service_jobs%rowtype;
  provider public.profiles%rowtype;
  v_price bigint;
  v_restored numeric;
  v_target integer;
  v_payout bigint := 0;
  v_fee_rate numeric := least(1, greatest(0,
    public.cc_economy_config_number('marketFeeRate', 0.05)));
  v_xp_per_point numeric := least(10, greatest(0,
    public.cc_economy_config_number('serviceXpPerPoint', 2)))
    + public.cc_research_bonus_number(p.provider_user_id, 'repairServiceXpBonus');
  mod_payload jsonb;
  darknet_pts numeric := 0;
  v_fee_reduction numeric := 0;
  v_fee bigint := 0;
  v_xp bigint := 0;
  v_next jsonb;
begin
  select * into job from public.service_jobs where id = p_job_id for update;
  if not found then raise exception 'Repair job not found'; end if;
  if job.status in ('completed', 'cancelled') then
    return jsonb_build_object('job_id', job.id, 'outcome', job.outcome,
      'already_terminal', true);
  end if;

  v_price := coalesce(job.quoted_price_credits, 0);
  v_restored := coalesce(job.points_restored, 0);
  v_target := coalesce(job.target_points, 0);
  -- Price is per-point under the hood: full completion pays in
  -- full; anything else pays floor(price x restored / target).
  if p_outcome = 'completed' then
    v_payout := v_price;
  elsif v_target > 0 and v_restored > 0 then
    v_payout := floor(v_price * v_restored / v_target)::bigint;
  end if;

  if job.provider_user_id is not null then
    select * into provider from public.profiles where id = job.provider_user_id for update;
    if found and v_payout > 0 then
      -- The ONE player-to-player fee rule: the shared market fee,
      -- with the mechanic's Darknet Broker derivation mirrored from
      -- cc_accept_listing (0017) — skill_spends + equipped class mod.
      select payload into mod_payload from public.item_instances
       where owner_user_id = provider.id and runtime_state = 'equipped'
         and payload ? 'treeBonus'
       limit 1;
      darknet_pts := coalesce((provider.skill_spends ->> 'scav_fee_1')::numeric, 0)
                   + coalesce((mod_payload -> 'nodeBoosts' ->> 'scav_fee_1')::numeric, 0);
      if mod_payload ->> 'treeBonus' = 'Scavenger' then
        darknet_pts := least(5::numeric, darknet_pts + 1);
      end if;
      v_fee_reduction := least(1::numeric, greatest(0::numeric, 0.05 * darknet_pts));
      v_fee := floor(v_payout * v_fee_rate * (1 - v_fee_reduction))::bigint;
      update public.profiles
         set credits = credits + (v_payout - v_fee), updated_at = now()
       where id = provider.id;
    end if;
    if found and v_restored > 0 then
      v_xp := round(v_xp_per_point * v_restored)::bigint;
      -- Cache Rank Fast Learner (0031): repair XP carries the same
      -- XP bonus as every other source.
      v_xp := round(v_xp * (1 + public.cc_cache_rank_bonus_fraction(provider.cache_rank_spends, 'xp')))::bigint;
      if v_xp > 0 then
        v_next := public.cc_apply_xp(provider.player_level, provider.player_xp, v_xp);
        update public.profiles
           set player_level = (v_next ->> 'player_level')::integer,
               player_xp = (v_next ->> 'player_xp')::bigint,
               updated_at = now()
         where id = provider.id;
      end if;
      perform public.cc_add_mastery_xp(provider.id, 'services.repair', ceil(v_restored)::integer);
      if p_outcome = 'completed' then
        perform public.cc_add_stat(provider.id, 'services.completed', 1);
      end if;
      -- 0030: Overclock charge accrual — board repair points charge
      -- a Fixer-selected mechanic's pool (per-point lever rate).
      if coalesce(provider.action_skill_selection, '') = 'Fixer' then
        select payload into mod_payload from public.item_instances
         where owner_user_id = provider.id and runtime_state = 'equipped'
           and payload ? 'treeBonus'
         limit 1;
        if public.cc_action_skill_qualified(provider.skill_spends, mod_payload, 'Fixer') then
          update public.profiles
             set action_skill_charge = least(100, action_skill_charge
               + least(2, greatest(0, public.cc_economy_config_number('actionSkillChargePerRepairPoint', 0.2))) * v_restored),
                 updated_at = now()
           where id = provider.id;
        end if;
      end if;
    end if;
    -- Abandonment is a conduct record, not work: it lands even when
    -- zero points were restored (the usual case).
    if found and p_outcome = 'abandoned' then
      perform public.cc_add_stat(provider.id, 'services.abandoned', 1);
    end if;
  end if;

  -- The unspent escrow returns to the owner; the fee is destroyed
  -- (credited to nobody), exactly like a market fee.
  if v_price - v_payout > 0 then
    update public.profiles
       set credits = credits + (v_price - v_payout), updated_at = now()
     where id = job.owner_user_id;
  end if;
  if job.escrow_id is not null then
    update public.escrow_records
       set status = case when v_payout > 0 then 'released' else 'refunded' end,
           released_at = now()
     where id = job.escrow_id;
  end if;
  -- The vehicle is never hostage: every terminal state releases it.
  update public.item_instances
     set runtime_state = 'available', is_locked = false, updated_at = now()
   where id = job.target_item_instance_id;
  update public.service_jobs
     set status = case when p_outcome in ('completed', 'delivered_partial')
                     then 'completed' else 'cancelled' end,
         outcome = p_outcome,
         paid_credits = v_payout,
         fee_credits = v_fee,
         xp_awarded = v_xp,
         completed_at = now()
   where id = job.id;

  return jsonb_build_object('job_id', job.id, 'outcome', p_outcome,
    'paid_credits', v_payout, 'fee_credits', v_fee, 'xp_awarded', v_xp,
    'points_restored', v_restored);
end;$$;

-- ─── 14. cc_accept_repair_job (0029 body + Wrench Basics) ──────

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

-- ─── 15. cc_enqueue_repair_job (0029 body + Wrench Basics) ─────

create or replace function public.cc_enqueue_repair_job(
  p_player_id uuid, nonce text, item_id uuid, p_kit_type text, p_units integer
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

  v_mastery := public.cc_player_mastery_level(actor, 'services.repair');
  v_rate := v_base * least(2.0, 1 + v_speed * greatest(0, v_mastery - 1))
    * (1 + public.cc_research_bonus_number(actor, 'repairWorkRateBonus'));
  -- Fixer composition (0029): efficiency = min(1.80, mastery x
  -- (1 + repair_efficiency_bonus)); the snapshotted duration takes
  -- the repair_speed_bonus multiplier (1 - min(0.30, bonus)).
  v_efficiency := least(1.80, least(1.5, 1 + v_eff * greatest(0, v_mastery - 1))
    * (1 + greatest(0, v_repair_efficiency_bonus)));
  v_duration := greatest(1, ceil(v_kit_base
    * (1 - least(0.30, greatest(0, v_repair_speed_bonus))) / v_rate * 3600000))::bigint;

  insert into public.craft_jobs(
    owner_user_id, bench, kind, recipe_id, units_total, unit_duration_ms,
    escrow_inputs, escrow_catalyst, rush_ticket_quality, rush_ticket_origin,
    snapshot)
  values (actor, 0, 'repair', v_recipe, v_units, v_duration,
    '{}'::jsonb, '{}'::jsonb, null, null,
    jsonb_build_object(
      'toolId', null, 'toolQualityMultiplier', 1, 'toolDurationMultiplier', 1,
      'toolRefineYieldBonus', 0, 'toolBonusUnitChance', 0,
      'skillDurationMultiplier', 1, 'rushReduction', 0, 'craftTimeScalar', 1,
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

-- ─── 16. cc_settle_craft_jobs (0026 body + Supply Chains) ──────

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
    if v_action is distinct from (case when v_job.kind = 'repair'
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

-- ─── 17. cc_settle_repair_job (0025 body + Supply Chains) ─────
-- The repair away cap is the PROVIDER's earned cap (the
-- mechanic earns while away), so the provider's Supply
-- Chains term joins it here.

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
      public.cc_earned_offline_cap_hours(provider.player_level)
        + public.cc_research_offline_cap_bonus(provider.id),
      coalesce(nullif(provider.offline_cap_hours, 0)::numeric,
               public.cc_earned_offline_cap_hours(provider.player_level)
        + public.cc_research_offline_cap_bonus(provider.id))
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

-- Settle (and expire) every repair job one player owns or provides.
-- Called by the board read, every repair op, and the activity
-- transitions (the 0025 hook in cc_set/clear_active_action).

-- ─── 18. cc_settle_extraction_time (0033 body + Supply Chains) ─

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

  -- Internal away cap: min(earned tier, limiter when set), [1h, 24h].
  v_away_cap_ms := (greatest(1, least(
      public.cc_earned_offline_cap_hours(p.player_level)
        + public.cc_research_offline_cap_bonus(p.id),
      coalesce(nullif(p.offline_cap_hours, 0)::numeric,
               public.cc_earned_offline_cap_hours(p.player_level)
        + public.cc_research_offline_cap_bonus(p.id))
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

-- ─── 19. Economy metrics: the research meters ────────────────────

alter table public.economy_metrics
  add column if not exists research_enrollments_started bigint not null default 0;
alter table public.economy_metrics
  add column if not exists research_courses_completed bigint not null default 0;
alter table public.economy_metrics
  add column if not exists research_credits_destroyed bigint not null default 0;

create or replace function public.cc_compute_economy_metrics(_day date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz := (_day::timestamp) at time zone 'UTC';
  v_end timestamptz := ((_day + 1)::timestamp) at time zone 'UTC';
  m record;
  v_minted_total bigint;
  v_destroyed_total bigint;
  cj record;
  rj record;
  er record;
begin
  select
    -- Mints -----------------------------------------------------------------
    coalesce(sum((result_payload -> 'rewards' ->> 'credits_awarded')::bigint)
      filter (where action_type = 'cc_apply_chef_rewards'), 0) as minted_roaming,
    coalesce(sum(
      case when coalesce((result_payload -> 'attempt' ->> 'victory')::boolean, false)
        then coalesce((result_payload -> 'attempt' ->> 'creditsGained')::bigint, 0)
           + coalesce((result_payload ->> 'entry_fee')::bigint, 0)
        else 0 end)
      filter (where action_type = 'cc_apply_boss_attempt'), 0) as minted_boss,
    coalesce(sum((result_payload -> 'rewards' ->> 'credits_awarded')::bigint)
      filter (where action_type = 'cc_settle_offline_roaming'), 0) as minted_offline,
    (coalesce(sum((result_payload -> 'rewards' ->> 'credits')::bigint)
        filter (where action_type = 'cc_idle_claim'), 0)
     + coalesce(sum((result_payload -> 'rewards' ->> 'credits_awarded')::bigint)
        filter (where action_type = 'cc_claim_roaming_rewards'), 0)
     + 5000 * count(*) filter (where action_type = 'cc_initial_bundle')
     + coalesce(sum((result_payload -> 'market_fee' ->> 'cache_rank_proceeds_bonus')::bigint)
        filter (where action_type = 'cc_accept_listing'), 0)
    ) as minted_other,
    -- Sinks -----------------------------------------------------------------
    coalesce(sum((result_payload -> 'market_fee' ->> 'fee_credits')::bigint)
      filter (where action_type = 'cc_accept_listing'), 0) as destroyed_market_fees,
    coalesce(sum((result_payload ->> 'total_price')::bigint)
      filter (where action_type = 'cc_vendor_buy'), 0) as destroyed_vendor,
    coalesce(sum((result_payload ->> 'creditsCharged')::bigint)
      filter (where action_type = 'cc_resurrect'), 0) as destroyed_resurrection,
    coalesce(sum((result_payload ->> 'total_price')::bigint)
      filter (where action_type = 'cc_retrain'), 0) as destroyed_respec,
    coalesce(sum((result_payload ->> 'entry_fee')::bigint)
      filter (where action_type = 'cc_apply_boss_attempt'), 0) as destroyed_boss_entry_fees,
    coalesce(sum(greatest(0,
        coalesce((result_payload -> 'attempt' ->> 'creditsLost')::bigint, 0)
        - coalesce((result_payload ->> 'entry_fee')::bigint, 0)))
      filter (where action_type = 'cc_apply_boss_attempt'
        and not coalesce((result_payload -> 'attempt' ->> 'victory')::boolean, false)),
      0) as destroyed_boss_death_fees,
    -- Market ----------------------------------------------------------------
    count(*) filter (where action_type = 'cc_market_create') as market_listings_created,
    count(*) filter (where action_type = 'cc_accept_listing') as market_sales,
    coalesce(sum((result_payload -> 'listing' ->> 'price_credits')::bigint)
      filter (where action_type = 'cc_accept_listing'), 0) as market_volume,
    -- Crafted market sales (0024) -------------------------------------------
    count(*) filter (where action_type = 'cc_accept_listing'
      and (result_payload -> 'listing' ->> 'batch_origin' = 'crafted'
        or result_payload -> 'item' -> 'payload' ->> 'origin' = 'crafted')) as crafted_sales,
    coalesce(sum((result_payload -> 'listing' ->> 'price_credits')::bigint)
      filter (where action_type = 'cc_accept_listing'
        and (result_payload -> 'listing' ->> 'batch_origin' = 'crafted'
          or result_payload -> 'item' -> 'payload' ->> 'origin' = 'crafted')), 0) as crafted_volume,
    -- Cache -----------------------------------------------------------------
    count(*) filter (where action_type = 'cc_claim_rewarded_cache_key') as cache_keys_from_ads,
    count(*) filter (where action_type = 'cc_make_item' and coalesce(result_payload ->> 'payment', 'key') = 'free') as cache_boxes_opened_free,
    count(*) filter (where action_type = 'cc_make_item' and coalesce(result_payload ->> 'payment', 'key') = 'ad') as cache_boxes_opened_ad,
    count(*) filter (where action_type = 'cc_make_item' and coalesce(result_payload ->> 'payment', 'key') = 'key') as cache_boxes_opened_key,
    coalesce(sum((result_payload ->> 'cache_keys_awarded')::bigint)
      filter (where action_type = 'cc_leaderboard_settlement'), 0) as cache_keys_from_leaderboards,
    count(*) filter (where action_type in ('cc_make_item', 'cc_draw_item')) as cache_opens,
    coalesce(sum((result_payload -> 'rewards' ->> 'cache_fragments_awarded')::bigint)
      filter (where action_type in ('cc_apply_chef_rewards', 'cc_settle_offline_roaming', 'cc_claim_roaming_rewards')), 0) as cache_fragments_awarded,
    -- Legendary salvage + cores (0026): destroyed legendaries are a
    -- LEDGER fact (the recycle result carries the consumed item) —
    -- distinct from legendaries_minted_by_source above, which counts
    -- item_instances at creation. No double counting: creation and
    -- destruction are separate meters by design.
    count(*) filter (where action_type = 'cc_recycle_item'
      and result_payload -> 'item' ->> 'rarity' = 'Legendary') as legendaries_salvaged,
    coalesce(sum((result_payload ->> 'cores_award')::bigint)
      filter (where action_type = 'cc_recycle_item'), 0) as legendary_cores_minted,
    -- Cache Rank (0031): token meters — counted from the grant /
    -- spend ledger payloads (tokens are not credits; these never
    -- enter the minted/destroyed credit totals).
    coalesce(sum((result_payload ->> 'tokens_granted')::bigint)
      filter (where action_type = 'cc_cache_rank_grant'), 0) as cache_rank_tokens_granted,
    coalesce(sum((result_payload ->> 'cost')::bigint)
      filter (where action_type = 'cc_cache_rank_spend'), 0) as cache_rank_tokens_spent,
    (coalesce(sum((result_payload -> 'job' ->> 'escrow_cores')::bigint)
        filter (where action_type = 'cc_enqueue_craft_job'), 0)
     - coalesce(sum((result_payload ->> 'cores_refunded')::bigint)
        filter (where action_type = 'cc_cancel_craft_job'), 0)
     -- Reforge (0027): cores destroyed outright extend the spent
     -- meter — each destroyed core is counted exactly once, here;
     -- the dedicated column below breaks the reforge share out.
     + coalesce(sum((result_payload ->> 'cores_charged')::bigint)
        filter (where action_type = 'cc_reforge_item'), 0)) as legendary_cores_spent,
    -- Reforge meters (0027): completions, scrap destroyed, cores
    -- destroyed — all ledger facts from cc_reforge_item results.
    count(*) filter (where action_type = 'cc_reforge_item') as reforges_completed,
    coalesce(sum((result_payload ->> 'scrap_charged')::bigint)
      filter (where action_type = 'cc_reforge_item'), 0) as scrap_destroyed_reforge,
    coalesce(sum((result_payload ->> 'cores_charged')::bigint)
      filter (where action_type = 'cc_reforge_item'), 0) as legendary_cores_destroyed_reforge,
    -- Endless meters (0028): runs, encounters, fees, payouts — all
    -- ledger facts from the three endless appliers' result payloads.
    -- Run-end payouts appear on cc_end_endless_run (bank), on
    -- cc_apply_endless_encounter (death / depth-cap bank), and as
    -- abandoned_settlement inside cc_start_endless_run.
    count(*) filter (where action_type = 'cc_start_endless_run') as endless_runs_started,
    (count(*) filter (where action_type = 'cc_end_endless_run'
        and coalesce((result_payload ->> 'ended')::boolean, false))
     + count(*) filter (where action_type = 'cc_apply_endless_encounter'
        and result_payload ->> 'run_status' in ('died', 'banked'))
     + count(*) filter (where action_type = 'cc_start_endless_run'
        and result_payload -> 'abandoned_settlement' is not null
        and result_payload -> 'abandoned_settlement' <> 'null'::jsonb)) as endless_runs_ended,
    count(*) filter (where action_type = 'cc_apply_endless_encounter'
      and coalesce((result_payload ->> 'victory')::boolean, false)) as endless_encounters_cleared,
    coalesce(sum((result_payload ->> 'entry_fee')::bigint)
      filter (where action_type = 'cc_start_endless_run'), 0) as endless_fees_destroyed,
    (coalesce(sum((result_payload -> 'payout' ->> 'credits')::bigint)
        filter (where action_type in ('cc_end_endless_run', 'cc_apply_endless_encounter')), 0)
     + coalesce(sum((result_payload -> 'abandoned_settlement' -> 'payout' ->> 'credits')::bigint)
        filter (where action_type = 'cc_start_endless_run'), 0)) as endless_credits_paid,
    (coalesce(sum((result_payload -> 'payout' ->> 'xp')::bigint)
        filter (where action_type in ('cc_end_endless_run', 'cc_apply_endless_encounter')), 0)
     + coalesce(sum((result_payload -> 'abandoned_settlement' -> 'payout' ->> 'xp')::bigint)
        filter (where action_type = 'cc_start_endless_run'), 0)) as endless_xp_paid,
    -- Action skill fires (0030): counted from the appliers' recorded
    -- action_skill blocks; the workshop fire's own ledger rows are
    -- Fixer fires. Firing moves no currency — these are pure counts.
    count(*) filter (where action_type in ('cc_apply_boss_attempt', 'cc_apply_endless_encounter')
      and coalesce((result_payload -> 'action_skill' ->> 'fired')::boolean, false)
      and result_payload -> 'action_skill' ->> 'tree' = 'Gunslinger') as action_skill_fires_gunslinger,
    count(*) filter (where action_type in ('cc_apply_boss_attempt', 'cc_apply_endless_encounter')
      and coalesce((result_payload -> 'action_skill' ->> 'fired')::boolean, false)
      and result_payload -> 'action_skill' ->> 'tree' = 'Demolition') as action_skill_fires_demolition,
    count(*) filter (where action_type in ('cc_apply_boss_attempt', 'cc_apply_endless_encounter')
      and coalesce((result_payload -> 'action_skill' ->> 'fired')::boolean, false)
      and result_payload -> 'action_skill' ->> 'tree' = 'Scavenger') as action_skill_fires_scavenger,
    (count(*) filter (where action_type in ('cc_apply_boss_attempt', 'cc_apply_endless_encounter')
        and coalesce((result_payload -> 'action_skill' ->> 'fired')::boolean, false)
        and result_payload -> 'action_skill' ->> 'tree' = 'Fixer')
     + count(*) filter (where action_type = 'cc_fire_overclock_workshop')) as action_skill_fires_fixer,
    -- Dispatch meters (0032): foot + courier settle payouts — real
    -- mints from the cc_dispatch_settle ledger payloads (recalls
    -- included: a pro-rata payout is still a payout). The courier
    -- column is the premium family's breakout of the same fold.
    coalesce(sum((result_payload -> 'payout' ->> 'credits')::bigint)
      filter (where action_type = 'cc_dispatch_settle'
        and result_payload ->> 'family' = 'foot'), 0) as minted_dispatch,
    coalesce(sum((result_payload -> 'payout' ->> 'credits')::bigint)
      filter (where action_type = 'cc_dispatch_settle'
        and result_payload ->> 'family' = 'courier'), 0) as minted_courier,
    coalesce(sum((result_payload ->> 'passes_completed')::bigint)
      filter (where action_type = 'cc_apply_extraction'), 0) as extraction_passes,
    coalesce(sum((result_payload ->> 'xp_awarded')::bigint)
      filter (where action_type = 'cc_apply_extraction'), 0) as extraction_xp,
    -- Login streak (0036): the day's cc_login_streak_claim grants.
    -- Credits are a real faucet and fold into the minted total
    -- below; fragments and keys are metered as their own sources,
    -- distinct from roaming fragments, leaderboard keys, and
    -- ad-lane key issuance.
    coalesce(sum((result_payload ->> 'credits_awarded')::bigint)
      filter (where action_type = 'cc_login_streak_claim'), 0) as minted_login_streak,
    coalesce(sum((result_payload ->> 'fragments_awarded')::bigint)
      filter (where action_type = 'cc_login_streak_claim'), 0) as fragments_login_streak,
    coalesce(sum((result_payload ->> 'cache_keys_awarded')::bigint)
      filter (where action_type = 'cc_login_streak_claim'), 0) as keys_login_streak,
    -- Research (0038): enrollments, completions, and the enrollment
    -- fees destroyed at enroll (ledger facts; the destroyed fold
    -- joins credits_destroyed_total below — Research is the sink).
    count(*) filter (where action_type = 'cc_enroll_research') as research_started,
    count(*) filter (where action_type = 'cc_research_complete') as research_completed,
    coalesce(sum((result_payload ->> 'cost_credits')::bigint)
      filter (where action_type = 'cc_enroll_research'), 0) as research_destroyed
  into m
  from public.verified_action_ledger
  where created_at >= v_start and created_at < v_end;

  -- Craft job meters (0024): jobs_completed is a job-level fact
  -- (status + completed_at); units / XP / refined output are counted
  -- per OUTPUT at the unit's settle-day stamp, across jobs of ANY
  -- status — units produced inside a job that is later cancelled (or
  -- still running at day's end) are real production and real XP.
  select
    (select count(*) from public.craft_jobs j
      where j.status = 'complete'
        and j.completed_at >= v_start and j.completed_at < v_end) as jobs_completed,
    count(*)::integer as units_completed,
    coalesce(sum((o ->> 'xp')::bigint), 0)::bigint as xp_awarded,
    coalesce(sum((o ->> 'outputQuantity')::integer)
      filter (where o ->> 'kind' = 'refine'), 0)::integer as refined_units
  into cj
  from public.craft_jobs j,
       lateral jsonb_array_elements(j.outputs) o
  where (o ->> 'completedAtMs')::bigint >= (extract(epoch from v_start) * 1000)::bigint
    and (o ->> 'completedAtMs')::bigint < (extract(epoch from v_end) * 1000)::bigint;

  -- Repair meters (0025): job-level facts from service_jobs at
  -- their terminal day (posted counted at posting day); self-repair
  -- kit consumption counted per completed repair UNIT output, the
  -- same settle-day stamp the craft meters use.
  select
    (select count(*) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.created_at >= v_start and j.created_at < v_end) as jobs_posted,
    (select count(*) from public.service_jobs j
      where j.profession_id = 'repair' and j.status = 'completed'
        and j.completed_at >= v_start and j.completed_at < v_end)::integer as jobs_completed,
    (select coalesce(sum(j.points_restored), 0) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled')) as points_restored,
    (select coalesce(sum(j.paid_credits), 0) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled'))::bigint as credits_volume,
    (select coalesce(sum(j.fee_credits), 0) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled'))::bigint as fees_destroyed,
    (select coalesce(sum(j.xp_awarded), 0) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled'))::bigint as xp_awarded,
    ((select coalesce(sum(jsonb_array_length(j.kits_consumed)), 0)
        from public.service_jobs j
       where j.profession_id = 'repair'
         and j.completed_at >= v_start and j.completed_at < v_end
         and j.status in ('completed', 'cancelled'))
     + (select count(*) from public.craft_jobs j,
              lateral jsonb_array_elements(j.outputs) o
         where o ->> 'kind' = 'repair'
           and (o ->> 'completedAtMs')::bigint >= (extract(epoch from v_start) * 1000)::bigint
           and (o ->> 'completedAtMs')::bigint < (extract(epoch from v_end) * 1000)::bigint))::integer as kits_consumed
  into rj;

  -- Endless depth + milestone facts (0028): deepest run ENDED today
  -- (bank, death, cap, or carried-out abandonment — each ending is a
  -- ledger fact on its own row), and milestone drops by rarity from
  -- the encounter payloads that recorded them.
  select
    (select coalesce(max(d), 0)::integer from (
       select (result_payload ->> 'depth_reached')::integer as d
         from public.verified_action_ledger
        where action_type = 'cc_end_endless_run'
          and coalesce((result_payload ->> 'ended')::boolean, false)
          and created_at >= v_start and created_at < v_end
       union all
       select (result_payload ->> 'depth')::integer
         from public.verified_action_ledger
        where action_type = 'cc_apply_endless_encounter'
          and result_payload ->> 'run_status' in ('died', 'banked')
          and created_at >= v_start and created_at < v_end
       union all
       select (result_payload -> 'abandoned_settlement' ->> 'depth_reached')::integer
         from public.verified_action_ledger
        where action_type = 'cc_start_endless_run'
          and result_payload -> 'abandoned_settlement' is not null
          and result_payload -> 'abandoned_settlement' <> 'null'::jsonb
          and created_at >= v_start and created_at < v_end
     ) depths) as deepest_depth,
    (select count(*)::integer
       from public.verified_action_ledger
      where action_type = 'cc_apply_endless_encounter'
        and created_at >= v_start and created_at < v_end
        and result_payload -> 'milestone_drop' ->> 'rarity' is not null) as milestone_drops,
    (select coalesce(jsonb_object_agg(g.rarity, g.cnt), '{}'::jsonb)
       from (
         select result_payload -> 'milestone_drop' ->> 'rarity' as rarity,
                count(*)::integer as cnt
           from public.verified_action_ledger
          where action_type = 'cc_apply_endless_encounter'
            and created_at >= v_start and created_at < v_end
            and result_payload -> 'milestone_drop' ->> 'rarity' is not null
          group by 1
       ) g) as milestone_by_rarity
  into er;

  v_minted_total := m.minted_roaming + m.minted_boss + m.minted_offline + m.minted_other
    + m.endless_credits_paid + m.minted_dispatch + m.minted_courier
    + m.minted_login_streak;
  v_destroyed_total := m.destroyed_market_fees + m.destroyed_vendor
    + m.destroyed_resurrection + m.destroyed_respec
    + m.destroyed_boss_entry_fees + m.destroyed_boss_death_fees
    + rj.fees_destroyed + m.endless_fees_destroyed + m.research_destroyed;

  insert into public.economy_metrics (
    day,
    credits_minted_roaming, credits_minted_boss, credits_minted_offline,
    credits_minted_other, credits_minted_total,
    credits_destroyed_market_fees, credits_destroyed_vendor,
    credits_destroyed_resurrection, credits_destroyed_respec,
    credits_destroyed_boss_entry_fees, credits_destroyed_boss_death_fees,
    credits_destroyed_total, net_credit_change,
    legendaries_roaming, legendaries_boss, legendaries_cache, legendaries_total,
    market_listings_created, market_sales, market_volume,
    market_median_price, market_median_by_rarity,
    cache_keys_from_ads, cache_keys_from_leaderboards, cache_opens, cache_fragments_awarded,
    cache_boxes_opened_free, cache_boxes_opened_ad, cache_boxes_opened_key,
    craft_jobs_completed, craft_units_completed, craft_xp_awarded,
    materials_destroyed_crafting, refined_units_produced,
    gear_items_crafted, crafted_market_sales, crafted_market_volume,
    repair_jobs_posted, repair_jobs_completed, repair_points_restored,
    repair_credits_volume, repair_fees_destroyed, repair_kits_consumed,
    repair_xp_awarded,
    legendaries_salvaged, legendary_cores_minted, legendary_cores_spent,
    reforges_completed, scrap_destroyed_reforge, legendary_cores_destroyed_reforge,
    endless_runs_started, endless_runs_ended, endless_encounters_cleared,
    endless_deepest_depth, endless_credits_paid, endless_xp_paid,
    endless_fees_destroyed, endless_milestone_drops,
    endless_milestone_drops_by_rarity,
    action_skill_fires_gunslinger, action_skill_fires_demolition,
    action_skill_fires_scavenger, action_skill_fires_fixer,
    cache_rank_tokens_granted, cache_rank_tokens_spent,
    credits_minted_dispatch, credits_minted_courier,
    extraction_passes, extraction_xp_awarded, materials_minted_extraction,
    credits_minted_login_streak, cache_fragments_from_login_streak,
    cache_keys_from_login_streak,
    research_enrollments_started, research_courses_completed,
    research_credits_destroyed,
    computed_at
  )
  select
    _day,
    m.minted_roaming, m.minted_boss, m.minted_offline, m.minted_other,
    v_minted_total,
    m.destroyed_market_fees, m.destroyed_vendor, m.destroyed_resurrection,
    m.destroyed_respec, m.destroyed_boss_entry_fees, m.destroyed_boss_death_fees,
    v_destroyed_total, v_minted_total - v_destroyed_total,
    leg.roaming, leg.boss, leg.cache, leg.roaming + leg.boss + leg.cache,
    m.market_listings_created, m.market_sales, m.market_volume,
    (select percentile_cont(0.5) within group (
        order by (l.result_payload -> 'listing' ->> 'price_credits')::numeric)
       from public.verified_action_ledger l
      where l.action_type = 'cc_accept_listing'
        and l.created_at >= v_start and l.created_at < v_end),
    (select coalesce(jsonb_object_agg(g.rarity, g.median), '{}'::jsonb)
       from (
         select l.result_payload -> 'item' ->> 'rarity' as rarity,
                percentile_cont(0.5) within group (
                  order by (l.result_payload -> 'listing' ->> 'price_credits')::numeric) as median
           from public.verified_action_ledger l
          where l.action_type = 'cc_accept_listing'
            and l.created_at >= v_start and l.created_at < v_end
            and l.result_payload -> 'item' ->> 'rarity' is not null
          group by 1
       ) g),
    m.cache_keys_from_ads, m.cache_keys_from_leaderboards, m.cache_opens, m.cache_fragments_awarded,
    m.cache_boxes_opened_free, m.cache_boxes_opened_ad, m.cache_boxes_opened_key,
    cj.jobs_completed, cj.units_completed, cj.xp_awarded,
    (select coalesce(jsonb_object_agg(key, net), '{}'::jsonb)
       from (
         select d.key, sum(d.delta) as net
           from (
             select e.key as key, (e.value)::bigint as delta
               from public.verified_action_ledger l,
                    jsonb_each_text(coalesce(l.result_payload -> 'job' -> 'escrow_inputs', '{}'::jsonb)) as e
              where l.action_type = 'cc_enqueue_craft_job'
                and l.created_at >= v_start and l.created_at < v_end
             union all
             select e.key, (e.value)::bigint
               from public.verified_action_ledger l,
                    jsonb_each_text(coalesce(l.result_payload -> 'job' -> 'escrow_catalyst', '{}'::jsonb)) as e
              where l.action_type = 'cc_enqueue_craft_job'
                and l.created_at >= v_start and l.created_at < v_end
             union all
             select e.key, -(e.value)::bigint
               from public.verified_action_ledger l,
                    jsonb_each_text(coalesce(l.result_payload -> 'refunded_inputs', '{}'::jsonb)) as e
              where l.action_type = 'cc_cancel_craft_job'
                and l.created_at >= v_start and l.created_at < v_end
           ) d
          group by d.key
         having sum(d.delta) > 0
       ) nets),
    cj.refined_units,
    (select count(*)::integer from public.item_instances
      where payload ->> 'origin' = 'crafted'
        and created_at >= v_start and created_at < v_end),
    m.crafted_sales, m.crafted_volume,
    rj.jobs_posted, rj.jobs_completed, rj.points_restored,
    rj.credits_volume, rj.fees_destroyed, rj.kits_consumed,
    rj.xp_awarded,
    m.legendaries_salvaged, m.legendary_cores_minted, m.legendary_cores_spent,
    m.reforges_completed, m.scrap_destroyed_reforge, m.legendary_cores_destroyed_reforge,
    m.endless_runs_started, m.endless_runs_ended, m.endless_encounters_cleared,
    er.deepest_depth, m.endless_credits_paid, m.endless_xp_paid,
    m.endless_fees_destroyed, er.milestone_drops,
    er.milestone_by_rarity,
    m.action_skill_fires_gunslinger, m.action_skill_fires_demolition,
    m.action_skill_fires_scavenger, m.action_skill_fires_fixer,
    m.cache_rank_tokens_granted, m.cache_rank_tokens_spent,
    m.minted_dispatch, m.minted_courier,
    m.extraction_passes::integer, m.extraction_xp,
    (select coalesce(jsonb_object_agg(key, total), '{}'::jsonb)
       from (
         select f.key, sum((f.value)::bigint) as total
           from public.verified_action_ledger l,
                jsonb_each_text(
                  coalesce(l.result_payload -> 'finds_materials', '{}'::jsonb)
                  || coalesce(l.result_payload -> 'finds_essences', '{}'::jsonb)) as f
          where l.action_type = 'cc_apply_extraction'
            and l.created_at >= v_start and l.created_at < v_end
          group by f.key
         having sum((f.value)::bigint) > 0
       ) minted),
    m.minted_login_streak, m.fragments_login_streak, m.keys_login_streak::integer,
    m.research_started, m.research_completed, m.research_destroyed,
    now()
  from (
    select
      count(*) filter (where payload ->> 'sourceTag' = 'World Drop') as roaming,
      count(*) filter (where payload ->> 'sourceTag' = 'Boss Drop') as boss,
      count(*) filter (where payload ->> 'sourceTag' = 'Cache-Forged') as cache
    from public.item_instances
    where rarity = 'Legendary' and created_at >= v_start and created_at < v_end
  ) leg
  on conflict (day) do update set
    credits_minted_roaming = excluded.credits_minted_roaming,
    credits_minted_boss = excluded.credits_minted_boss,
    credits_minted_offline = excluded.credits_minted_offline,
    credits_minted_other = excluded.credits_minted_other,
    credits_minted_total = excluded.credits_minted_total,
    credits_destroyed_market_fees = excluded.credits_destroyed_market_fees,
    credits_destroyed_vendor = excluded.credits_destroyed_vendor,
    credits_destroyed_resurrection = excluded.credits_destroyed_resurrection,
    credits_destroyed_respec = excluded.credits_destroyed_respec,
    credits_destroyed_boss_entry_fees = excluded.credits_destroyed_boss_entry_fees,
    credits_destroyed_boss_death_fees = excluded.credits_destroyed_boss_death_fees,
    credits_destroyed_total = excluded.credits_destroyed_total,
    net_credit_change = excluded.net_credit_change,
    legendaries_roaming = excluded.legendaries_roaming,
    legendaries_boss = excluded.legendaries_boss,
    legendaries_cache = excluded.legendaries_cache,
    legendaries_total = excluded.legendaries_total,
    market_listings_created = excluded.market_listings_created,
    market_sales = excluded.market_sales,
    market_volume = excluded.market_volume,
    market_median_price = excluded.market_median_price,
    market_median_by_rarity = excluded.market_median_by_rarity,
    cache_keys_from_ads = excluded.cache_keys_from_ads,
    cache_keys_from_leaderboards = excluded.cache_keys_from_leaderboards,
    cache_opens = excluded.cache_opens,
    cache_fragments_awarded = excluded.cache_fragments_awarded,
    cache_boxes_opened_free = excluded.cache_boxes_opened_free,
    cache_boxes_opened_ad = excluded.cache_boxes_opened_ad,
    cache_boxes_opened_key = excluded.cache_boxes_opened_key,
    craft_jobs_completed = excluded.craft_jobs_completed,
    craft_units_completed = excluded.craft_units_completed,
    craft_xp_awarded = excluded.craft_xp_awarded,
    materials_destroyed_crafting = excluded.materials_destroyed_crafting,
    refined_units_produced = excluded.refined_units_produced,
    gear_items_crafted = excluded.gear_items_crafted,
    crafted_market_sales = excluded.crafted_market_sales,
    crafted_market_volume = excluded.crafted_market_volume,
    repair_jobs_posted = excluded.repair_jobs_posted,
    repair_jobs_completed = excluded.repair_jobs_completed,
    repair_points_restored = excluded.repair_points_restored,
    repair_credits_volume = excluded.repair_credits_volume,
    repair_fees_destroyed = excluded.repair_fees_destroyed,
    repair_kits_consumed = excluded.repair_kits_consumed,
    repair_xp_awarded = excluded.repair_xp_awarded,
    legendaries_salvaged = excluded.legendaries_salvaged,
    legendary_cores_minted = excluded.legendary_cores_minted,
    legendary_cores_spent = excluded.legendary_cores_spent,
    reforges_completed = excluded.reforges_completed,
    scrap_destroyed_reforge = excluded.scrap_destroyed_reforge,
    legendary_cores_destroyed_reforge = excluded.legendary_cores_destroyed_reforge,
    endless_runs_started = excluded.endless_runs_started,
    endless_runs_ended = excluded.endless_runs_ended,
    endless_encounters_cleared = excluded.endless_encounters_cleared,
    endless_deepest_depth = excluded.endless_deepest_depth,
    endless_credits_paid = excluded.endless_credits_paid,
    endless_xp_paid = excluded.endless_xp_paid,
    endless_fees_destroyed = excluded.endless_fees_destroyed,
    endless_milestone_drops = excluded.endless_milestone_drops,
    endless_milestone_drops_by_rarity = excluded.endless_milestone_drops_by_rarity,
    action_skill_fires_gunslinger = excluded.action_skill_fires_gunslinger,
    action_skill_fires_demolition = excluded.action_skill_fires_demolition,
    action_skill_fires_scavenger = excluded.action_skill_fires_scavenger,
    action_skill_fires_fixer = excluded.action_skill_fires_fixer,
    cache_rank_tokens_granted = excluded.cache_rank_tokens_granted,
    cache_rank_tokens_spent = excluded.cache_rank_tokens_spent,
    credits_minted_dispatch = excluded.credits_minted_dispatch,
    credits_minted_courier = excluded.credits_minted_courier,
    extraction_passes = excluded.extraction_passes,
    extraction_xp_awarded = excluded.extraction_xp_awarded,
    materials_minted_extraction = excluded.materials_minted_extraction,
    credits_minted_login_streak = excluded.credits_minted_login_streak,
    cache_fragments_from_login_streak = excluded.cache_fragments_from_login_streak,
    cache_keys_from_login_streak = excluded.cache_keys_from_login_streak,
    research_enrollments_started = excluded.research_enrollments_started,
    research_courses_completed = excluded.research_courses_completed,
    research_credits_destroyed = excluded.research_credits_destroyed,
    computed_at = excluded.computed_at;

  return (select to_jsonb(e) from public.economy_metrics e where e.day = _day);
end;$$;

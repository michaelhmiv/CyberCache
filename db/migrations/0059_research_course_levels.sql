-- 0059: Research course level requirements removed (gate-removal step 3).
-- Numbering note: 0057 was gate-removal step 2 (consumable recipe
-- levels, PR #324); 0058 was the profile showcase pins migration.
-- This migration restates the Research catalog + enroll functions.
--
-- Owner law (Michael, 2026-11-02): progression is gated by scarcity
-- and difficulty, not level numbers. The level-gate audit (G5) found
-- the Research courses carrying hunter-level prerequisites -- every
-- tier 1 at L5, the non-Fabrication tier 2s at L20, the
-- non-Fabrication tier 3s at L40 -- on top of the carriers that
-- already bind: the prerequisite chain within each faculty, real
-- wall-clock durations (6h / 48h / 168h), and fees destroyed at
-- enroll (2,500 / 15,000 / 60,000 cr; 310,000 cr across the
-- catalog). The level numbers are deleted; every other gate stands
-- exactly as it was, including Fabrication's bench gates
-- (Production Systems requires bench 2, Master Fabricator bench 3 --
-- bench unlock levels are a later program step, untouched here).
--
-- This migration restates ONLY cc_research_course(),
-- cc_research_catalog(), and cc_enroll_research() from 0038: the
-- two catalog literals lose their "requiresLevel" keys (10 course
-- entries), and the enroll function loses its level_too_low check.
-- The TS catalog (src/content/research.ts), the in-memory twin, the
-- state-view derivation, and the course brief UI move in the same
-- slice; parity is pinned by src/test/gateRemovalStep3.test.ts.
--
-- The course catalog, per-course lookup (0038 body, level keys removed).
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

-- The course catalog, full list (0038 body, level keys removed).
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

-- Enroll (0038 body, the level_too_low check removed).
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

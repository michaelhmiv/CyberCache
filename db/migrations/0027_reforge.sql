-- =====================================================================
-- 0027 — Reforge: reroll ONE affix for scrap (+ legendary cores)
-- =====================================================================
-- APPLY ORDER: apply this migration BEFORE merging the PR that ships
-- it (the standing drill). Everything here is additive or a function
-- creation/restatement: cc_reforge_item is NEW (the old server never
-- calls it), the economy_metrics columns are additive with defaults,
-- and cc_compute_economy_metrics keeps its exact signature. Safe to
-- apply ahead of deploy.
--
-- The feature: spend scrap — plus legendary cores on Legendary-
-- rarity items — to replace ONE rolled affix on a gear item with a
-- fresh roll from the same pool the generator uses. Rules of the op
-- (src/content/reforge.ts owns the cost rules; src/lib/gear/
-- affixPools.ts owns the pools + roll, shared with the generators):
--
--   * Eligible: gear kinds only (weapon / shield / classMod / relic
--     / ordnance), runtime_state 'available' (unequipped, unlisted,
--     not escrowed in a job), unlocked, with the named affix being a
--     rolled pool affix. Vehicles are OUT of scope (separate item
--     family, Garage surface, yield-tuning affixes). Activity
--     modules are never reforgeable (procedural modules whose
--     generation inputs are not persisted on the item).
--   * Identity is invariant: rarity, level, type, manufacturer,
--     element, rollQuality, parts, tree/node boosts, shield
--     behavior, and legendaryEffectId never change — a
--     non-legendary can never gain a legendary effect here and a
--     legendary never loses one. The applier below enforces the
--     invariants against the stored payload before it charges.
--   * The replacement never duplicates a stat the item's other
--     affixes carry and never returns the identical affix it
--     consumed (when the pool is exhausted, the same stat may
--     re-roll only with a different value).
--   * Costs (live levers, economy_config): scrap = ceil(salvage
--     value × 3 × reforgeScrapScalar[default 1]) where salvage
--     value is cc_salvage_scrap(rarity, level); cores =
--     reforgeLegendaryCoreCost[default 2], Legendary rarity only.
--     Both currencies are DESTROYED (deducted, never escrowed) and
--     metered below.
--
-- Contents:
--   1. economy_metrics gains reforges_completed,
--      scrap_destroyed_reforge, legendary_cores_destroyed_reforge.
--   2. cc_reforge_item — the atomic applier. The roll itself is
--      computed in TypeScript (the shared affix-pool module, on a
--      dedicated stream seeded from the op nonce) because the
--      generator bake rules live in TS; this function is the
--      authority: nonce replay → per-player advisory lock → row
--      lock → state/lock/kind/affix validation → payload invariant
--      validation (identity fields, other affixes bit-identical,
--      replacement differs and does not duplicate) → lever-priced
--      cost recompute → funds check → charge → persist + estimated
--      value recompute → ledger. Any failed check raises and the
--      transaction rolls back: a refused reforge charges nothing.
--   3. cc_compute_economy_metrics restated (0026 body): reforge
--      cores extend legendary_cores_spent (+ cores_charged over
--      cc_reforge_item rows — each destroyed core counted once, no
--      double counting with the craft-escrow terms), and the three
--      new reforge meters land from the same ledger rows. Scrap is
--      not a credits meter: scrap_destroyed_reforge never enters
--      credits_destroyed_total.
-- =====================================================================

-- ─── 1. Metrics columns ──────────────────────────────────────────────

alter table public.economy_metrics
  add column if not exists reforges_completed integer not null default 0,
  add column if not exists scrap_destroyed_reforge bigint not null default 0,
  add column if not exists legendary_cores_destroyed_reforge bigint not null default 0;

-- ─── 2. cc_reforge_item ──────────────────────────────────────────────

create or replace function public.cc_reforge_item(
  p_player_id uuid,
  nonce text,
  item_id uuid,
  affix_id text,
  p_expected_old_affix jsonb,
  p_new_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  item public.item_instances%rowtype;
  result jsonb;
  v_affixes jsonb;
  v_new_affixes jsonb;
  v_idx integer := -1;
  v_old_affix jsonb;
  v_new_affix jsonb;
  v_scalar numeric;
  v_core_cost numeric;
  v_scrap_cost bigint;
  v_cores_cost integer;
  i integer;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into item from public.item_instances
   where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.is_locked then raise exception 'Locked item'; end if;
  if item.runtime_state <> 'available' then raise exception 'Item state invalid'; end if;
  if item.kind not in ('weapon', 'shield', 'classMod', 'relic', 'ordnance') then
    raise exception 'Item cannot be reforged';
  end if;

  -- Locate the affix entry in the CURRENT payload (server truth).
  v_affixes := coalesce(item.payload -> 'affixes', '[]'::jsonb);
  for i in 0 .. greatest(jsonb_array_length(v_affixes) - 1, -1) loop
    if v_affixes -> i ->> 'id' = affix_id then
      v_idx := i;
      v_old_affix := v_affixes -> i;
    end if;
  end loop;
  if v_idx < 0 then raise exception 'Affix not found'; end if;
  if coalesce(v_old_affix ->> 'category', '') = 'activity' then
    raise exception 'Affix cannot be reforged';
  end if;
  -- The roll was computed from this exact entry; a mismatch means
  -- the item changed under the request — refuse, charge nothing.
  if p_expected_old_affix is null or v_old_affix <> p_expected_old_affix then
    raise exception 'Item changed since the roll was computed';
  end if;

  -- Payload invariants: the new payload must be the same item with
  -- exactly the one affix entry swapped (derived stats recomputed
  -- by the shared TS module; identity fields pinned here).
  if p_new_payload is null then raise exception 'Reforge payload rejected'; end if;
  if (p_new_payload ->> 'id') is distinct from (item.payload ->> 'id')
     or (p_new_payload ->> 'rarity') is distinct from (item.payload ->> 'rarity')
     or (p_new_payload ->> 'level') is distinct from (item.payload ->> 'level')
     or (p_new_payload ->> 'legendaryEffectId') is distinct from (item.payload ->> 'legendaryEffectId')
     or (p_new_payload ->> 'element') is distinct from (item.payload ->> 'element')
     or (p_new_payload ->> 'weaponType') is distinct from (item.payload ->> 'weaponType')
     or (p_new_payload ->> 'manufacturer') is distinct from (item.payload ->> 'manufacturer')
     or (p_new_payload ->> 'treeBonus') is distinct from (item.payload ->> 'treeBonus')
     or (p_new_payload ->> 'effect') is distinct from (item.payload ->> 'effect')
     or (p_new_payload ->> 'behavior') is distinct from (item.payload ->> 'behavior')
     or (p_new_payload -> 'rollQuality') is distinct from (item.payload -> 'rollQuality')
     or (p_new_payload -> 'parts') is distinct from (item.payload -> 'parts')
     or (p_new_payload -> 'nodeBoosts') is distinct from (item.payload -> 'nodeBoosts')
  then
    raise exception 'Reforge payload rejected';
  end if;

  v_new_affixes := coalesce(p_new_payload -> 'affixes', '[]'::jsonb);
  if jsonb_array_length(v_new_affixes) <> jsonb_array_length(v_affixes) then
    raise exception 'Reforge payload rejected';
  end if;
  for i in 0 .. greatest(jsonb_array_length(v_affixes) - 1, -1) loop
    if i <> v_idx and (v_new_affixes -> i) is distinct from (v_affixes -> i) then
      raise exception 'Reforge payload rejected';
    end if;
  end loop;
  v_new_affix := v_new_affixes -> v_idx;
  -- The replacement must actually replace: a different entry, the
  -- generator's id convention for its slot, and no stat duplicated
  -- across the item's other affixes — unless it is the replaced
  -- affix's own stat re-rolled (the pool-exhausted fallback, whose
  -- value must then differ, which the entry-difference check pins).
  if v_new_affix is null or v_new_affix = v_old_affix
     or (v_new_affix ->> 'id') is distinct from ((v_new_affix ->> 'stat') || '_' || v_idx::text)
     or coalesce(v_new_affix ->> 'category', '') = 'activity'
  then
    raise exception 'Reforge payload rejected';
  end if;
  if (v_new_affix ->> 'stat') <> (v_old_affix ->> 'stat')
     and exists (
       select 1 from jsonb_array_elements(v_new_affixes) as e(affix)
        where (e.affix ->> 'stat') = (v_new_affix ->> 'stat')
          and (e.affix ->> 'id') <> (v_new_affix ->> 'id')
     )
  then
    raise exception 'Reforge payload rejected';
  end if;

  -- Cost: recomputed here from the lever table — the charging
  -- authority (mirrors reforgeCostFor in src/content/reforge.ts).
  v_scalar := public.cc_economy_config_number('reforgeScrapScalar', 1);
  v_core_cost := public.cc_economy_config_number('reforgeLegendaryCoreCost', 2);
  v_scrap_cost := ceil(public.cc_salvage_scrap(item.rarity, item.item_level) * 3 * v_scalar)::bigint;
  v_cores_cost := case when item.rarity = 'Legendary' then floor(v_core_cost)::integer else 0 end;

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  if coalesce(p.scrap, 0) < v_scrap_cost then raise exception 'Insufficient scrap'; end if;
  if coalesce(p.legendary_cores, 0) < v_cores_cost then raise exception 'Insufficient legendary cores'; end if;

  update public.profiles
     set scrap = scrap - v_scrap_cost,
         legendary_cores = legendary_cores - v_cores_cost
   where id = actor
   returning * into p;

  update public.item_instances
     set payload = p_new_payload,
         estimated_value = public.cc_compute_item_estimated_value(
           p_new_payload, item.kind, item.rarity, item.item_level)
   where id = item.id
   returning * into item;

  result := jsonb_build_object(
    'action_type', 'cc_reforge_item',
    'profile', public.cc_profile_snapshot(p),
    'item', to_jsonb(item),
    'old_affix', v_old_affix,
    'new_affix', v_new_affix,
    'scrap_charged', v_scrap_cost,
    'cores_charged', v_cores_cost
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_reforge_item', nonce, result);
  return result;
end;
$function$;

-- ─── 3. cc_compute_economy_metrics restated (0026 body + reforge) ────

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
      filter (where action_type = 'cc_reforge_item'), 0) as legendary_cores_destroyed_reforge
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

  v_minted_total := m.minted_roaming + m.minted_boss + m.minted_offline + m.minted_other;
  v_destroyed_total := m.destroyed_market_fees + m.destroyed_vendor
    + m.destroyed_resurrection + m.destroyed_respec
    + m.destroyed_boss_entry_fees + m.destroyed_boss_death_fees
    + rj.fees_destroyed;

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
    cache_keys_from_ads, cache_opens, cache_fragments_awarded,
    craft_jobs_completed, craft_units_completed, craft_xp_awarded,
    materials_destroyed_crafting, refined_units_produced,
    gear_items_crafted, crafted_market_sales, crafted_market_volume,
    repair_jobs_posted, repair_jobs_completed, repair_points_restored,
    repair_credits_volume, repair_fees_destroyed, repair_kits_consumed,
    repair_xp_awarded,
    legendaries_salvaged, legendary_cores_minted, legendary_cores_spent,
    reforges_completed, scrap_destroyed_reforge, legendary_cores_destroyed_reforge,
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
    m.cache_keys_from_ads, m.cache_opens, m.cache_fragments_awarded,
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
    cache_opens = excluded.cache_opens,
    cache_fragments_awarded = excluded.cache_fragments_awarded,
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
    computed_at = excluded.computed_at;

  return (select to_jsonb(e) from public.economy_metrics e where e.day = _day);
end;
$$;

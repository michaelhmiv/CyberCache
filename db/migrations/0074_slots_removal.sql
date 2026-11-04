-- 0074 — Data Slots removal: the vendor's slot machine is deleted
-- end-to-end (economy redesign brief, owner ruling 8 as applied to
-- the Run-2 slots slice: "plus SLOTS REMOVED (own slice)").
--
-- What this migration does:
--   1. Drops cc_slot_pull(uuid, text, integer) and
--      cc_slot_bundle(integer) — the machine's only ops (0049).
--   2. Deletes the 'slot_machine' odds table seed (outcomes first,
--      the 0065 order; the odds_outcomes FK cascades regardless).
--      No live draw path names it after this slice: every
--      cc_draw_odds call site in the live tree names
--      cache_primary_rarity or boss_attempt_* only.
--   3. Drops profiles.slot_pulls_day / slot_pulls_count — the
--      daily pull counter pair.
--   4. Deletes the four slot levers from economy_config
--      (slotDailyPullCap, slotBetTier1/2/3) — the TS registry
--      drops them in the same change.
--   5. Restates cc_compute_economy_metrics WITHOUT the slot
--      panel.
--
-- PLAYER-STATE AUDIT (by construction, from 0049's op body —
-- verified before anything was removed): a pull settles
-- ATOMICALLY in one transaction — the wager is destroyed and any
-- payout (credits / cache fragments / a budget-charged cache key /
-- flat-100% staple bundle batches) is credited in the same commit.
-- The machine keeps NO escrow, NO pending payout, NO balance of
-- its own anywhere. The only per-player state the system ever
-- wrote is the slot_pulls_day / slot_pulls_count counter pair
-- dropped in step 3 — a same-day rate-limit counter that carries
-- no value and reads as zero on any other day. Everything a player
-- ever won already sits in ordinary profile/inventory state owned
-- by its own systems (credits, cache_token_parts, cache_tokens,
-- consumable batches) and is untouched. The conversion rule is
-- therefore: nothing converts, because nothing is owed.
-- Historical records stay: verified_action_ledger 'cc_slot_pull'
-- rows and the economy_metrics slot columns (with their folded
-- history) are NOT deleted — they are the audit trail; new metric
-- rows simply stop writing the slot columns (defaults 0, which is
-- the truth: no pulls can occur).
--
-- PROVENANCE (collision law): cc_compute_economy_metrics chain
-- head is 0068 (verified: 0068's body = 0065's body + the
-- dispatch-reroll panel only, five hunks, all reroll). The body
-- below is 0068's VERBATIM apart from the slot panel: the fold's
-- seven slot fields, the `+ m.slot_credits_paid` minted term, the
-- `+ m.slot_wagered` destroyed term, and the slot columns in the
-- insert list, values list, and upsert assignments. The verbatim-
-- apart-from-the-panel discipline is pinned by
-- src/test/slotsRemoval.test.ts. cc_add_consumable_batch is NOT
-- restated: its chain head (0049) keeps 'slot_bundle' in the valid
-- consumable event types — historical consumable_events rows
-- carry that type and must keep validating; no new ones can be
-- created once cc_slot_pull is gone. Shipped migrations are
-- history and are never edited — the machine remains in their
-- text; the live tree loses it.

-- ---------------------------------------------------------------------
-- 1. The machine's ops.
-- ---------------------------------------------------------------------

drop function if exists public.cc_slot_pull(uuid, text, integer);
drop function if exists public.cc_slot_bundle(integer);

-- ---------------------------------------------------------------------
-- 2. The seeded odds table.
-- ---------------------------------------------------------------------

delete from public.odds_outcomes where table_id = 'slot_machine';
delete from public.odds_tables where id = 'slot_machine';

-- ---------------------------------------------------------------------
-- 3. The daily pull counter pair (no value; see audit above).
-- ---------------------------------------------------------------------

alter table public.profiles
  drop column if exists slot_pulls_day,
  drop column if exists slot_pulls_count;

-- ---------------------------------------------------------------------
-- 4. The slot levers' live values, if any were ever set.
-- ---------------------------------------------------------------------

delete from public.economy_config
 where key in ('slotDailyPullCap', 'slotBetTier1', 'slotBetTier2', 'slotBetTier3');

-- ---------------------------------------------------------------------
-- 5. cc_compute_economy_metrics — 0068 body verbatim apart from
--    the slot panel (see provenance note above).
-- ---------------------------------------------------------------------

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
  sj record;
  er record;
  sd record;
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
    count(*) filter (where action_type = 'cc_make_item') as cache_opens,
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
    -- Dispatch reroll sink (0068): credits burned re-dealing the
    -- board — its own breakout, folded into the destroyed total
    -- below (contracts/dispatch family).
    coalesce(sum((result_payload ->> 'credits_charged')::bigint)
      filter (where action_type = 'cc_reroll_dispatch_board'), 0) as destroyed_dispatch_rerolls,
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
      filter (where action_type = 'cc_enroll_research'), 0) as research_destroyed,
    -- Contracts board (0042): claim/set-bonus mints, reroll
    -- scrap destroyed, keys awarded, expired-unclaimed count
    -- (ledger + instance facts; minted joins minted_total).
      coalesce(sum((result_payload ->> 'credits_awarded')::bigint)
        filter (where action_type in ('cc_claim_contract_reward', 'cc_claim_contract_set_bonus')), 0) as minted_contracts,
      coalesce(count(*)
        filter (where action_type = 'cc_claim_contract_reward'), 0) as contracts_claimed,
      coalesce(count(*)
        filter (where action_type = 'cc_reroll_contract'), 0) as contract_rerolls,
      coalesce(sum((result_payload ->> 'scrap_charged')::bigint)
        filter (where action_type = 'cc_reroll_contract'), 0) as scrap_destroyed_contract_rerolls,
      coalesce(sum((result_payload ->> 'cache_keys_awarded')::bigint)
        filter (where action_type = 'cc_claim_contract_set_bonus'), 0) as contract_keys_awarded,
      (select count(*) from public.contract_instances ci
        where ci.status = 'active'
          and ((ci.period_kind = 'daily' and ci.period_key = (_day - 1)::text)
            or (ci.period_kind = 'weekly' and ci.period_key = (_day - 7)::text))) as contracts_expired_unclaimed,
    -- Manufacturer Standing (0043): turn-in points by manufacturer,
    -- rank-ups by manufacturer, tribute + desk purchases destroyed,
    -- orders fulfilled — all from the day's standing ledger rows.
    -- Turned-in legendaries deliberately do NOT join
    -- legendaries_salvaged (that meter is cc_recycle_item only): a
    -- turn-in mints no cores and pays no scrap.
    (select coalesce(jsonb_object_agg(manufacturer, points), '{}'::jsonb)
       from (select l2.result_payload ->> 'manufacturer' as manufacturer,
                    sum((l2.result_payload ->> 'standing_awarded')::bigint) as points
               from public.verified_action_ledger l2
              where l2.action_type = 'cc_turn_in_item'
                and l2.created_at >= v_start and l2.created_at < v_end
                and l2.result_payload ->> 'manufacturer' is not null
              group by 1) t) as standing_turn_in_points,
    count(*) filter (where action_type = 'cc_turn_in_item') as standing_turn_ins,
    count(*) filter (where action_type = 'cc_rank_up_manufacturer'
      and result_payload ->> 'tribute_item_id' is not null) as standing_tribute_items,
    coalesce(sum((result_payload ->> 'tribute_credits')::bigint)
      filter (where action_type = 'cc_rank_up_manufacturer'), 0) as standing_tribute_destroyed,
    coalesce(sum((result_payload ->> 'total_price')::bigint)
      filter (where action_type in ('cc_standing_buy', 'cc_standing_order_weapon')), 0) as standing_purchases_destroyed,
    (select coalesce(jsonb_object_agg(manufacturer, rank_ups), '{}'::jsonb)
       from (select l3.result_payload ->> 'manufacturer' as manufacturer,
                    count(*)::bigint as rank_ups
               from public.verified_action_ledger l3
              where l3.action_type = 'cc_rank_up_manufacturer'
                and l3.created_at >= v_start and l3.created_at < v_end
                and l3.result_payload ->> 'manufacturer' is not null
              group by 1) t) as standing_rank_ups,
    count(*) filter (where action_type = 'cc_standing_order_weapon') as standing_orders
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

  -- Shield-tech meters (0044): the repair panel's shape for the
  -- shield_tech profession — job-level facts from service_jobs at
  -- their terminal day (posted at posting day); Calibration Core
  -- consumption counted per board job plus per completed self-lane
  -- unit output, the same settle-day stamp the craft meters use.
  select
    (select count(*) from public.service_jobs j
      where j.profession_id = 'shield_tech'
        and j.created_at >= v_start and j.created_at < v_end) as jobs_posted,
    (select count(*) from public.service_jobs j
      where j.profession_id = 'shield_tech' and j.status = 'completed'
        and j.completed_at >= v_start and j.completed_at < v_end)::integer as jobs_completed,
    (select coalesce(sum(j.points_restored), 0) from public.service_jobs j
      where j.profession_id = 'shield_tech'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled')) as points_calibrated,
    (select coalesce(sum(j.paid_credits), 0) from public.service_jobs j
      where j.profession_id = 'shield_tech'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled'))::bigint as credits_volume,
    (select coalesce(sum(j.fee_credits), 0) from public.service_jobs j
      where j.profession_id = 'shield_tech'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled'))::bigint as fees_destroyed,
    (select coalesce(sum(j.xp_awarded), 0) from public.service_jobs j
      where j.profession_id = 'shield_tech'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled'))::bigint as xp_awarded,
    ((select coalesce(sum(jsonb_array_length(j.kits_consumed)), 0)
        from public.service_jobs j
       where j.profession_id = 'shield_tech'
         and j.completed_at >= v_start and j.completed_at < v_end
         and j.status in ('completed', 'cancelled'))
     + (select count(*) from public.craft_jobs j,
              lateral jsonb_array_elements(j.outputs) o
         where o ->> 'kind' = 'shieldtech'
           and (o ->> 'completedAtMs')::bigint >= (extract(epoch from v_start) * 1000)::bigint
           and (o ->> 'completedAtMs')::bigint < (extract(epoch from v_end) * 1000)::bigint
           and not coalesce((o ->> 'shieldUnavailable')::boolean, false)))::integer as cores_consumed
  into sj;

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


  -- Manufacturer Standing (0043): the day's use-drip points by
  -- manufacturer, from the daily counter table (the accrual writes
  -- no per-claim ledger rows by design).
  select coalesce(jsonb_object_agg(manufacturer, points), '{}'::jsonb) as drip_points
    into sd
    from (select d.manufacturer, sum(d.drip_points) as points
            from public.manufacturer_standing_daily d
           where d.utc_day = _day
           group by 1) t;

  v_minted_total := m.minted_roaming + m.minted_boss + m.minted_offline + m.minted_other
    + m.endless_credits_paid + m.minted_dispatch + m.minted_courier
    + m.minted_login_streak
    + m.minted_contracts;
  v_destroyed_total := m.destroyed_market_fees + m.destroyed_vendor
    + m.destroyed_resurrection + m.destroyed_respec
    + m.destroyed_boss_entry_fees + m.destroyed_boss_death_fees
    + rj.fees_destroyed + sj.fees_destroyed + m.endless_fees_destroyed + m.research_destroyed
    + m.standing_tribute_destroyed + m.standing_purchases_destroyed
    + m.destroyed_dispatch_rerolls;

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
    shieldtech_jobs_posted, shieldtech_jobs_completed,
    shieldtech_points_calibrated, shieldtech_credits_volume,
    shieldtech_fees_destroyed, shieldtech_cores_consumed,
    shieldtech_xp_awarded,
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
    credits_destroyed_dispatch_rerolls,
    extraction_passes, extraction_xp_awarded, materials_minted_extraction,
    credits_minted_login_streak, cache_fragments_from_login_streak,
    cache_keys_from_login_streak,
    research_enrollments_started, research_courses_completed,
    research_credits_destroyed,
    credits_minted_contracts, contracts_claimed, contracts_expired_unclaimed,
    contract_rerolls, contract_keys_awarded, scrap_destroyed_contract_rerolls,
    standing_points_awarded, standing_items_destroyed,
    standing_tribute_credits_destroyed, standing_credits_destroyed,
    standing_orders_fulfilled, standing_rank_ups,
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
    sj.jobs_posted, sj.jobs_completed, sj.points_calibrated,
    sj.credits_volume, sj.fees_destroyed, sj.cores_consumed,
    sj.xp_awarded,
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
    m.destroyed_dispatch_rerolls,
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
    m.minted_contracts, m.contracts_claimed::integer, m.contracts_expired_unclaimed::integer,
    m.contract_rerolls::integer, m.contract_keys_awarded::integer, m.scrap_destroyed_contract_rerolls,
    jsonb_build_object('turn_in', m.standing_turn_in_points, 'drip', coalesce(sd.drip_points, '{}'::jsonb)),
    (m.standing_turn_ins + m.standing_tribute_items)::integer,
    m.standing_tribute_destroyed,
    (m.standing_tribute_destroyed + m.standing_purchases_destroyed),
    m.standing_orders::integer, m.standing_rank_ups,
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
    shieldtech_jobs_posted = excluded.shieldtech_jobs_posted,
    shieldtech_jobs_completed = excluded.shieldtech_jobs_completed,
    shieldtech_points_calibrated = excluded.shieldtech_points_calibrated,
    shieldtech_credits_volume = excluded.shieldtech_credits_volume,
    shieldtech_fees_destroyed = excluded.shieldtech_fees_destroyed,
    shieldtech_cores_consumed = excluded.shieldtech_cores_consumed,
    shieldtech_xp_awarded = excluded.shieldtech_xp_awarded,
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
    credits_destroyed_dispatch_rerolls = excluded.credits_destroyed_dispatch_rerolls,
    extraction_passes = excluded.extraction_passes,
    extraction_xp_awarded = excluded.extraction_xp_awarded,
    materials_minted_extraction = excluded.materials_minted_extraction,
    credits_minted_login_streak = excluded.credits_minted_login_streak,
    cache_fragments_from_login_streak = excluded.cache_fragments_from_login_streak,
    cache_keys_from_login_streak = excluded.cache_keys_from_login_streak,
    research_enrollments_started = excluded.research_enrollments_started,
    research_courses_completed = excluded.research_courses_completed,
    research_credits_destroyed = excluded.research_credits_destroyed,
    credits_minted_contracts = excluded.credits_minted_contracts,
    contracts_claimed = excluded.contracts_claimed,
    contracts_expired_unclaimed = excluded.contracts_expired_unclaimed,
    contract_rerolls = excluded.contract_rerolls,
    contract_keys_awarded = excluded.contract_keys_awarded,
    scrap_destroyed_contract_rerolls = excluded.scrap_destroyed_contract_rerolls,
    standing_points_awarded = excluded.standing_points_awarded,
    standing_items_destroyed = excluded.standing_items_destroyed,
    standing_tribute_credits_destroyed = excluded.standing_tribute_credits_destroyed,
    standing_credits_destroyed = excluded.standing_credits_destroyed,
    standing_orders_fulfilled = excluded.standing_orders_fulfilled,
    standing_rank_ups = excluded.standing_rank_ups,
    computed_at = excluded.computed_at;

  return (select to_jsonb(e) from public.economy_metrics e where e.day = _day);
end;$$;

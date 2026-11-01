-- 0049 — Data Slots: the vendor's slot machine (run-2 final slice).
--
-- Design: design-briefs/expansion-pack/slot-machine.md; ruling R9
-- (DECISIONS.md): the strict table stands — credit RTP exactly
-- 50.5%, a 100-pull daily cap, verified accounts only.
--
-- Contents:
--   1. odds_tables / odds_outcomes seed for 'slot_machine' (version
--      1, the brief §2.2 weights). The odds are DATA, never a lever:
--      a retune is a reviewed migration, not a live dial.
--   2. profiles.slot_pulls_day / slot_pulls_count — the daily pull
--      counter (UTC-date keyed column pair, brief §2.10).
--   3. cc_slot_bundle(p_target) — the vendor-bundle composition
--      (§2.2.1): flat-100% staples only, the smallest combination
--      whose summed vendor price is >= the target, by the canonical
--      first-reach DP whose TS statement is composeSlotBundle in
--      src/content/slots.ts (parity-pinned by tests + harness).
--   4. cc_slot_pull(p_player_id, nonce, p_bet_tier) — the pull op on
--      the cc_make_item template: nonce replay, advisory lock,
--      verified gate, levered tier bet + daily pull cap, server draw
--      via cc_draw_odds('slot_machine'), payout in the same
--      transaction, one verified_action_ledger row
--      (action_type 'cc_slot_pull') whose result_payload the metrics
--      fold reads. A key outcome is charged against the daily cache
--      budget (cache_box_openings vs the cacheBoxDailyCap lever,
--      migration 0037 — the brief's interim key sub-cap lever was
--      never written; the cache lane landed first, brief §2.14);
--      when the budget is exhausted the pull pays 5 cache fragments
--      instead and the payload says so. Slots NEVER pay gear,
--      legendary cores, scrap, or essences (§2.2.2).
--   5. economy_metrics slot meters + restated
--      cc_compute_economy_metrics (0044 body + the slot panel).
--      Accounting follows the codebase's gross fold, as every prior
--      slice: credits_minted_slots (= slot credit payouts) enters
--      credits_minted_total and slot_credits_wagered enters
--      credits_destroyed_total, so net_credit_change stays the true
--      credit delta. credits_destroyed_slots carries the brief
--      §2.7 net figure (wagered - credit-paid, floored at 0 per day)
--      as a memo/breakout column; it is NOT separately folded into
--      credits_destroyed_total (folding the net there as well would
--      subtract every payout twice and break net honesty).
--   6. cc_add_consumable_batch restated (0045 body + the
--      'slot_bundle' event type in BOTH lists — the 0045 lesson:
--      the validated list and the consumable_events CHECK move
--      together or bundle grants fail at runtime).
--
-- Content owner: src/content/slots.ts (paytable TS twin, lever
-- defaults/clamps, bundle rule, fallback rule). Levers:
-- slotDailyPullCap (100, [0, 1000]; 0 closes the machine),
-- slotBetTier1/2/3 (50 / 250 / 1,000, [1, 100000]).

-- ---------------------------------------------------------------------------
-- 1. The slot_machine odds table (brief §2.2 — weights per 10,000).
--    Credit EV from this seed: 0.100 + 0.120 + 0.180 + 0.080 + 0.025
--    = 0.505 — credit RTP exactly 50.5% (R9), derived from the table
--    by the structural tests, never restated as a constant.
-- ---------------------------------------------------------------------------

insert into public.odds_tables (id, version, description, is_active)
values ('slot_machine', 1, 'Data Slots payout table v1 (brief §2.2, R9 strict table)', true)
on conflict (id) do nothing;

insert into public.odds_outcomes (table_id, outcome, weight, payload) values
  ('slot_machine', 'bust',          5480, '{"kind": "none"}'::jsonb),
  ('slot_machine', 'kickback',      2000, '{"kind": "credits", "multiplier": 0.5}'::jsonb),
  ('slot_machine', 'breakeven',     1200, '{"kind": "credits", "multiplier": 1}'::jsonb),
  ('slot_machine', 'triple',         600, '{"kind": "credits", "multiplier": 3}'::jsonb),
  ('slot_machine', 'vendor_bundle',  420, '{"kind": "bundle"}'::jsonb),
  ('slot_machine', 'fragment_drop',  200, '{"kind": "fragments", "fragments": 5}'::jsonb),
  ('slot_machine', 'ten_spot',        80, '{"kind": "credits", "multiplier": 10}'::jsonb),
  ('slot_machine', 'cache_key',       15, '{"kind": "key"}'::jsonb),
  ('slot_machine', 'jackpot',          5, '{"kind": "credits", "multiplier": 50}'::jsonb)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Daily pull counter on profiles (brief §2.10: a UTC-date keyed
--    column pair — slot_pulls_count is today's count only when
--    slot_pulls_day is today; any other day reads as zero).
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists slot_pulls_day date;
alter table public.profiles
  add column if not exists slot_pulls_count integer not null default 0;

-- ---------------------------------------------------------------------------
-- 3. cc_slot_bundle: compose the vendor bundle for a value target.
--    Staples only, from the ONE vendor catalog (cc_vendor_catalog,
--    pool 'staple' — the SQL twin of src/lib/vendor/catalog.ts), so
--    rotation stock and vendorExcluded crafter goods can never be
--    composed. Canonical first-reach DP, mirrored step for step by
--    composeSlotBundle in src/content/slots.ts: sums ascend, coins
--    iterate price-desc / item-key-asc, a sum is claimed by the
--    first coin that reaches it and never re-claimed; the answer is
--    the smallest reachable sum >= target.
-- ---------------------------------------------------------------------------

create or replace function public.cc_slot_bundle(p_target integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_keys text[];
  v_prices integer[];
  v_coin_count integer;
  v_cap integer;
  v_reach boolean[];
  v_prev integer[];
  v_coin integer[];
  v_counts integer[];
  s integer;
  ci integer;
  ns integer;
  v_total integer := null;
  cursor_sum integer;
  v_items jsonb;
begin
  if p_target is null or p_target <= 0 then
    return jsonb_build_object('items', '[]'::jsonb, 'total_value', 0, 'target', coalesce(p_target, 0));
  end if;

  select array_agg(item_key order by base_price desc, item_key asc),
         array_agg(base_price order by base_price desc, item_key asc)
    into v_keys, v_prices
    from public.cc_vendor_catalog()
   where pool = 'staple';
  v_coin_count := coalesce(array_length(v_prices, 1), 0);
  if v_coin_count = 0 then raise exception 'No vendor staples configured'; end if;

  -- One max-price coin past the target always contains a greedy
  -- fill, so a reachable sum >= target exists inside the bound.
  v_cap := p_target + v_prices[1];
  v_reach := array_fill(false, array[v_cap + 1]);
  v_prev := array_fill(-1, array[v_cap + 1]);
  v_coin := array_fill(-1, array[v_cap + 1]);
  v_reach[1] := true;  -- sum 0 lives at index 1

  for s in 0..v_cap loop
    if v_reach[s + 1] then
      for ci in 1..v_coin_count loop
        ns := s + v_prices[ci];
        if ns <= v_cap and not v_reach[ns + 1] then
          v_reach[ns + 1] := true;
          v_prev[ns + 1] := s;
          v_coin[ns + 1] := ci;
        end if;
      end loop;
    end if;
  end loop;

  for s in p_target..v_cap loop
    if v_reach[s + 1] then
      v_total := s;
      exit;
    end if;
  end loop;
  if v_total is null then
    raise exception 'No slot bundle composition reaches %', p_target;
  end if;

  v_counts := array_fill(0, array[v_coin_count]);
  cursor_sum := v_total;
  while cursor_sum > 0 loop
    ci := v_coin[cursor_sum + 1];
    v_counts[ci] := v_counts[ci] + 1;
    cursor_sum := v_prev[cursor_sum + 1];
  end loop;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'item_key', v_keys[g],
             'quantity', v_counts[g],
             'unit_price', v_prices[g])
           order by v_prices[g] desc, v_keys[g] asc), '[]'::jsonb)
    into v_items
    from generate_series(1, v_coin_count) as g
   where v_counts[g] > 0;

  return jsonb_build_object('items', v_items, 'total_value', v_total, 'target', p_target);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. cc_slot_pull: one pull = one server draw (brief §2.3).
--    Checks run before any charge; a pull that fails any check
--    charges nothing. The wager is destroyed and any credit prize
--    minted inside this transaction; both land on the ledger row.
-- ---------------------------------------------------------------------------

create or replace function public.cc_slot_pull(p_player_id uuid, nonce text, p_bet_tier integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  result jsonb;
  draw jsonb;
  v_day date := (now() at time zone 'utc')::date;
  v_bet integer;
  v_cap integer;
  v_pulls_today integer := 0;
  v_outcome text;
  v_kind text;
  v_multiplier numeric := 0;
  v_credits_paid bigint := 0;
  v_fragments_paid integer := 0;
  v_key_paid boolean := false;
  v_key_fallback boolean := false;
  v_bundle jsonb := null;
  v_bundle_items jsonb := '[]'::jsonb;
  v_bundle_value integer := 0;
  v_note text := null;
  v_cache_cap integer;
  v_opened_today integer := 0;
  item record;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  -- Verified accounts only (§2.5 / R9): the machine can mint, so it
  -- sits behind the same gate as every mint-capable economy op.
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  -- Bet: the levered fixed tier (brief §2.1/§2.6). Tier sizes move
  -- without re-tabling because payouts are multipliers / in-kind.
  v_bet := case p_bet_tier
    when 1 then least(100000, greatest(1, public.cc_economy_config_number('slotBetTier1', 50)::integer))
    when 2 then least(100000, greatest(1, public.cc_economy_config_number('slotBetTier2', 250)::integer))
    when 3 then least(100000, greatest(1, public.cc_economy_config_number('slotBetTier3', 1000)::integer))
    else null end;
  if v_bet is null then raise exception 'Unknown bet tier'; end if;

  -- Daily pull cap (§2.4): server-enforced, UTC-day keyed. A cap of
  -- 0 closes the machine without a deploy.
  v_cap := least(1000, greatest(0, public.cc_economy_config_number('slotDailyPullCap', 100)::integer));
  if v_cap <= 0 then raise exception 'The slot machine is closed'; end if;
  v_pulls_today := case when p.slot_pulls_day = v_day then p.slot_pulls_count else 0 end;
  if v_pulls_today >= v_cap then raise exception 'Daily slot pull limit reached'; end if;

  if p.credits < v_bet then raise exception 'Insufficient credits'; end if;

  -- Charge the bet (destroyed) and stamp the daily counter.
  update public.profiles
     set credits = credits - v_bet,
         slot_pulls_day = v_day,
         slot_pulls_count = v_pulls_today + 1
   where id = actor;

  -- The draw: the server's RNG over the seeded table (§2.3 step 4).
  draw := public.cc_draw_odds('slot_machine');
  v_outcome := draw ->> 'outcome';
  v_kind := draw -> 'payload' ->> 'kind';

  if v_kind = 'credits' then
    v_multiplier := coalesce((draw -> 'payload' ->> 'multiplier')::numeric, 0);
    v_credits_paid := floor(v_bet * v_multiplier)::bigint;
    if v_credits_paid > 0 then
      update public.profiles set credits = credits + v_credits_paid where id = actor;
    end if;
  elsif v_kind = 'bundle' then
    -- Vendor bundle (§2.2.1): staples at flat 100%, composed
    -- server-side and returned in the payload so the client shows
    -- exactly the items minted.
    v_bundle := public.cc_slot_bundle(v_bet * 2);
    v_bundle_items := coalesce(v_bundle -> 'items', '[]'::jsonb);
    v_bundle_value := coalesce((v_bundle ->> 'total_value')::integer, 0);
    for item in select * from jsonb_array_elements(v_bundle_items) loop
      perform public.cc_add_consumable_batch(
        actor,
        item.value ->> 'item_key',
        (item.value ->> 'quantity')::integer,
        100, 'vendor', null, null, 'slot_bundle',
        'Data Slots vendor bundle',
        jsonb_build_object('source', 'slot_machine', 'bet_tier', p_bet_tier, 'bet_credits', v_bet));
    end loop;
  elsif v_kind = 'fragments' then
    v_fragments_paid := coalesce((draw -> 'payload' ->> 'fragments')::integer, 5);
    update public.profiles set cache_token_parts = cache_token_parts + v_fragments_paid where id = actor;
  elsif v_kind = 'key' then
    -- Cache key (§2.4): charged against the daily cache budget —
    -- the same openings count cc_make_item enforces (0037). The
    -- key itself is a stock grant; it consumes no opening. Budget
    -- exhausted: pay the conversion-equal 5 fragments instead.
    v_cache_cap := least(30, greatest(1, public.cc_economy_config_number('cacheBoxDailyCap', 10)::integer));
    select coalesce(count(*), 0)::integer into v_opened_today
      from public.cache_box_openings
     where player_id = actor and open_day = v_day;
    if v_opened_today < v_cache_cap then
      update public.profiles set cache_tokens = cache_tokens + 1 where id = actor;
      v_key_paid := true;
    else
      v_fragments_paid := 5;
      v_key_fallback := true;
      v_note := 'Cache budget full — paid in fragments';
      update public.profiles set cache_token_parts = cache_token_parts + v_fragments_paid where id = actor;
    end if;
  end if;

  -- The cache budget view rides every result (the panel renders it
  -- without a second read); openings never change inside a pull.
  if v_kind is distinct from 'key' then
    v_cache_cap := least(30, greatest(1, public.cc_economy_config_number('cacheBoxDailyCap', 10)::integer));
    select coalesce(count(*), 0)::integer into v_opened_today
      from public.cache_box_openings
     where player_id = actor and open_day = v_day;
  end if;

  select * into p from public.profiles where id = actor;

  result := jsonb_build_object(
    'action_type', 'cc_slot_pull',
    'profile', public.cc_profile_snapshot(p),
    'odds', draw,
    'bet_tier', p_bet_tier,
    'bet_credits', v_bet,
    'outcome', v_outcome,
    'payout', jsonb_build_object(
      'kind', v_kind,
      'credits_paid', v_credits_paid,
      'fragments_paid', v_fragments_paid,
      'key_paid', v_key_paid,
      'key_fallback', v_key_fallback,
      'bundle', v_bundle_items,
      'bundle_value', v_bundle_value,
      'note', v_note),
    'pulls_today', v_pulls_today + 1,
    'pulls_remaining', greatest(0, v_cap - (v_pulls_today + 1)),
    'cap', v_cap,
    'cache_budget', jsonb_build_object(
      'opened_today', v_opened_today,
      'cap', v_cache_cap,
      'remaining', greatest(0, v_cache_cap - v_opened_today)));

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_slot_pull', nonce, result);

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Economy meters (brief §2.7) + the restated compute function
--    (0044 body + the slot panel; every prior panel carried
--    verbatim — research, contracts, standing, shield-tech folds
--    included, key-checked in the PR).
-- ---------------------------------------------------------------------------

alter table public.economy_metrics
  add column if not exists slot_pulls integer not null default 0;
alter table public.economy_metrics
  add column if not exists slot_credits_wagered bigint not null default 0;
alter table public.economy_metrics
  add column if not exists slot_credits_paid bigint not null default 0;
alter table public.economy_metrics
  add column if not exists slot_bundles_paid integer not null default 0;
alter table public.economy_metrics
  add column if not exists slot_fragments_paid bigint not null default 0;
alter table public.economy_metrics
  add column if not exists slot_keys_paid integer not null default 0;
alter table public.economy_metrics
  add column if not exists slot_fragment_fallbacks integer not null default 0;
alter table public.economy_metrics
  add column if not exists credits_minted_slots bigint not null default 0;
alter table public.economy_metrics
  add column if not exists credits_destroyed_slots bigint not null default 0;

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
    count(*) filter (where action_type = 'cc_standing_order_weapon') as standing_orders,
    -- Data Slots (0049): pulls, wagered / paid credits, and the
    -- in-kind counts — all ledger facts from cc_slot_pull result
    -- payloads (the fold reads the same fields the op writes).
    count(*) filter (where action_type = 'cc_slot_pull') as slot_pulls,
    coalesce(sum((result_payload ->> 'bet_credits')::bigint)
      filter (where action_type = 'cc_slot_pull'), 0) as slot_wagered,
    coalesce(sum((result_payload -> 'payout' ->> 'credits_paid')::bigint)
      filter (where action_type = 'cc_slot_pull'), 0) as slot_credits_paid,
    count(*) filter (where action_type = 'cc_slot_pull'
      and result_payload ->> 'outcome' = 'vendor_bundle') as slot_bundles,
    coalesce(sum((result_payload -> 'payout' ->> 'fragments_paid')::bigint)
      filter (where action_type = 'cc_slot_pull'), 0) as slot_fragments,
    count(*) filter (where action_type = 'cc_slot_pull'
      and coalesce((result_payload -> 'payout' ->> 'key_paid')::boolean, false)) as slot_keys,
    count(*) filter (where action_type = 'cc_slot_pull'
      and coalesce((result_payload -> 'payout' ->> 'key_fallback')::boolean, false)) as slot_fallbacks
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
    + m.minted_contracts
    + m.slot_credits_paid;
  v_destroyed_total := m.destroyed_market_fees + m.destroyed_vendor
    + m.destroyed_resurrection + m.destroyed_respec
    + m.destroyed_boss_entry_fees + m.destroyed_boss_death_fees
    + rj.fees_destroyed + sj.fees_destroyed + m.endless_fees_destroyed + m.research_destroyed
    + m.standing_tribute_destroyed + m.standing_purchases_destroyed
    + m.slot_wagered;

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
    slot_pulls, slot_credits_wagered, slot_credits_paid,
    slot_bundles_paid, slot_fragments_paid, slot_keys_paid,
    slot_fragment_fallbacks, credits_minted_slots, credits_destroyed_slots,
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
    m.slot_pulls::integer, m.slot_wagered, m.slot_credits_paid,
    m.slot_bundles::integer, m.slot_fragments, m.slot_keys::integer,
    m.slot_fallbacks::integer, m.slot_credits_paid,
    greatest(0, m.slot_wagered - m.slot_credits_paid),
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
    slot_pulls = excluded.slot_pulls,
    slot_credits_wagered = excluded.slot_credits_wagered,
    slot_credits_paid = excluded.slot_credits_paid,
    slot_bundles_paid = excluded.slot_bundles_paid,
    slot_fragments_paid = excluded.slot_fragments_paid,
    slot_keys_paid = excluded.slot_keys_paid,
    slot_fragment_fallbacks = excluded.slot_fragment_fallbacks,
    credits_minted_slots = excluded.credits_minted_slots,
    credits_destroyed_slots = excluded.credits_destroyed_slots,
    computed_at = excluded.computed_at;

  return (select to_jsonb(e) from public.economy_metrics e where e.day = _day);
end;$$;

-- ---------------------------------------------------------------------------
-- Restated cc_add_consumable_batch (0045 body + the slot_bundle
-- event type, 0049) — the 0043/0044/0045 precedent: a consumable
-- flow that writes its own event type extends the validated list
-- and the consumable_events CHECK together. Sole change: the two
-- lists gain 'slot_bundle'. The function body is otherwise the 0045
-- body verbatim (diff-proven in the PR).
-- ---------------------------------------------------------------------------

alter table public.consumable_events
  drop constraint consumable_events_event_type_check,
  add constraint consumable_events_event_type_check
    check ((event_type = any (array['vendor_buy'::text, 'crafted'::text, 'market_buy'::text, 'market_sell'::text, 'used'::text, 'expired'::text, 'admin_adjust'::text, 'reset'::text, 'standing_buy'::text, 'shieldtech_refund'::text, 'repair_refund'::text, 'slot_bundle'::text])));

CREATE OR REPLACE FUNCTION public.cc_add_consumable_batch(p_owner_id uuid, p_item_key text, p_quantity integer, p_quality_percent numeric DEFAULT 100, p_origin text DEFAULT 'vendor'::text, p_creator_id uuid DEFAULT NULL::uuid, p_source_recipe_id text DEFAULT NULL::text, p_event_type text DEFAULT 'vendor_buy'::text, p_reason text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  qty integer := greatest(1, coalesce(p_quantity, 1));
  q numeric := greatest(1, least(250, coalesce(p_quality_percent, 100)));
  batch_id uuid;
begin
  if p_owner_id is null then raise exception 'owner_id is required'; end if;
  if p_item_key is null or length(trim(p_item_key)) = 0 then raise exception 'item_key is required'; end if;
  if p_origin not in ('vendor', 'crafted', 'market', 'reward', 'admin', 'standing') then raise exception 'invalid consumable origin'; end if;
  if p_event_type not in ('vendor_buy', 'crafted', 'market_buy', 'market_sell', 'used', 'expired', 'admin_adjust', 'reset', 'standing_buy', 'shieldtech_refund', 'repair_refund', 'slot_bundle') then raise exception 'invalid consumable event type'; end if;

  select b.id into batch_id
  from public.consumable_batches b
  where b.owner_user_id = p_owner_id
    and b.consumable_type = p_item_key
    and b.quality_percent = q
    and b.origin = p_origin
    and coalesce(b.creator_user_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_creator_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and coalesce(b.source_recipe_id, '') = coalesce(p_source_recipe_id, '')
  for update
  limit 1;

  if batch_id is null then
    insert into public.consumable_batches(owner_user_id, consumable_type, quality_percent, quantity, origin, creator_user_id, source_recipe_id, metadata)
    values (p_owner_id, p_item_key, q, qty, p_origin, p_creator_id, p_source_recipe_id, coalesce(p_metadata, '{}'::jsonb))
    returning id into batch_id;
  else
    update public.consumable_batches
    set quantity = quantity + qty,
        metadata = coalesce(public.consumable_batches.metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
        updated_at = now()
    where id = batch_id;
  end if;

  insert into public.consumable_events(user_id, batch_id, consumable_type, quantity_delta, quality_percent, event_type, reason, metadata)
  values (p_owner_id, batch_id, p_item_key, qty, q, p_event_type, p_reason, coalesce(p_metadata, '{}'::jsonb));

  return batch_id;
end;
$function$;

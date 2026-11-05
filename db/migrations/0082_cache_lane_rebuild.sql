-- =====================================================================
-- 0082 — Cache lane rebuild: the daily budget dies, fragments are
-- abolished, roaming pays whole keys (owner ruling 2026-11-04;
-- content owner: src/content/cacheLane.ts).
--
-- OWNER RULINGS THIS MIGRATION EXECUTES:
--   * "Don't put daily limits on cache box openings. Just cache
--     box openings via ads" — the 0037 daily budget model dies
--     entirely: no daily cap, no free daily box, no "openings
--     today", no 00:00 UTC reset. Every opening is paid — 1 cache
--     key OR one rewarded-ad attestation — player's choice per
--     opening, uncapped.
--   * "So why are we even doing fragments if you are dropping
--     keys?" — fragments fail the owner's filler test (one sink,
--     no decision) and are ABOLISHED as a currency:
--     profiles.cache_token_parts stops accruing and stops being
--     displayed; the 5:1 auto-conversion is deleted; no reward
--     pays fragments; roaming pays WHOLE KEYS directly at
--     0.00012/tick, settled fractionally through a new silent
--     remainder bank (profiles.cache_key_remainder) exactly like
--     the other claim currencies (0009/0010 pattern).
--   * BALANCES ARE GRANDFATHERED: nobody loses keys. Stranded
--     fragment balances convert to keys at 5:1 floor (section 3);
--     sub-5 remainders retire with the currency (each < 1 key).
--     Active fragment MARKET listings are cancelled first and
--     their escrow returns to the seller's balance, so escrowed
--     fragments convert too — nobody's listed value evaporates.
--
-- FUNCTION PROVENANCE (chain heads in THIS branch, master e529b40):
--   cc_make_item                  <- 0037 (prior: 0031, 0004)
--   cc_apply_chef_rewards         <- 0069 (prior: 0034, 0014, 0010, 0009, 0007)
--   cc_settle_offline_roaming     <- 0069 (prior: 0034, 0015, 0012, 0010, 0009, 0007)
--   cc_record_login_streak_day    <- 0036 (sole definition)
--   cc_contract_terms             <- 0042 (sole definition)
--   cc_claim_contract_reward      <- 0042 (sole definition)
--   cc_profile_snapshot           <- 0069 (prior: 0031, 0030, 0026, 0021, 0004)
--   cc_compute_economy_metrics    <- 0074 (long chain; restated
--                                    verbatim + the one new fold)
--   cc_market_create_fragment     <- 0050 (sole definition) DROPPED
-- RECONCILIATION NOTE FOR THE APPLIER: if migrations 0079 (streak
-- true-claim, PR #386), 0080 (auto-salvage), or 0081 (pure player
-- market, PR #393) landed after this branch was cut, re-check the
-- chain heads above against the live catalog before applying — in
-- particular cc_record_login_streak_day, whose 0079 restatement
-- must keep its true-claim shape: the 0082 delta on that function
-- is only "no fragment credit, no streakFragmentScalar read,
-- claims record fragments_awarded 0".
--
-- The cache_token_parts COLUMN stays (zeroed): cc_accept_listing
-- (0064) and the quick-buy fill still name it in branches that are
-- unreachable once no fragment listing can exist; dropping the
-- column would break those bodies for zero player benefit.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. New remainder bank + new economy meter column.
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists cache_key_remainder numeric not null default 0;

alter table public.economy_metrics
  add column if not exists cache_keys_from_roaming bigint not null default 0;

-- ---------------------------------------------------------------------
-- 2. Fragment market listings retire: cancel every ACTIVE fragment
--    listing and return its escrowed quantity to the seller's
--    fragment balance (converted in section 3 like everyone else).
-- ---------------------------------------------------------------------
update public.profiles p
   set cache_token_parts = coalesce(p.cache_token_parts, 0) + l.quantity
  from public.market_listings l
 where l.seller_user_id = p.id
   and l.listing_kind = 'fragment'
   and l.status = 'active';

update public.market_listings
   set status = 'cancelled'
 where listing_kind = 'fragment'
   and status = 'active';

-- ---------------------------------------------------------------------
-- 3. GRANDFATHERED CONVERSION: every stranded fragment balance
--    becomes whole keys at 5:1 floor; parts are zeroed (the sub-5
--    remainder retires with the abolished currency).
-- ---------------------------------------------------------------------
update public.profiles
   set cache_tokens = coalesce(cache_tokens, 0) + floor(coalesce(cache_token_parts, 0) / 5)::integer,
       cache_token_parts = 0
 where coalesce(cache_token_parts, 0) > 0;

-- ---------------------------------------------------------------------
-- 4. Economy levers: the dead die, the key lever is born.
--    (Rows may not exist — a missing row resolves to the code
--    default, which for cacheKeyChance is the same 0.00012.)
-- ---------------------------------------------------------------------
delete from public.economy_config
 where key in ('fragmentChance', 'cacheBoxDailyCap', 'streakFragmentScalar');

insert into public.economy_config (key, value, updated_at, updated_by)
values ('cacheKeyChance', '0.00012'::jsonb, now(), 'migration-0082')
on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;

-- ---------------------------------------------------------------------
-- 5. Seeded reward definitions: fragment legs zeroed at the source.
--    (cc_contract_terms also stops reading fragment_parts_daily;
--    cc_record_login_streak_day stops reading d.fragments — the
--    zeroes keep the seeded tables truthful for any other reader.)
-- ---------------------------------------------------------------------
update public.login_streak_reward_definitions set fragments = 0 where fragments <> 0;
update public.contract_template_definitions set fragment_parts_daily = 0 where fragment_parts_daily <> 0;

-- Legacy battle-result odds (cc_battle_result, 0004): the victory
-- payloads paid 1 fragment. Zeroed — the function coalesces the
-- reward to 0 and the path pays no fragments ever again.
update public.odds_outcomes
   set payload = jsonb_set(payload, '{fragment_reward}', '0'::jsonb)
 where table_id like 'boss_attempt%'
   and coalesce((payload ->> 'fragment_reward')::integer, 0) <> 0;

-- ---------------------------------------------------------------------
-- 6. The fragment listing function is dropped. Both write twins
--    refuse new fragment listings before any SQL.
-- ---------------------------------------------------------------------
drop function if exists public.cc_market_create_fragment(uuid, text, integer, bigint);


-- ---------------------------------------------------------------------
-- 7. cc_make_item restated from 0037: payment resolution only —
--    'ad' (attested, ad unit id required) or 'key' (stock checked
--    and debited). No cap read, no openings count, no free-first.
--    The 0031 cache-quality computation and the draw are untouched.
-- ---------------------------------------------------------------------

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


-- ---------------------------------------------------------------------
-- 8. cc_apply_chef_rewards restated from 0069: the _fragments
--    argument becomes _keys (whole keys, added directly), with a
--    trailing _keys_remainder bank argument. The old signature is
--    dropped first so no overload keeps the fragment applier alive.
-- ---------------------------------------------------------------------
drop function if exists public.cc_apply_chef_rewards(uuid, bigint, bigint, bigint, integer, jsonb, jsonb, integer, bigint, text, numeric, numeric, numeric);


create or replace function public.cc_apply_chef_rewards(
  _player_id uuid,
  _credits bigint,
  _scrap bigint,
  _xp bigint,
  _keys integer,
  _materials jsonb,
  _essences jsonb,
  _kills integer,
  _tick_count bigint,
  _area_id text,
  _scrap_remainder numeric default null,
  _credits_remainder numeric default null,
  _xp_remainder numeric default null,
  _keys_remainder numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  result jsonb;
  xp_state jsonb;
  new_level integer;
  new_xp bigint;
  activity_row public.active_actions%rowtype;
  nonce_key text;
  prior jsonb;
  next_materials jsonb;
  next_essences jsonb;
  mat_key text;
  mat_val integer;
  ess_key text;
  ess_val integer;
begin
  select * into p from public.profiles where id = _player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  nonce_key := _player_id::text || ':chef:' || _tick_count::text;
  select vl.result_payload into prior
    from public.verified_action_ledger vl
   where vl.user_id = _player_id
     and vl.idempotency_key = nonce_key;
  if prior is not null then return prior; end if;

  if _tick_count <= p.last_claimed_tick then
    raise exception 'tick_count % is not after last claimed tick %', _tick_count, p.last_claimed_tick;
  end if;

  select * into activity_row
    from public.active_actions
   where user_id = _player_id
   for update;
  if not found or activity_row.active_action <> 'roaming_loot' or activity_row.target_id <> _area_id then
    raise warning 'No active roaming activity for area %, proceeding anyway', _area_id;
  end if;

  xp_state := public.cc_apply_xp(p.player_level, p.player_xp, _xp);
  new_level := (xp_state ->> 'player_level')::integer;
  new_xp := (xp_state ->> 'player_xp')::bigint;

  next_materials := coalesce(p.materials, '{}'::jsonb);
  for mat_key, mat_val in
    select key, value::integer from jsonb_each_text(coalesce(_materials, '{}'::jsonb))
  loop
    next_materials := jsonb_set(next_materials, array[mat_key], to_jsonb(coalesce((next_materials ->> mat_key)::integer, 0) + mat_val), true);
  end loop;
  -- 0069: the claim's scrap leg lands in the unified materials stock.
  next_materials := jsonb_set(next_materials, '{Scrap}', to_jsonb(coalesce((next_materials ->> 'Scrap')::bigint, 0) + _scrap), true);

  next_essences := coalesce(p.essences, '{}'::jsonb);
  for ess_key, ess_val in
    select key, value::integer from jsonb_each_text(coalesce(_essences, '{}'::jsonb))
  loop
    next_essences := jsonb_set(next_essences, array[ess_key], to_jsonb(coalesce((next_essences ->> ess_key)::integer, 0) + ess_val), true);
  end loop;

  -- 0082: fragments abolished — whole keys land directly and the
  -- fractional key remainder banks (the UPDATE below).
  update public.profiles
     set credits = credits + _credits,
         credits_remainder = coalesce(_credits_remainder, credits_remainder),
         scrap_remainder = coalesce(_scrap_remainder, scrap_remainder),
         player_level = new_level,
         player_xp = new_xp,
         xp_remainder = coalesce(_xp_remainder, xp_remainder),
         cache_tokens = cache_tokens + _keys,
         cache_key_remainder = coalesce(_keys_remainder, cache_key_remainder),
         materials = next_materials,
         essences = next_essences,
         last_claimed_tick = _tick_count,
         last_roaming_settled_at = now(),
         updated_at = now()
   where id = _player_id
   returning * into p;

  update public.active_actions
     set last_heartbeat_at = now(),
         activity_payload = coalesce(activity_payload, '{}'::jsonb) || jsonb_build_object('last_claim_ticks', 1, 'last_claim_at', (extract(epoch from now()) * 1000)::bigint)
   where user_id = _player_id;

  result := jsonb_build_object(
    'action_type', 'cc_apply_chef_rewards',
    'profile', public.cc_profile_snapshot(p),
    -- 0014: the area this claim farmed, for the mastery trigger.
    'area_id', _area_id,
    'rewards', jsonb_build_object(
      'credits_awarded', _credits,
      'scrap_awarded', _scrap,
      'xp_awarded', _xp,
      'cache_keys_awarded', _keys,
      'materials', coalesce(_materials, '{}'::jsonb),
      'essences', coalesce(_essences, '{}'::jsonb),
      'kills_recorded', _kills
    )
  );

  -- 0034: lifetime kill record — this claim's kills land under the
  -- weapon the hunter currently holds (derived server-side).
  perform public.cc_record_kill_stats(_player_id, _kills);

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (_player_id, 'cc_apply_chef_rewards', nonce_key, result);

  return result;
end;
$$;


-- ---------------------------------------------------------------------
-- 9. cc_settle_offline_roaming restated from 0069: same key shape
--    as the foreground applier. Old signature dropped first.
-- ---------------------------------------------------------------------
drop function if exists public.cc_settle_offline_roaming(uuid, text, bigint, bigint, bigint, integer, jsonb, jsonb, integer, numeric, numeric, numeric, jsonb, numeric);


create or replace function public.cc_settle_offline_roaming(
  _player_id uuid,
  _settlement_nonce text,
  _credits bigint,
  _scrap bigint,
  _xp bigint,
  _keys integer,
  _materials jsonb,
  _essences jsonb,
  _kills integer,
  _scrap_remainder numeric default null,
  _credits_remainder numeric default null,
  _xp_remainder numeric default null,
  _keys_remainder numeric default null,
  _consumed_consumables jsonb default null,
  _cap_hours numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := _player_id;
  p public.profiles%rowtype;
  aa public.active_actions%rowtype;
  prior jsonb;
  settle_from timestamptz;
  now_ts timestamptz := now();
  raw_elapsed_ms bigint;
  cap_ms bigint;
  elapsed_ms bigint;
  cap_reached boolean;
  ticks_requested integer;
  new_tick_count bigint;
  tick_ms constant integer := 3000;
  xp_state jsonb;
  new_level integer;
  new_xp bigint;
  next_materials jsonb;
  next_essences jsonb;
  next_consumables jsonb;
  applied_consumables jsonb := '{}'::jsonb;
  cons_key text;
  cons_val integer;
  applied_val integer;
  mat_key text;
  mat_val integer;
  ess_key text;
  ess_val integer;
  nonce_key text;
  result jsonb;
begin
  if actor is null then raise exception '_player_id is required'; end if;
  if _settlement_nonce is null or length(trim(_settlement_nonce)) < 8 then
    raise exception 'settlement_nonce is required (min 8 chars)';
  end if;

  nonce_key := actor::text || ':offline_settle:' || _settlement_nonce;
  select vl.result_payload into prior
    from public.verified_action_ledger vl
   where vl.user_id = actor
     and vl.idempotency_key = nonce_key;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  select * into aa from public.active_actions where user_id = actor for update;
  if not found or aa.active_action <> 'roaming_loot' then
    return jsonb_build_object('settled', false, 'reason', 'not_roaming', 'active_action', coalesce(aa.active_action, 'none'));
  end if;

  settle_from := coalesce(p.last_roaming_settled_at, aa.started_at);
  if settle_from is null then
    return jsonb_build_object('settled', false, 'reason', 'no_elapsed', 'detail', 'No settlement start timestamp available');
  end if;

  raw_elapsed_ms := (extract(epoch from now_ts) * 1000)::bigint - (extract(epoch from settle_from) * 1000)::bigint;
  if raw_elapsed_ms < 0 then raw_elapsed_ms := 0; end if;

  -- 0015: the route's server-derived earned cap wins over the stored
  -- preference whenever it is supplied.
  cap_ms := (greatest(0.25, coalesce(_cap_hours, p.offline_cap_hours, 2)) * 3600 * 1000)::bigint;
  cap_reached := raw_elapsed_ms > cap_ms;
  elapsed_ms := least(raw_elapsed_ms, cap_ms);

  ticks_requested := floor(elapsed_ms / tick_ms)::integer;
  if ticks_requested <= 0 then
    return jsonb_build_object('settled', false, 'reason', 'no_elapsed', 'elapsed_ms', elapsed_ms);
  end if;

  new_tick_count := coalesce(p.last_claimed_tick, 0) + ticks_requested;

  xp_state := public.cc_apply_xp(p.player_level, p.player_xp, _xp);
  new_level := (xp_state ->> 'player_level')::integer;
  new_xp := (xp_state ->> 'player_xp')::bigint;

  next_materials := coalesce(p.materials, '{}'::jsonb);
  for mat_key, mat_val in select key, value::integer from jsonb_each_text(coalesce(_materials, '{}'::jsonb)) loop
    next_materials := jsonb_set(next_materials, array[mat_key], to_jsonb(coalesce((next_materials ->> mat_key)::integer, 0) + mat_val), true);
  end loop;
  -- 0069: the settlement's scrap leg lands in the unified materials stock.
  next_materials := jsonb_set(next_materials, '{Scrap}', to_jsonb(coalesce((next_materials ->> 'Scrap')::bigint, 0) + _scrap), true);

  next_essences := coalesce(p.essences, '{}'::jsonb);
  for ess_key, ess_val in select key, value::integer from jsonb_each_text(coalesce(_essences, '{}'::jsonb)) loop
    next_essences := jsonb_set(next_essences, array[ess_key], to_jsonb(coalesce((next_essences ->> ess_key)::integer, 0) + ess_val), true);
  end loop;

  -- 0012: fold the engine's consumed set into the settlement, clamped
  -- per type to the owned count (same rule as
  -- cc_consume_roaming_consumables). The SRF columns are aliased for
  -- the same reason as in that function (0007 note): unaliased
  -- key/value output columns collide with the loop variables.
  next_consumables := coalesce(p.consumables, '{}'::jsonb);
  for cons_key, cons_val in select e.key, e.value::integer from jsonb_each_text(coalesce(_consumed_consumables, '{}'::jsonb)) as e loop
    if cons_val <= 0 then continue; end if;
    applied_val := least(cons_val, coalesce((next_consumables ->> cons_key)::integer, 0));
    if applied_val <= 0 then continue; end if;
    next_consumables := jsonb_set(next_consumables, array[cons_key], to_jsonb(coalesce((next_consumables ->> cons_key)::integer, 0) - applied_val), true);
    applied_consumables := jsonb_set(applied_consumables, array[cons_key], to_jsonb(applied_val), true);
  end loop;

  -- 0082: fragments abolished — whole keys land directly and the
  -- fractional key remainder banks (the UPDATE below).
  update public.profiles
     set credits = credits + _credits,
         credits_remainder = coalesce(_credits_remainder, credits_remainder),
         scrap_remainder = coalesce(_scrap_remainder, scrap_remainder),
         player_level = new_level,
         player_xp = new_xp,
         xp_remainder = coalesce(_xp_remainder, xp_remainder),
         cache_tokens = cache_tokens + _keys,
         cache_key_remainder = coalesce(_keys_remainder, cache_key_remainder),
         materials = next_materials,
         essences = next_essences,
         consumables = next_consumables,
         last_claimed_tick = new_tick_count,
         last_roaming_settled_at = now_ts,
         last_settlement_nonce = _settlement_nonce,
         updated_at = now_ts
   where id = actor
   returning * into p;

  -- 0012: audit rows for the applied decrements (same shape the
  -- foreground consumption function writes).
  for cons_key, applied_val in select e.key, e.value::integer from jsonb_each_text(applied_consumables) as e loop
    insert into consumable_events (
      user_id, consumable_type, quantity_delta,
      event_type, activity_type, reason
    )
    values (
      actor, cons_key, -applied_val,
      'used', 'roaming_loot',
      'Consumed during offline settlement in ' || coalesce(aa.target_id, '')
    );
  end loop;

  update public.active_actions
     set last_heartbeat_at = now_ts,
         activity_payload = coalesce(activity_payload, '{}'::jsonb) || jsonb_build_object('last_offline_settle_at', (extract(epoch from now_ts) * 1000)::bigint, 'last_offline_settle_ticks', ticks_requested)
   where user_id = actor;

  result := jsonb_build_object(
    'settled', true,
    'atomic', true,
    'area_id', aa.target_id,
    'settle_from', settle_from,
    'settled_at', now_ts,
    'raw_elapsed_ms', raw_elapsed_ms,
    'elapsed_ms', elapsed_ms,
    'capped_ms', cap_ms,
    'cap_reached', cap_reached,
    'cap_hours', coalesce(_cap_hours, p.offline_cap_hours, 2)::numeric,
    'ticks_requested', ticks_requested,
    'ticks_settled', ticks_requested,
    'new_tick_count', new_tick_count,
    'start_tick', new_tick_count - ticks_requested,
    'end_tick', new_tick_count,
    'profile', public.cc_profile_snapshot(p),
    'rewards', jsonb_build_object('credits_awarded', _credits, 'scrap_awarded', _scrap, 'xp_awarded', _xp, 'cache_keys_awarded', _keys, 'materials', coalesce(_materials, '{}'::jsonb), 'essences', coalesce(_essences, '{}'::jsonb), 'kills_recorded', _kills, 'ticks', ticks_requested),
    'consumed_consumables', applied_consumables
  );

  -- 0034: lifetime kill record — same rule as the foreground claim.
  perform public.cc_record_kill_stats(actor, _kills);

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_settle_offline_roaming', nonce_key, result);

  return result;
end;
$$;


-- ---------------------------------------------------------------------
-- 10. cc_record_login_streak_day restated from 0036: the ladder
--     pays credits + the day-7 key only. Claims record
--     fragments_awarded 0 (the column stays as history).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_record_login_streak_day(
  p_player_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (p_now at time zone 'UTC')::date;
  p public.profiles%rowtype;
  s public.login_streak_state%rowtype;
  c public.login_streak_claims%rowtype;
  d public.login_streak_reward_definitions%rowtype;
  v_streak integer;
  v_cycle_day integer;
  v_tier integer;
  v_credits bigint;
  v_keys integer;
  result jsonb;
begin
  if p_player_id is null then raise exception 'Authentication required'; end if;

  perform pg_advisory_xact_lock(hashtext(p_player_id::text));

  select * into p from public.profiles where id = p_player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  -- Exactly-once: today's claim row IS the idempotency anchor. A
  -- replay returns the stored claim and grants nothing again.
  select * into c from public.login_streak_claims
  where player_id = p_player_id and claim_day = v_today;
  if found then
    return jsonb_build_object(
      'action_type', 'cc_login_streak_claim',
      'already_claimed', true,
      'day', c.claim_day,
      'streak_length', c.streak_length,
      'cycle_day', c.cycle_day,
      'tier', c.tier,
      'credits_awarded', c.credits_awarded,
      'fragments_awarded', c.fragments_awarded,
      'cache_keys_awarded', c.cache_keys_awarded,
      'profile', public.cc_profile_snapshot(p)
    );
  end if;

  select * into s from public.login_streak_state where player_id = p_player_id;

  -- Streak arithmetic (mirrors loginStreakLengthAfter in the
  -- content module): yesterday extends, any older gap restarts.
  if s.player_id is not null and s.last_claim_day = v_today - 1 then
    v_streak := s.current_streak + 1;
  else
    v_streak := 1;
  end if;
  v_cycle_day := ((v_streak - 1) % 7) + 1;
  v_tier := least(5, ((v_streak - 1) / 7) + 1);

  select * into d from public.login_streak_reward_definitions
  where cycle_day = v_cycle_day and tier = v_tier;
  if not found then raise exception 'Login streak reward definition missing'; end if;

  -- Lever scalars (0018): the economy-critical magnitudes, read
  -- from economy_config with the content module's defaults and
  -- clamped identically ([0, 3]) at this call site.
  v_credits := floor(d.credits * greatest(0, least(3,
    public.cc_economy_config_number('streakCreditScalar', 1))))::bigint;
  -- 0082: the ladder pays no fragments (the currency is abolished;
  -- the seeded definitions are zeroed below and claims record 0).
  v_keys := d.cache_keys;

  update public.profiles
  set credits = credits + v_credits,
      cache_tokens = cache_tokens + v_keys
  where id = p_player_id
  returning * into p;

  insert into public.login_streak_claims (
    player_id, claim_day, streak_length, cycle_day, tier,
    credits_awarded, fragments_awarded, cache_keys_awarded, claimed_at
  ) values (
    p_player_id, v_today, v_streak, v_cycle_day, v_tier,
    v_credits, 0, v_keys, p_now
  );

  insert into public.login_streak_state (
    player_id, current_streak, longest_streak,
    last_claim_day, last_cycle_day, last_tier, updated_at
  ) values (
    p_player_id, v_streak, v_streak, v_today, v_cycle_day, v_tier, p_now
  )
  on conflict (player_id) do update
  set current_streak = excluded.current_streak,
      longest_streak = greatest(public.login_streak_state.longest_streak, excluded.longest_streak),
      last_claim_day = excluded.last_claim_day,
      last_cycle_day = excluded.last_cycle_day,
      last_tier = excluded.last_tier,
      updated_at = excluded.updated_at;

  result := jsonb_build_object(
    'action_type', 'cc_login_streak_claim',
    'already_claimed', false,
    'day', v_today,
    'streak_length', v_streak,
    'cycle_day', v_cycle_day,
    'tier', v_tier,
    'credits_awarded', v_credits,
    'fragments_awarded', 0,
    'cache_keys_awarded', v_keys,
    'profile', public.cc_profile_snapshot(p)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (p_player_id, 'cc_login_streak_claim',
          'login-streak:' || p_player_id::text || ':' || v_today::text, result);

  return result;
end;
$$;


-- ---------------------------------------------------------------------
-- 11. cc_contract_terms restated from 0042: issued rewards are
--     credits only — no 'fragments' key in the frozen reward jsonb.
-- ---------------------------------------------------------------------

create or replace function public.cc_contract_terms(
  p_player_id uuid,
  p_template_id text,
  p_kind text,
  p_band_index integer
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  d public.contract_template_definitions%rowtype;
  band public.contract_bands%rowtype;
  v_target_scalar numeric := greatest(0.5, least(2,
    public.cc_economy_config_number('contractTargetScalar', 1)));
  v_reward_scalar numeric := greatest(0, least(2,
    public.cc_economy_config_number('contractRewardScalar', 1)));
  v_base numeric;
  v_target integer;
  v_credits bigint;
  v_baseline jsonb := '{}'::jsonb;
  v_stat_value bigint;
begin
  select * into d from public.contract_template_definitions where template_id = p_template_id;
  if not found then raise exception 'Unknown contract template'; end if;
  select * into band from public.contract_bands where band_index = p_band_index;

  if d.target_by_band is not null then
    v_base := coalesce((d.target_by_band -> p_band_index::text ->> p_kind)::numeric, 1);
    v_target := greatest(1, round(v_base * v_target_scalar))::integer;
  else
    v_base := case when p_kind = 'daily' then d.base_target_daily else d.base_target_weekly end;
    v_target := greatest(1, round(v_base * band.target_multiplier * v_target_scalar))::integer;
  end if;

  v_credits := round((case when p_kind = 'daily' then band.daily_credits else band.weekly_credits end)
    * v_reward_scalar)::bigint;
  -- 0082: contracts pay no fragments (currency abolished); the
  -- reward is credits only.
  if d.stat_key is not null then
    select stat_value into v_stat_value from public.player_stat_counters
     where user_id = p_player_id and stat_key = d.stat_key;
    v_baseline := jsonb_build_object(d.stat_key, coalesce(v_stat_value, 0));
  end if;

  return jsonb_build_object(
    'target', v_target,
    'reward', jsonb_build_object('credits', v_credits),
    'baseline', v_baseline
  );
end;
$$;


-- ---------------------------------------------------------------------
-- 12. cc_claim_contract_reward restated from 0042: frozen fragment
--     legs (pre-0082 instances) pay nothing; the daily full-set
--     bonus pays 30 credits (the fold) instead of 2 fragment
--     parts; the weekly bonus keeps its key. The
--     contract_set_bonuses.fragments_awarded column records 0.
-- ---------------------------------------------------------------------

create or replace function public.cc_claim_contract_reward(
  p_player_id uuid,
  p_nonce text,
  p_instance_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  inst public.contract_instances%rowtype;
  v_replay jsonb;
  v_progress jsonb;
  v_credits bigint;
  v_end timestamptz;
  v_open integer;
  v_bonus jsonb := null;
  v_bonus_credits bigint := 0;
  v_bonus_keys integer := 0;
  band public.contract_bands%rowtype;
  v_result jsonb;
begin
  if p_player_id is null then raise exception 'Authentication required'; end if;
  if p_nonce is null or length(p_nonce) < 8 then raise exception 'A claim nonce is required'; end if;

  perform pg_advisory_xact_lock(hashtext(p_player_id::text));

  select * into p from public.profiles where id = p_player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  select result_payload into v_replay from public.verified_action_ledger
   where user_id = p_player_id and idempotency_key = p_nonce
     and action_type = 'cc_claim_contract_reward';
  if v_replay is not null then return v_replay; end if;

  if p.account_type = 'guest' then
    raise exception 'Contracts require a verified account — link Google sign-in to claim rewards';
  end if;

  select * into inst from public.contract_instances where id = p_instance_id and user_id = p_player_id;
  if not found then raise exception 'Contract not found'; end if;
  if inst.status = 'claimed' then raise exception 'Contract already claimed'; end if;
  if inst.status = 'rerolled' then raise exception 'Contract was rerolled'; end if;

  v_end := (inst.period_key || 'T00:00:00Z')::timestamptz
    + (case when inst.period_kind = 'daily' then interval '1 day' else interval '7 days' end);
  if now() >= v_end then raise exception 'Contract expired — the window has closed'; end if;

  v_progress := public.cc_contract_progress(p_instance_id);
  if not coalesce((v_progress ->> 'complete')::boolean, false) then
    raise exception 'Contract not complete';
  end if;

  -- 0082: only the frozen CREDITS pay. Instances issued before
  -- this migration may still carry a 'fragments' leg in their
  -- frozen reward jsonb — it pays nothing (the currency is
  -- abolished; each such leg was worth < 1 key).
  v_credits := coalesce((inst.reward ->> 'credits')::bigint, 0);

  update public.profiles
     set credits = credits + v_credits,
         updated_at = now()
   where id = p_player_id;

  update public.contract_instances
     set status = 'claimed', claimed_at = now()
   where id = p_instance_id;

  -- Full-set bonus: every slot of this set, at its current
  -- generation, is now claimed.
  select count(*) into v_open
    from public.contract_instances cur
   where cur.user_id = p_player_id
     and cur.period_kind = inst.period_kind
     and cur.period_key = inst.period_key
     and cur.status <> 'claimed'
     and cur.generation = (
       select max(g.generation) from public.contract_instances g
        where g.user_id = cur.user_id and g.period_kind = cur.period_kind
          and g.period_key = cur.period_key and g.slot = cur.slot);
  if v_open = 0 then
    select * into band from public.contract_bands where band_id = inst.band;
    if inst.period_kind = 'daily' then
      -- 0082: the daily full-set bonus paid ONLY fragments (2
      -- parts); under the owner's streak fold rule it now pays
      -- credits at the value model (2 x 15 cr = 30 cr, scalar-
      -- applied) — mirroring CONTRACT_DAILY_SET_BONUS_CREDITS.
      v_bonus_credits := floor(30 * greatest(0, least(2,
        public.cc_economy_config_number('contractRewardScalar', 1))))::bigint;
    else
      v_bonus_keys := greatest(0, least(3,
        public.cc_economy_config_number('contractWeeklyKeys', 1)))::integer;
      v_bonus_credits := round(band.weekly_credits * greatest(0, least(2,
        public.cc_economy_config_number('contractRewardScalar', 1))))::bigint;
    end if;
    insert into public.contract_set_bonuses (
      user_id, period_kind, period_key, credits_awarded, fragments_awarded, cache_keys_awarded
    ) values (p_player_id, inst.period_kind, inst.period_key, v_bonus_credits, 0, v_bonus_keys)
    on conflict (user_id, period_kind, period_key) do nothing;
    if found then
      update public.profiles
         set credits = credits + v_bonus_credits,
             cache_tokens = cache_tokens + v_bonus_keys,
             updated_at = now()
       where id = p_player_id;
      v_bonus := jsonb_build_object('credits', v_bonus_credits,
        'cache_keys', v_bonus_keys);
      -- The bonus is its own verified grant (its own ledger row is
      -- what the economy fold meters: credits_minted_contracts sums
      -- both rows, contract_keys_awarded reads this one).
      insert into public.verified_action_ledger (user_id, action_type, idempotency_key, result_payload)
      values (p_player_id, 'cc_claim_contract_set_bonus', p_nonce || ':set-bonus', jsonb_build_object(
        'action_type', 'cc_claim_contract_set_bonus',
        'instance_id', inst.id,
        'template_id', inst.template_id,
        'period_kind', inst.period_kind,
        'period_key', inst.period_key,
        'credits_awarded', v_bonus_credits,
        'cache_keys_awarded', v_bonus_keys
      ));
    end if;
  end if;

  select * into p from public.profiles where id = p_player_id;

  v_result := jsonb_build_object(
    'action_type', 'cc_claim_contract_reward',
    'instance_id', inst.id,
    'template_id', inst.template_id,
    'period_kind', inst.period_kind,
    'period_key', inst.period_key,
    'credits_awarded', v_credits,
    'set_bonus', v_bonus,
    'profile', public.cc_profile_snapshot(p)
  );

  insert into public.verified_action_ledger (user_id, action_type, idempotency_key, result_payload)
  values (p_player_id, 'cc_claim_contract_reward', p_nonce, v_result);

  return v_result;
end;
$$;


-- ---------------------------------------------------------------------
-- 13. cc_profile_snapshot restated from 0069: the snapshot carries
--     cache_key_remainder; cache_token_parts leaves the snapshot
--     (nothing may display a fragment count again).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_profile_snapshot(profile_row profiles)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', profile_row.id,
    'player_level', profile_row.player_level,
    'player_xp', profile_row.player_xp,
    'credits', profile_row.credits,
    'scrap', coalesce((profile_row.materials ->> 'Scrap')::bigint, 0),
    'cache_tokens', profile_row.cache_tokens,
    'cache_key_remainder', coalesce(profile_row.cache_key_remainder, 0),
    'legendary_cores', coalesce(profile_row.legendary_cores, 0),
    'materials', profile_row.materials,
    'essences', profile_row.essences,
    'consumables', profile_row.consumables,
    'consumable_batches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'consumable_type', b.consumable_type,
        'quality_percent', b.quality_percent,
        'quantity', b.quantity,
        'origin', b.origin,
        'creator_user_id', b.creator_user_id,
        'source_recipe_id', b.source_recipe_id,
        'metadata', b.metadata,
        'created_at', b.created_at,
        'updated_at', b.updated_at
      ) order by b.consumable_type, b.quality_percent desc, b.created_at)
      from public.consumable_batches b
      where b.owner_user_id = profile_row.id and b.quantity > 0
    ), '[]'::jsonb),
    'vehicle_fuel', profile_row.vehicle_fuel,
    'skill_spends', profile_row.skill_spends,
    'action_skill_charge', coalesce(profile_row.action_skill_charge, 0),
    'action_skill_selection', profile_row.action_skill_selection,
    'cache_rank_tokens', coalesce(profile_row.cache_rank_tokens, 0),
    'cache_rank_grant_level', coalesce(profile_row.cache_rank_grant_level, 0),
    'cache_rank_spends', coalesce(profile_row.cache_rank_spends, '{}'::jsonb),
    'boss_state', profile_row.boss_state,
    'last_idle_claim_at', profile_row.last_idle_claim_at
  );
$function$;


-- ---------------------------------------------------------------------
-- 14. cc_compute_economy_metrics restated from 0074 verbatim, plus
--     the cache_keys_from_roaming fold (section 1's new column).
--     cache_fragments_awarded / cache_fragments_from_login_streak
--     remain computed and freeze as history.
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
  v_scrap_minted_total bigint;
  v_scrap_destroyed_total bigint;
  v_scrap_destroyed_crafting bigint;
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
    -- 0082: whole cache keys paid by roaming/offline claims (the
    -- fragment fold above freezes as history — new claim payloads
    -- carry cache_keys_awarded, never cache_fragments_awarded).
    coalesce(sum((result_payload -> 'rewards' ->> 'cache_keys_awarded')::bigint)
      filter (where action_type in ('cc_apply_chef_rewards', 'cc_settle_offline_roaming', 'cc_claim_roaming_rewards')), 0) as cache_keys_from_roaming,
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
    -- Scrap meters (0071, brief S4.4 + S6): the engine material's
    -- faucets, folded from the same ledger payloads as the credit
    -- meters. Salvage counts every application of the salvage rate
    -- to an item: manual recycles (single + batch scrap_award) and
    -- the boss Second Opinion auto-scrap (the attempt's top-level
    -- scrap_awarded, credited through the attempt's scrap delta).
    (coalesce(sum((result_payload ->> 'scrap_award')::bigint)
        filter (where action_type in ('cc_recycle_item', 'cc_recycle_batch')), 0)
     + coalesce(sum((result_payload ->> 'scrap_awarded')::bigint)
        filter (where action_type = 'cc_apply_boss_attempt'), 0)) as scrap_minted_salvage,
    -- Roaming folds the trickle wherever it is paid: live claims,
    -- offline settlement (the same trickle paid in arrears), and
    -- the retired legacy claim rows the credit fold still reads.
    coalesce(sum((result_payload -> 'rewards' ->> 'scrap_awarded')::bigint)
      filter (where action_type in ('cc_apply_chef_rewards', 'cc_settle_offline_roaming', 'cc_claim_roaming_rewards')), 0) as scrap_minted_roaming,
    coalesce(sum((result_payload -> 'payout' ->> 'scrap')::bigint)
      filter (where action_type = 'cc_dispatch_settle'), 0) as scrap_minted_dispatch,
    (coalesce(sum((result_payload -> 'payout' ->> 'scrap')::bigint)
        filter (where action_type in ('cc_end_endless_run', 'cc_apply_endless_encounter')), 0)
     + coalesce(sum((result_payload -> 'abandoned_settlement' -> 'payout' ->> 'scrap')::bigint)
        filter (where action_type = 'cc_start_endless_run'), 0)) as scrap_minted_endless,
    -- The starter bundle's +500 Scrap (0069): the bundle result
    -- carries no scrap field, so the fold counts grants x the
    -- shipped grant, exactly as minted_other counts 5000 x grants
    -- for the bundle's credits.
    500 * count(*) filter (where action_type = 'cc_initial_bundle') as scrap_minted_bundle,
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

  -- Scrap destroyed by crafting (0071): the 'Scrap' leg of the
  -- materials fold below (enqueue escrows + catalysts, net of
  -- cancel refunds), PLUS tint escrows — tint jobs enqueue under
  -- their own action type, and the tint's flat Scrap leg is a
  -- crafting burn the brief names (S4.4). The materials jsonb fold
  -- keeps its shipped enqueue-only scope; this scalar is the
  -- scrap-complete view. Floored at 0 like the jsonb fold's
  -- per-key having clause (a cancel can outrun its enqueue day).
  select greatest(0, coalesce(sum(delta), 0))::bigint
    into v_scrap_destroyed_crafting
    from (
      select (e.value)::bigint as delta
        from public.verified_action_ledger l,
             jsonb_each_text(coalesce(l.result_payload -> 'job' -> 'escrow_inputs', '{}'::jsonb)) as e
       where l.action_type = 'cc_enqueue_craft_job' and e.key = 'Scrap'
         and l.created_at >= v_start and l.created_at < v_end
      union all
      select (e.value)::bigint
        from public.verified_action_ledger l,
             jsonb_each_text(coalesce(l.result_payload -> 'job' -> 'escrow_catalyst', '{}'::jsonb)) as e
       where l.action_type = 'cc_enqueue_craft_job' and e.key = 'Scrap'
         and l.created_at >= v_start and l.created_at < v_end
      union all
      select (e.value)::bigint
        from public.verified_action_ledger l,
             jsonb_each_text(coalesce(l.result_payload -> 'job' -> 'escrow_inputs', '{}'::jsonb)) as e
       where l.action_type = 'cc_enqueue_tint_job' and e.key = 'Scrap'
         and l.created_at >= v_start and l.created_at < v_end
      union all
      select -(e.value)::bigint
        from public.verified_action_ledger l,
             jsonb_each_text(coalesce(l.result_payload -> 'refunded_inputs', '{}'::jsonb)) as e
       where l.action_type = 'cc_cancel_craft_job' and e.key = 'Scrap'
         and l.created_at >= v_start and l.created_at < v_end
    ) d;

  v_scrap_minted_total := m.scrap_minted_salvage + m.scrap_minted_roaming
    + m.scrap_minted_dispatch + m.scrap_minted_endless + m.scrap_minted_bundle;
  v_scrap_destroyed_total := v_scrap_destroyed_crafting
    + m.scrap_destroyed_reforge + m.scrap_destroyed_contract_rerolls;

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
    cache_keys_from_ads, cache_keys_from_leaderboards, cache_opens, cache_fragments_awarded, cache_keys_from_roaming,
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
    scrap_minted_salvage, scrap_minted_roaming, scrap_minted_dispatch,
    scrap_minted_endless, scrap_minted_bundle, scrap_minted_total,
    scrap_destroyed_crafting, scrap_destroyed_total, net_scrap_change,
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
    m.cache_keys_from_ads, m.cache_keys_from_leaderboards, m.cache_opens, m.cache_fragments_awarded, m.cache_keys_from_roaming,
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
    m.scrap_minted_salvage, m.scrap_minted_roaming, m.scrap_minted_dispatch,
    m.scrap_minted_endless, m.scrap_minted_bundle, v_scrap_minted_total,
    v_scrap_destroyed_crafting, v_scrap_destroyed_total,
    v_scrap_minted_total - v_scrap_destroyed_total,
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
    cache_keys_from_roaming = excluded.cache_keys_from_roaming,
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
    scrap_minted_salvage = excluded.scrap_minted_salvage,
    scrap_minted_roaming = excluded.scrap_minted_roaming,
    scrap_minted_dispatch = excluded.scrap_minted_dispatch,
    scrap_minted_endless = excluded.scrap_minted_endless,
    scrap_minted_bundle = excluded.scrap_minted_bundle,
    scrap_minted_total = excluded.scrap_minted_total,
    scrap_destroyed_crafting = excluded.scrap_destroyed_crafting,
    scrap_destroyed_total = excluded.scrap_destroyed_total,
    net_scrap_change = excluded.net_scrap_change,
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
